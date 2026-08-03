/**
 * Lazy hex-grid materialisation — docs/ROUTE_INTELLIGENCE.md §35, "the
 * design" points 1 ("delete the box") and 5 ("eager coarse tiles, lazy fine
 * cells"). Replaces `mobilityAppreciation.ts`'s previous fix for the same
 * defect (Lake George: a search walled into a pre-sized box reports "no
 * route" without distinguishing "there is no way" from "I wasn't allowed to
 * look far enough") — escalating `boundsPadFactor` RETRIES that rebuilt the
 * entire grid from scratch (re-sampling every cell, re-running Dijkstra from
 * zero) at a bigger guessed box each time. This module instead grows the
 * grid ORGANICALLY: start with a modest tile footprint around the painted
 * areas, run the search, and whenever the reachable frontier runs off the
 * edge of what's currently materialised, fetch exactly the next ring of
 * tiles and RESUME the same search (`accumulatedCost.ts`'s `resumeFrom`)
 * rather than restarting it. A normal run (the common case — the initial
 * footprint already contains a route) pays for exactly one round, identical
 * cost to the old fixed-box approach; only a genuinely Lake-George-shaped run
 * pays for the extra tiles, and only the NEW ground, never a full resample.
 *
 * Hex size and the local projection are fixed ONCE, from the initial
 * footprint — never recomputed as the grid grows (docs §35 point 4: "two
 * passes, uniform hex size within each" — this is one pass, so simply
 * "uniform hex size, always"). That is what keeps `demDerivatives.ts`'s
 * neighbour plane fit, `corridorField.ts`, chokepoints and min-cut completely
 * unaffected by this change: every one of them still receives one ordinary,
 * uniform-hex `MobilityGridCell[]` once the loop concludes — this module
 * only changes HOW that array gets assembled, not its shape.
 *
 * CAVEAT (honestly stated, not engineered away — see `applyCrossSlope`'s own
 * doc comment): a cell's `crossSlopeDeg` is recomputed from whatever
 * neighbours are materialised AT THE TIME each round runs, then the search
 * may settle that cell using that round's value. A cell settled while sitting
 * at a TEMPORARY edge (before the next round's tiles arrive) keeps whatever
 * crossSlopeDeg it had at settlement, even though a later round might compute
 * a more complete value for the same cell from its now-full neighbour set.
 * This is the same "edge cells have an incomplete neighbourhood" effect the
 * old fixed-box approach already had for its outer ring — genuinely new here
 * only in that the edge is now transient rather than final — and
 * `crossSlopeDeg` is already documented as a conservative upper-bound proxy,
 * not a precise per-edge figure, so this does not change what callers may
 * assume about it.
 */

import {
  LatLng, calculateDistance, makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, hexCorners, hexNeighbors,
  axialToLocal, generateBoxHexes, LocalProjection, LocalPoint, AxialCoord, PaintedArea, paintedAreaBounds,
  resolvePaintedAreaGeometry, MobilityGridCell, MobilityCellResult, AccumulatedCostSearchResult,
  assembleMobilityResults, getMoverProfile, MoverProfile, RoadSpeedOverrides, findKDissimilarPaths, clusterRoutes,
} from '@firebreak/terrain';
import { InfrastructureTrail } from '../utils/infrastructureService';
import {
  computePaddedBounds, computeCellBudget, sampleCellsForHexes, applyCrossSlope, isPaintedAreaMember, nearestCellKey,
  minDetourPadM, MobilityFidelity, DEFAULT_MOBILITY_FIDELITY, MobilityGridResult,
} from './mobilityGrid';
import { runMobilitySearchInWorker } from './mobilityWorkerClient';
import { SimPathNode } from './mobilityWorker';

/** Hexes per tile side — a tile is a batch of roughly `TILE_HEX_SPAN²` hexes,
 *  fetched with ONE round of area-batched network calls (docs §35 point 5:
 *  "fetch sample data in coarse area tiles"). Small enough that a growth
 *  round doesn't over-fetch ground the search will never touch; large enough
 *  that a typical multi-round run stays at a handful of rounds, not dozens. */
const TILE_HEX_SPAN = 10;

/** Same initial generosity the old fixed-box approach's first attempt used
 *  (`mobilityAppreciation.ts`'s prior `INITIAL_PAD_FACTOR`) — sizes the
 *  STARTING tile footprint only. Growth beyond it is frontier-driven, not
 *  another guessed multiplier. */
const INITIAL_PAD_FACTOR = 0.3;

/** How many more cells the lazy grid may materialise beyond one fidelity
 *  tier's normal `maxHexCells`, before treating further growth as a
 *  ceiling-hit rather than genuine progress. An organically-grown region
 *  legitimately covers more ground than a single symmetric box at the same
 *  cell budget would (that is the entire point), so this is deliberately
 *  more generous than `maxHexCells` alone, while still bounding worst-case
 *  (unreachable objective) runtime to a fixed multiple of it. */
const LAZY_CELL_CEILING_MULTIPLIER = 4;

/** Safety net independent of cell count — defends against a pathological
 *  shape where each round only turns up a handful of new cells (a narrow,
 *  winding reachable channel) that would otherwise take many rounds to hit
 *  the cell ceiling. */
const MAX_LAZY_ROUNDS = 14;

/**
 * docs §35 design point 2 ("a cost budget replaces the geometric bound") and
 * point 3 ("stop on corridor count, not path count") — the two remaining
 * pieces of Slice B, built on top of the tile-growth/resumable-search
 * mechanism above rather than replacing it.
 *
 * TWO-PHASE STRUCTURE, exactly as designed:
 *  - PHASE 1 (unconstrained): grow with no cost limit until the objective is
 *    first reached at all — `costStarSeconds` below. Frontier growth before
 *    this point is bounded only by the existing cell/tile/round ceilings.
 *  - PHASE 2 (budgeted): once `costStarSeconds` (C*) is known, further tile
 *    growth is restricted to the frontier WITHIN `alpha * C*` travel-time of
 *    the origin — cells beyond that budget don't pull in new tiles. This is
 *    a genuine travel-time ISOCHRONE boundary (it self-sizes to however hard
 *    the terrain actually is, since C* itself is the search's own real
 *    result), not a literal geometric ellipse — truer to "self-sizing" than
 *    a shape drawn on the map would be, since real terrain rarely detours in
 *    a mathematically elliptical arc.
 *
 * The corridor-count check (`estimateDistinctCorridorCount`) only runs
 * inside Phase 2 (a route must already exist to have corridors at all), and
 * only until the target range is reached — see `runLazyMobilitySearch`'s own
 * loop for exactly where these compose with the ceiling safety net.
 */
const DEFAULT_ALPHA = 2.0;

/** Stop growing once at least this many distinct corridors are confirmed —
 *  owner: "ensure every analysis result has 2-5 corridors surfaced." Below
 *  this, growth continues (budget/ceiling permitting) specifically to look
 *  for a genuine second avenue, rather than settling for "found A route,
 *  done" the moment the cheapest one is found. */
const MIN_TARGET_CORRIDORS = 2;

/** Stop growing once this many distinct corridors are confirmed, regardless
 *  of remaining budget — matches the design's own "2–5" ceiling: more
 *  alternatives past this point are diminishing returns for a commander
 *  reading the panel, not diminishing accuracy, so capping effort here is a
 *  presentation choice, not an honesty compromise (the FULL, separate
 *  `buildCorridorField` pass `mobilityAppreciation.ts` runs afterward can
 *  still find more if the underlying route set actually has them). */
const MAX_TARGET_CORRIDORS = 5;

/** How many dissimilar routes the INTERIM per-round corridor-count check
 *  derives — capped at `MAX_TARGET_CORRIDORS` since deriving more than the
 *  target we're checking for wastes a search with no decision value. The
 *  FINAL, presented corridor field (`mobilityAppreciation.ts`) still uses
 *  its own larger `DEFAULT_CORRIDOR_ROUTE_COUNT` (14) — this is only a
 *  cheap growth-decision signal, not the presented analysis. */
const CORRIDOR_CHECK_ROUTE_COUNT = MAX_TARGET_CORRIDORS;

/** How many genuinely distinct avenues (route clusters, the SAME similarity
 *  test `corridorField.ts`'s own presentation pass uses — see
 *  `clusterRoutes`'s doc comment) currently exist over `cells`. A cheap
 *  proxy for the eventual PRESENTED corridor count (the full pass also
 *  applies a spatial-density membership threshold that can occasionally
 *  drop a very thin cluster), used purely to decide whether tile growth
 *  should keep looking for a second avenue. */
function estimateDistinctCorridorCount(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  hexSize: number
): number {
  const routes = findKDissimilarPaths(cells, originKeys, objectiveKeys, profile, nightMode, CORRIDOR_CHECK_ROUTE_COUNT);
  if (routes.length === 0) return 0;
  const hexWidthM = hexSize * Math.sqrt(3);
  return clusterRoutes(routes, hexWidthM).length;
}

/** Exported purely for direct, network-free unit testing (docs precedent:
 *  `mobilityGrid.ts` exports `computePaddedBounds`/`frontierTouchedEdges`
 *  the same way) — the async materialisation loop below that actually calls
 *  these is, like `buildMobilityGrid` itself, not unit-testable without
 *  mocking every upstream fetch. */
export function tileKeyOf(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}

export function tileIndexOfLocal(p: LocalPoint, tileSizeM: number): { tx: number; ty: number } {
  return { tx: Math.floor(p.x / tileSizeM), ty: Math.floor(p.y / tileSizeM) };
}

/** Every tile index whose box overlaps `[min, max]` (local coords) — the
 *  INITIAL footprint's tile set. */
export function tilesCoveringBox(min: LocalPoint, max: LocalPoint, tileSizeM: number): Set<string> {
  const txMin = Math.floor(min.x / tileSizeM);
  const txMax = Math.floor(max.x / tileSizeM);
  const tyMin = Math.floor(min.y / tileSizeM);
  const tyMax = Math.floor(max.y / tileSizeM);
  const out = new Set<string>();
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) out.add(tileKeyOf(tx, ty));
  }
  return out;
}

/** All hexes belonging to tile `(tx, ty)` — generated over the tile's own
 *  box (`generateBoxHexes`, which is INCLUSIVE at both ends and so can
 *  return a hex that actually belongs to a neighbouring tile at a shared
 *  boundary) then filtered down to hexes whose centre's OWN tile index
 *  really is `(tx, ty)` — a clean partition regardless of that inclusivity,
 *  so no hex is ever double-materialised across two tiles. */
export function hexesForTile(
  tx: number, ty: number, hexSize: number, tileSizeM: number
): { hex: AxialCoord; center: LocalPoint }[] {
  const minPt: LocalPoint = { x: tx * tileSizeM, y: ty * tileSizeM };
  const maxPt: LocalPoint = { x: (tx + 1) * tileSizeM, y: (ty + 1) * tileSizeM };
  const raw = generateBoxHexes(minPt, maxPt, hexSize);
  return raw.filter(h => {
    const idx = tileIndexOfLocal(h.center, tileSizeM);
    return idx.tx === tx && idx.ty === ty;
  });
}

export interface LazyMobilitySearchOptions {
  signal?: AbortSignal;
  profileId: string;
  nightMode: boolean;
  fidelity?: MobilityFidelity;
  roadSpeedOverrides?: RoadSpeedOverrides;
  /** Painted OBSERVER area (OCOKA 6, docs/ROUTE_INTELLIGENCE.md §47/§8) —
   *  optional, resolved once at round 1 the SAME real area-overlap way as
   *  origin/objective (see `buildMobilityGrid`'s identical field for the
   *  non-lazy path). Unlike origin/objective, NO nearest-cell fallback: an
   *  empty match (or no `observerPaint` at all) is the ordinary "no
   *  observers this run" state. */
  observerPaint?: PaintedArea;
  /** docs §35 design point 2 — the α multiplier on the best-found cost C*
   *  that bounds Phase 2 growth (see the constants' own doc comment above).
   *  Design calls this "user-adjustable" (owner: "2x default with a UI
   *  option to expand or contract"); the option is threaded all the way
   *  through from `mobilityAppreciation.ts` so that control point exists,
   *  though no UI slider is wired to it yet — defaults to `DEFAULT_ALPHA`. */
  alpha?: number;
  /** Overall progress across sampling+search for ALL rounds combined, 0..1.
   *  Heuristic, not exact (the total round count isn't known upfront): each
   *  round closes half the remaining distance to 1, so a decisive first
   *  round already reads as substantial progress and a run that needs
   *  several rounds still visibly advances on every one, without ever
   *  claiming completion before the search actually is. */
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  /** Fires once per round, before that round's sampling starts — lets the
   *  caller label "sampling" vs "widening the search" the same way the old
   *  retry loop's `onStage` did. `round` is 1-indexed. */
  onRoundStart?: (round: number, materializedCellCount: number) => void;
  /** Same shape as `mobilityAppreciation.ts`'s `onPreviewCells` — fires after
   *  EVERY round's sampling (not just the first), so a multi-round run
   *  visibly redraws the growing surveyed ground on the map as tiles arrive,
   *  matching the design's own "paint the explored frontier" honesty goal. */
  onPreviewCells?: (cells: MobilityCellResult[]) => void;
}

export interface LazyMobilitySearchResult {
  grid: MobilityGridResult;
  results: MobilityCellResult[];
  path: SimPathNode[] | null;
  /** How many tile-materialisation rounds this run actually used (1 = the
   *  initial footprint alone already settled it). */
  roundsUsed: number;
  /** How many tiles were fetched in total across every round. */
  tilesUsed: number;
  /** True when growth stopped because the ceiling (cells/tiles/rounds) was
   *  hit rather than because the frontier ran out of anywhere left to grow
   *  (a genuine enclosure), a route was found with the corridor target met,
   *  or the α·C* travel-time budget was genuinely exhausted. */
  hitCeiling: boolean;
  /** The cheapest confirmed origin→objective cost, seconds — C* in the
   *  design's own `α·C*` notation. Null when no route was ever found. */
  costStarSeconds: number | null;
  /** How many distinct avenues (`estimateDistinctCorridorCount`) were
   *  confirmed by the time growth stopped — 0 when no route was found. Not
   *  necessarily the same number `buildCorridorField`'s own, separate,
   *  larger-k final pass will report (see that function's own doc comment),
   *  but the real signal this loop's own stop decision was made from. */
  corridorCountAtStop: number;
}

/**
 * Assemble the local-coordinate footprint (fixed hex size + projection) the
 * WHOLE lazy run uses, from the SAME initial-pad math the old fixed-box
 * approach's first attempt used — so a typical short-range run's hex count
 * and resolution are unchanged; only genuinely large/awkward AOIs take a
 * different path from here on.
 */
function initialFootprint(
  origin: PaintedArea, objective: PaintedArea, fidelity: MobilityFidelity, profileRoadSpeedKmh: number,
  observerPaint?: PaintedArea
): {
  proj: LocalProjection; hexSize: number; tileSizeM: number; targetCellCount: number; maxHexCells: number;
  min: LocalPoint; max: LocalPoint;
} | null {
  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;

  const detourPadM = minDetourPadM({ roadSpeedKmh: profileRoadSpeedKmh });
  const padded = computePaddedBounds(originBounds, objectiveBounds, INITIAL_PAD_FACTOR, detourPadM);
  if (!padded) return null;
  let { boundsSw, boundsNe } = padded;

  // Observer resolution (OCOKA 6) only ever runs ONCE, at round 1, against
  // whatever this initial footprint covers — later rounds' organic growth is
  // driven by the COST SEARCH's own reachable frontier, not by where an
  // observer was painted, so an observer sitting outside this box would
  // silently never be found even after later rounds materialise tiles
  // elsewhere. Union the observer paint's own bounds in here, unconditionally,
  // so a real observation post the user painted off to one side of the direct
  // route is guaranteed to be in the round-1 cell set rather than depending on
  // the search happening to grow toward it.
  const observerBounds = observerPaint ? paintedAreaBounds(observerPaint) : null;
  if (observerBounds) {
    boundsSw = { lat: Math.min(boundsSw.lat, observerBounds.minLat), lng: Math.min(boundsSw.lng, observerBounds.minLng) };
    boundsNe = { lat: Math.max(boundsNe.lat, observerBounds.maxLat), lng: Math.max(boundsNe.lng, observerBounds.maxLng) };
  }

  const boxWidthM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsSw.lat, boundsNe.lng);
  const boxHeightM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsSw.lng);
  const spanMForBudget = Math.max(boxWidthM, boxHeightM);
  const { targetCellCount, maxHexCells } = computeCellBudget(spanMForBudget, fidelity);

  const center: LatLng = { lat: (boundsSw.lat + boundsNe.lat) / 2, lng: (boundsSw.lng + boundsNe.lng) / 2 };
  const proj = makeProjection(center);
  const boxMinLocal = toLocal(proj, boundsSw);
  const boxMaxLocal = toLocal(proj, boundsNe);
  const min: LocalPoint = { x: Math.min(boxMinLocal.x, boxMaxLocal.x), y: Math.min(boxMinLocal.y, boxMaxLocal.y) };
  const max: LocalPoint = { x: Math.max(boxMinLocal.x, boxMaxLocal.x), y: Math.max(boxMinLocal.y, boxMaxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) return null;

  const hexSize = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, targetCellCount);
  const tileSizeM = hexSize * TILE_HEX_SPAN;
  return { proj, hexSize, tileSizeM, targetCellCount, maxHexCells, min, max };
}

export async function runLazyMobilitySearch(
  origin: PaintedArea,
  objective: PaintedArea,
  options: LazyMobilitySearchOptions
): Promise<LazyMobilitySearchResult | null> {
  const {
    signal, fidelity = DEFAULT_MOBILITY_FIDELITY, roadSpeedOverrides, onProgress, onLog, onRoundStart, onPreviewCells,
    alpha = DEFAULT_ALPHA, observerPaint,
  } = options;
  const profile = getMoverProfile(options.profileId);
  if (!profile) return null;

  const foot = initialFootprint(origin, objective, fidelity, profile.roadSpeedKmh, observerPaint);
  if (!foot) return null;
  const { proj, hexSize, tileSizeM, targetCellCount, maxHexCells, min, max } = foot;
  const cellCeiling = maxHexCells * LAZY_CELL_CEILING_MULTIPLIER;
  const tileCeiling = Math.max(16, Math.ceil(cellCeiling / (TILE_HEX_SPAN * TILE_HEX_SPAN * 0.7)));

  const originBounds = paintedAreaBounds(origin)!;
  const objectiveBounds = paintedAreaBounds(objective)!;
  const originGeom = resolvePaintedAreaGeometry(origin);
  const objectiveGeom = resolvePaintedAreaGeometry(objective);
  const observerGeom = observerPaint ? resolvePaintedAreaGeometry(observerPaint) : null;

  const materialized = new Map<string, MobilityGridCell>();
  const materializedTiles = new Set<string>();
  let neededTiles = tilesCoveringBox(min, max, tileSizeM);

  let usedEstimatedData = false;
  let infrastructureAvailable = false;
  let hydrologyAvailable = false;
  const waterFeatures: InfrastructureTrail[] = [];
  const roadWays: InfrastructureTrail[] = [];

  let originKeys: string[] = [];
  let objectiveKeys: string[] = [];
  let observerKeys: string[] = [];
  let reach: AccumulatedCostSearchResult | undefined;
  let results: MobilityCellResult[] = [];
  let path: SimPathNode[] | null = null;
  let hitCeiling = false;
  let round = 0;
  // docs §35 design points 2+3 — Phase 1 (unconstrained) until a route
  // exists at all, then Phase 2 (budgeted by α·C*, stopping once 2–5
  // distinct corridors are confirmed). See the constants' own doc comment.
  let costStar: number | undefined;
  let corridorCountAtStop = 0;

  while (true) {
    round++;
    if (signal?.aborted) return null;

    const newTileKeys = [...neededTiles].filter(k => !materializedTiles.has(k));
    if (newTileKeys.length === 0) break; // nothing left anywhere to grow into — genuine enclosure
    for (const k of newTileKeys) materializedTiles.add(k);
    onRoundStart?.(round, materialized.size);

    const newHexesAll = newTileKeys.flatMap(k => {
      const [txStr, tyStr] = k.split(':');
      return hexesForTile(Number(txStr), Number(tyStr), hexSize, tileSizeM);
    });
    const newHexes = newHexesAll.filter(h => !materialized.has(hexKey(h.hex)));
    if (newHexes.length === 0) {
      // Every hex these tiles would contribute is already materialised
      // (defensive — the tile partition should make this unreachable) or the
      // tiles themselves cover no hexes at all (possible right at the very
      // edge of a tile-size rounding). Either way there's nothing new to
      // fetch or search over from this batch.
      if (materializedTiles.size >= tileCeiling || round >= MAX_LAZY_ROUNDS) { hitCeiling = true; break; }
      continue;
    }

    // Bounds for this round's area-batched fetches (vegetation/roads/water)
    // — the new hexes' own extent, padded a couple of hex-widths so corner
    // sampling and nearby-feature snapping right at the tile edge aren't
    // starved of context the way a razor-tight bbox would risk.
    const newPoints = newHexes.map(h => toLatLng(proj, h.center));
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of newPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    const padDeg = (hexSize * 2) / 111320;
    const roundBounds = { minLat: minLat - padDeg, minLng: minLng - padDeg, maxLat: maxLat + padDeg, maxLng: maxLng + padDeg };

    const sampled = await sampleCellsForHexes(newHexes, proj, hexSize, roundBounds, signal, f => {
      onProgress?.(roundProgress(round, f * 0.6));
    });
    if (!sampled) return null; // aborted mid-fetch
    for (const c of sampled.cells) materialized.set(c.key, c);
    usedEstimatedData = usedEstimatedData || sampled.usedEstimatedData;
    infrastructureAvailable = infrastructureAvailable || sampled.infrastructureAvailable;
    hydrologyAvailable = hydrologyAvailable || sampled.hydrologyAvailable;
    waterFeatures.push(...sampled.waterFeatures);
    roadWays.push(...sampled.roadWays);

    const allCells = Array.from(materialized.values());
    applyCrossSlope(allCells);

    if (round === 1) {
      const cornerPoints = allCells.map(c => hexCorners(axialToLocal(c.hex, hexSize), hexSize).map(p => toLatLng(proj, p)));
      const originMatch = allCells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], originGeom)).map(c => c.key);
      const objectiveMatch = allCells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], objectiveGeom)).map(c => c.key);
      originKeys = originMatch.length > 0 ? originMatch
        : [nearestCellKey(allCells, { lat: (originBounds.minLat + originBounds.maxLat) / 2, lng: (originBounds.minLng + originBounds.maxLng) / 2 })];
      objectiveKeys = objectiveMatch.length > 0 ? objectiveMatch
        : [nearestCellKey(allCells, { lat: (objectiveBounds.minLat + objectiveBounds.maxLat) / 2, lng: (objectiveBounds.minLng + objectiveBounds.maxLng) / 2 })];
      // No nearest-cell fallback (unlike origin/objective) — no observers
      // painted, or none matching the round-1 footprint, is the ordinary
      // "no observers this run" state, same convention `buildMobilityGrid`
      // uses for its own observerKeys.
      observerKeys = observerGeom
        ? allCells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], observerGeom)).map(c => c.key)
        : [];
    }

    // Same real classification `assembleMobilityResults` always does — a
    // genuine GO/SLOW-GO/NO-GO terrain read per cell, using whatever
    // reachability `reach` carries so far (the previous round's, or none on
    // round 1) rather than a fabricated placeholder. Matches
    // `mobilityAppreciation.ts`'s own pre-search `onPreviewCells` call.
    onPreviewCells?.(assembleMobilityResults(allCells, hexSize, proj, reach?.best ?? new Map(), profile));

    const outcome = await runMobilitySearchInWorker(
      allCells, hexSize, proj, originKeys, objectiveKeys, options.profileId, options.nightMode, roadSpeedOverrides,
      f => onProgress?.(roundProgress(round, 0.6 + f * 0.4)),
      reach
    );
    if (signal?.aborted) return null;
    reach = outcome.reach;
    results = outcome.results;
    path = outcome.path;

    // Phase 1 → Phase 2 transition: the first time a route exists, record
    // C* — the cheapest confirmed origin→objective cost — and never let it
    // get WORSE on a later round (later rounds can only refine/improve
    // reachability, never regress it, but this guards the edge case of a
    // still-undefined objective-key arrival cleanly).
    if (path) {
      const objectiveTimes = objectiveKeys
        .map(k => reach!.best.get(k)?.timeSeconds)
        .filter((t): t is number => typeof t === 'number' && isFinite(t));
      if (objectiveTimes.length > 0) {
        const thisCostStar = Math.min(...objectiveTimes);
        costStar = costStar === undefined ? thisCostStar : Math.min(costStar, thisCostStar);
      }
    }

    // Once a route exists, check whether enough genuinely distinct avenues
    // have been found yet (docs §35 design point 3) — this is the PRIMARY
    // stop rule; the frontier/ceiling checks below are the safety bounds
    // behind it, exactly as designed.
    if (path && costStar !== undefined) {
      corridorCountAtStop = estimateDistinctCorridorCount(
        allCells, originKeys, objectiveKeys, profile, options.nightMode, hexSize
      );
      if (corridorCountAtStop >= MIN_TARGET_CORRIDORS || corridorCountAtStop >= MAX_TARGET_CORRIDORS) {
        break; // 2–5 distinct corridors confirmed — done
      }
      onLog?.(
        `ROUTE FOUND (${(costStar / 60).toFixed(0)} MIN) BUT ONLY ${corridorCountAtStop} DISTINCT CORRIDOR(S) SO FAR — ` +
        `WIDENING WITHIN α×C* (${alpha}×${(costStar / 60).toFixed(0)} MIN) TO LOOK FOR MORE`
      );
    }

    // Which tiles does the reachable frontier actually border? Only cells
    // this round's search could reach at all are relevant — an unreached
    // cell's neighbours say nothing about where growth would help (matches
    // `frontierTouchedEdges`'s own "unreachable cells don't count" rule from
    // the old fixed-box approach). Once C* is known (Phase 2), a cell beyond
    // the α·C* travel-time budget doesn't get to pull in new tiles either —
    // the self-sizing cost-budget "ellipse" (docs §35 design point 2) falls
    // straight out of this filter rather than needing separate geometry.
    const nextNeeded = new Set<string>();
    for (const [key, arrival] of reach.best) {
      if (costStar !== undefined && arrival.timeSeconds > alpha * costStar) continue;
      const cell = materialized.get(key);
      if (!cell) continue;
      for (const nHex of hexNeighbors(cell.hex)) {
        const nKey = hexKey(nHex);
        if (materialized.has(nKey)) continue;
        const idx = tileIndexOfLocal(axialToLocal(nHex, hexSize), tileSizeM);
        const tk = tileKeyOf(idx.tx, idx.ty);
        if (!materializedTiles.has(tk)) nextNeeded.add(tk);
      }
    }

    if (nextNeeded.size === 0) break; // enclosed by terrain, or (Phase 2) genuinely exhausted the α·C* budget
    if (materialized.size >= cellCeiling || materializedTiles.size >= tileCeiling || round >= MAX_LAZY_ROUNDS) {
      hitCeiling = true;
      break;
    }
    if (!path) {
      onLog?.(`NO ROUTE YET — MATERIALISING ${nextNeeded.size} MORE TILE(S) TOWARD THE REACHABLE FRONTIER (ROUND ${round + 1})`);
    }
    neededTiles = nextNeeded;
  }

  const allCells = Array.from(materialized.values());
  if (allCells.length === 0) return null;
  if (!reach) {
    // Should be unreachable in practice (the loop always runs at least one
    // round before it can break), kept only so TS sees every path assigns.
    reach = { best: new Map(), prev: new Map() };
  }

  let boundsMinLat = Infinity, boundsMaxLat = -Infinity, boundsMinLng = Infinity, boundsMaxLng = -Infinity;
  for (const c of allCells) {
    if (c.center.lat < boundsMinLat) boundsMinLat = c.center.lat;
    if (c.center.lat > boundsMaxLat) boundsMaxLat = c.center.lat;
    if (c.center.lng < boundsMinLng) boundsMinLng = c.center.lng;
    if (c.center.lng > boundsMaxLng) boundsMaxLng = c.center.lng;
  }

  const grid: MobilityGridResult = {
    cells: allCells,
    hexSize,
    proj,
    originKeys,
    objectiveKeys,
    observerKeys,
    usedEstimatedData,
    infrastructureAvailable,
    hydrologyAvailable,
    waterFeatures,
    roadWays,
    usedCoarseGrid: false, // this path never coarsens hex size — growth is by tile, not by enlarging cells
    boundsPadFactor: INITIAL_PAD_FACTOR,
    boundsSw: { lat: boundsMinLat, lng: boundsMinLng },
    boundsNe: { lat: boundsMaxLat, lng: boundsMaxLng },
    fidelity,
    targetCellCount,
  };

  return {
    grid, results, path, roundsUsed: round, tilesUsed: materializedTiles.size, hitCeiling,
    costStarSeconds: costStar ?? null,
    corridorCountAtStop,
  };
}

/** Diminishing-returns progress curve — see `LazyMobilitySearchOptions.onProgress`'s
 *  doc comment for why. `withinRound` is 0..1 progress through round `round`'s
 *  own sampling+search. */
function roundProgress(round: number, withinRound: number): number {
  const roundBase = 1 - Math.pow(0.5, round - 1);
  const roundSpan = Math.pow(0.5, round - 1);
  return roundBase + roundSpan * Math.max(0, Math.min(1, withinRound));
}
