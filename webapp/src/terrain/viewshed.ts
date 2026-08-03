/**
 * Viewshed — OCOKA 6 (docs/ROUTE_INTELLIGENCE.md §47/§8, master_plan.md
 * "Next up") — real line-of-sight from a painted observer over the sampled
 * hex grid. A per-target front-to-back trace via `hexGrid.ts`'s `hexLine()`,
 * not a shared-horizon-sweep optimisation (the "R3"-family sweep some
 * viewshed literature uses to amortise cost across a whole 360° field in one
 * pass) — simpler, correct per target with no cross-line approximation, and
 * cheap enough at this mode's existing grid scale (same order as the search/
 * ensemble work already offloaded to the Worker for the same CPU-bound
 * reason — see `mobilityWorker.ts`'s 'viewshed' request kind). Stated
 * plainly rather than borrowing the "R3" name for a variant that isn't the
 * literature's actual amortised sweep.
 *
 * HONESTY CONSTRAINTS (root CLAUDE.md's Terrain Mobility rules; docs §47.2):
 * 1. Elevation is a BARE-EARTH DEM, one value per hex centre. A bare-earth
 *    viewshed is systematically OPTIMISTIC — it shows ground as observed
 *    when real vegetation canopy would actually block it, and that errs in
 *    the UNSAFE direction (an approach reads as watched when it isn't). Per
 *    §47.2, the SCREENED (pessimistic, vegetation-canopy-aware) surface is
 *    the default/headline result; bare-earth is a secondary surface, always
 *    computed and returned alongside it, never presented as the default.
 * 2. Fields of fire — a weapon/sensor-range-bound RELEVANCE claim layered on
 *    top of raw visibility — is deliberately NOT computed by this module.
 *    This module only answers "what ground can this observer see"; "…within
 *    an effective range the user has stated" is a real, narrower question
 *    left for a follow-up stage (`fieldsOfFireAssessed` stays `false`
 *    downstream until it ships — see `oakoc.ts`'s own comment on this
 *    factor). Do not read `DEFAULT_MAX_RANGE_M` below as a stated range —
 *    it is a compute-bound cap, not a user-asserted weapon/sensor limit.
 * 3. The painted observer cell has no name and no person field (docs §47.2's
 *    Tier-3 restatement) — the tool models terrain, not people.
 */

import { MobilityGridCell } from './accumulatedCost';
import { AxialCoord, axialToLocal, hexKey, hexLine } from '../utils/hexGrid';
import { lookupScreeningHeight } from './dataLayers/structureTable';
import { CorridorField } from './corridorField';

/** Representative adult standing eye height, metres — the observer's own
 *  vantage above the ground it stands on. Not user-configurable in this
 *  pass (no per-observer height input yet); a single documented constant
 *  applied to every painted observer. */
export const DEFAULT_OBSERVER_EYE_HEIGHT_M = 1.7;

/** Same figure applied to the TARGET side of the sightline — "can this
 *  observer see a person/vehicle-scale object standing at this location",
 *  the natural product framing for this mode (not "can it see bare ground",
 *  which would put the reference height at 0 and answer a less useful
 *  question). */
export const DEFAULT_TARGET_HEIGHT_M = 1.7;

/** Generous default cap so a run without a user-stated effective range
 *  (today, every run — see module header point 2) still terminates in
 *  bounded time. Real unaided/optic visibility rarely reaches this, and
 *  curvature+refraction (below) already suppresses most targets well before
 *  it on typical terrain — this exists to bound worst-case cost on very
 *  flat, very large AOIs, not to model any real sensor. */
export const DEFAULT_MAX_RANGE_M = 20000;

/** Mean Earth radius, metres (IUGG). */
const EARTH_RADIUS_M = 6371000;
/** Standard combined curvature-and-refraction coefficient used in
 *  surveying / line-of-sight calculations (~0.13, average atmospheric
 *  refraction) — a typical-conditions constant, not measured for the
 *  specific day or atmosphere of any one run. */
const REFRACTION_COEFFICIENT = 0.13;
const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M / (1 - REFRACTION_COEFFICIENT);

/** How much a point `distanceM` away drops below a flat local tangent plane
 *  due to Earth curvature, partially offset by atmospheric refraction — the
 *  standard combined correction (see `REFRACTION_COEFFICIENT`). Elevation is
 *  already systematically optimistic (module header point 1); skipping this
 *  correction would make long sightlines optimistic on TOP of that. */
function curvatureRefractionDropM(distanceM: number): number {
  return (distanceM * distanceM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
}

/** Elevation angle (radians) of a point at `heightM` above sea level,
 *  `distanceM` horizontal metres from the observer, as seen from an
 *  observer eye at `observerEyeM` above sea level. Curvature+refraction is
 *  applied to the far point only — the observer's own local tangent plane
 *  is the reference, the standard convention for this class of calculation. */
function elevationAngleRad(observerEyeM: number, heightM: number, distanceM: number): number {
  if (distanceM <= 0) return Math.PI / 2;
  const apparentHeightM = heightM - curvatureRefractionDropM(distanceM);
  return Math.atan2(apparentHeightM - observerEyeM, distanceM);
}

export interface ViewshedOptions {
  maxRangeM?: number;
  observerEyeHeightM?: number;
  targetHeightM?: number;
}

export interface ObserverViewshed {
  observerKey: string;
  /** Cell keys visible accounting for vegetation-canopy screening — the
   *  default, pessimistic surface (module header point 1). Always includes
   *  the observer's own cell. */
  screenedVisibleKeys: Set<string>;
  /** Cell keys visible over bare earth only — optimistic, always computed
   *  alongside the screened surface, never presented as the headline. */
  bareEarthVisibleKeys: Set<string>;
  /** How many cells fell within `maxRangeM` and were actually traced —
   *  informational, so a UI/export can say "of N cells in range" rather
   *  than implying the whole grid was tested. */
  cellsConsidered: number;
}

/**
 * Real per-target front-to-back line-of-sight trace from one observer cell
 * over the rest of `cells`. MUST run off the main thread at any non-trivial
 * grid size — see `mobilityWorker.ts`'s 'viewshed' request kind and this
 * module's own CPU-cost note above (same reasoning as `keyTerrain.ts`'s
 * MUST-NOT-RUN-ON-MAIN-THREAD warning: reproduces step 41's page-hang
 * regression otherwise).
 */
export function computeViewshedForObserver(
  observerKey: string,
  cells: MobilityGridCell[],
  hexSize: number,
  options: ViewshedOptions = {}
): ObserverViewshed | null {
  const maxRangeM = options.maxRangeM ?? DEFAULT_MAX_RANGE_M;
  const observerEyeHeightM = options.observerEyeHeightM ?? DEFAULT_OBSERVER_EYE_HEIGHT_M;
  const targetHeightM = options.targetHeightM ?? DEFAULT_TARGET_HEIGHT_M;

  const byKey = new Map(cells.map(c => [c.key, c]));
  const observer = byKey.get(observerKey);
  if (!observer) return null;

  const observerLocal = axialToLocal(observer.hex, hexSize);
  const observerEyeElevM = observer.elevation + observerEyeHeightM;
  const localDistanceM = (hex: AxialCoord): number => {
    const p = axialToLocal(hex, hexSize);
    const dx = p.x - observerLocal.x;
    const dy = p.y - observerLocal.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const screenedVisibleKeys = new Set<string>([observer.key]);
  const bareEarthVisibleKeys = new Set<string>([observer.key]);
  let cellsConsidered = 0;

  for (const target of cells) {
    if (target.key === observer.key) continue;
    const targetDistanceM = localDistanceM(target.hex);
    if (targetDistanceM > maxRangeM) continue;
    cellsConsidered++;

    const line: AxialCoord[] = hexLine(observer.hex, target.hex);
    let maxAngleScreened = -Infinity;
    let maxAngleBareEarth = -Infinity;
    let screenedBlocked = false;
    let bareEarthBlocked = false;

    for (let i = 1; i < line.length; i++) {
      const stepCell = byKey.get(hexKey(line[i]));
      // A gap in the sampled grid means nothing is known about that ground —
      // it cannot be asserted to obstruct, so the trace just skips it. This
      // is a real limitation on an incompletely-sampled AOI (edges, sparse
      // fidelity settings); it can only make the result MORE optimistic,
      // never less, which is the same direction as the bare-earth-DEM
      // limitation this module already states plainly above.
      if (!stepCell) continue;
      const isTarget = i === line.length - 1;
      const stepDistanceM = localDistanceM(stepCell.hex);

      if (isTarget) {
        const targetAngle = elevationAngleRad(observerEyeElevM, stepCell.elevation + targetHeightM, stepDistanceM);
        if (targetAngle < maxAngleScreened) screenedBlocked = true;
        if (targetAngle < maxAngleBareEarth) bareEarthBlocked = true;
      } else {
        const bareAngle = elevationAngleRad(observerEyeElevM, stepCell.elevation, stepDistanceM);
        if (bareAngle > maxAngleBareEarth) maxAngleBareEarth = bareAngle;
        const screeningM = lookupScreeningHeight(stepCell.vegetation).heightM;
        const screenedAngle = elevationAngleRad(observerEyeElevM, stepCell.elevation + screeningM, stepDistanceM);
        if (screenedAngle > maxAngleScreened) maxAngleScreened = screenedAngle;
      }
    }

    if (!bareEarthBlocked) bareEarthVisibleKeys.add(target.key);
    if (!screenedBlocked) screenedVisibleKeys.add(target.key);
  }

  return { observerKey, screenedVisibleKeys, bareEarthVisibleKeys, cellsConsidered };
}

export interface ObservationResult {
  observers: ObserverViewshed[];
  /** Union across every painted observer — "is this ground seen by AT LEAST
   *  ONE observer", the natural product question for a security/OP-siting
   *  posture. Screened (pessimistic) surface — the headline figure. */
  screenedUnionKeys: Set<string>;
  /** Same union over the bare-earth surface — always computed, never the
   *  headline (module header point 1). */
  bareEarthUnionKeys: Set<string>;
  /** Share (0..1) of the headline corridor field's OWN cells covered by the
   *  screened union — "does an observation post here actually see the
   *  approach", the exact question docs §8 names ("suggests where an
   *  observation post would actually see the corridor"). Null when no
   *  corridor field existed to test against — same null-when-nothing-formed
   *  convention `corridorField.ts` itself already uses throughout. */
  corridorCoverageFraction: number | null;
}

/**
 * Assemble the per-observer traces into one result — pure re-grouping plus
 * one real roll-up (corridor coverage), same "assembly, one real number, no
 * invented signal" discipline `keyTerrain.ts`'s `buildKeyTerrainResult` and
 * `oakoc.ts` already follow in this mode.
 */
export function buildObservationResult(
  observers: ObserverViewshed[],
  corridorField: CorridorField | null
): ObservationResult {
  const screenedUnionKeys = new Set<string>();
  const bareEarthUnionKeys = new Set<string>();
  for (const o of observers) {
    for (const k of o.screenedVisibleKeys) screenedUnionKeys.add(k);
    for (const k of o.bareEarthVisibleKeys) bareEarthUnionKeys.add(k);
  }

  let corridorCoverageFraction: number | null = null;
  if (corridorField) {
    const corridorCellKeys = new Set(corridorField.corridors.flatMap(c => c.cells.map(cc => cc.key)));
    if (corridorCellKeys.size > 0) {
      let covered = 0;
      for (const k of corridorCellKeys) if (screenedUnionKeys.has(k)) covered++;
      corridorCoverageFraction = covered / corridorCellKeys.size;
    }
  }

  return { observers, screenedUnionKeys, bareEarthUnionKeys, corridorCoverageFraction };
}
