/**
 * Corridor field — turning many individual routes into presentable MOVEMENT
 * CORRIDORS (owner, 2026-07-26: "smooth out the potential paths that someone
 * might move through the terrain, noting there will be several, across a
 * large area, and present them as sensibly displayed corridors of possible
 * movement rather than the single optimal path. Use the individual pathways
 * to analyse, corridors for likely results / ease of movement.").
 *
 * WHY THIS EXISTS, and why it is an honesty improvement rather than just a
 * prettier render: a single cheapest-path polyline implies survey precision
 * this product does not have and never claims (docs §10 — Tier 0/1 data
 * cannot resolve a 30 m drivable lane). A corridor BAND is the honest
 * spatial statement: "movement through this area will happen somewhere in
 * here, most probably along its spine." Doctrine agrees — a mobility
 * corridor is a band, an avenue of approach is a band; a line is a route
 * order, which is a different (later, scouted) product. So the analysis is
 * done on individual routes, where the maths is exact, and the PRESENTATION
 * is a corridor, where the uncertainty is visible. Docs §4/§6, §13.
 *
 * PIPELINE (every step over data already computed, no new source):
 *   1. k routes from `findKDissimilarPaths` (iterative-penalty re-search).
 *   2. Weighted density per cell — a route contributes to every cell it
 *      crosses, weighted by how ATTRACTIVE it is (best-route time ÷ this
 *      route's time), so a route 2× slower than the best counts half. That
 *      weight is a real computed ratio, not an invented rank decay.
 *   3. Smoothing — discrete Laplacian diffusion over hex adjacency. This is
 *      the "smooth out the potential paths" step: it turns k thin lines into
 *      a continuous field whose fuzzy edges genuinely represent "we don't
 *      know exactly where within this band".
 *   4. Segmentation — connected components (hex adjacency) of the smoothed
 *      field above a fraction of its own peak. Each component is a corridor.
 *   5. Per-corridor metrics — width/bottleneck from ISO-ARRIVAL-TIME slices
 *      (the same principle the isochrone bands already use: arrival time
 *      rises monotonically along travel, so an iso-time band through a
 *      corridor is a cross-section of it), ease from the real GO/SLOW-GO
 *      mix, share-of-routes from the real route set.
 *
 * ITERATIVE BY CONSTRUCTION (owner: "this analysis may need to be
 * iterative", and the ground-commander loop of propose → assess → revise):
 * every function here takes an `edgePenalties` map straight through to the
 * same search the baseline uses, so "corridors WITH these counter-measures
 * emplaced" is the identical computation with a different edge-cost view —
 * never a separate estimate that could disagree with the baseline.
 * `compareCorridorFields` then diffs the two runs into per-corridor effects
 * (collapsed / degraded / displaced-into), which is what actually answers
 * "what does my counter-measure DO to their movement", as opposed to the
 * delay-ledger's per-measure seconds.
 */

import { LatLng } from './chainage';
import {
  MobilityGridCell, runAccumulatedCostSearch, extractPath, AccumulatedCostSearchOptions, toMobilitySample,
  carriesWaterSignal,
} from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { LocalProjection, axialToLocal, hexCorners, toLatLng, hexKey, hexNeighbors } from './hexGrid';
import { DissimilarRoute, findKDissimilarPaths } from './corridorAnalysis';
import { edgeMobilityCost, TrafficabilityClass } from './mobilityCost';
import { calculateDistance } from './geo';
import { MobilityClass } from './mobilityClass';

/** How many distinct routes to derive before forming corridors. A handful of
 *  routes gives lines; a dozen-plus gives a band with a real shape. Each
 *  route is one exhaustive search over the grid (see the note on cost in
 *  `buildCorridorField`), which is why this is a bounded constant rather
 *  than "as many as possible". */
export const DEFAULT_CORRIDOR_ROUTE_COUNT = 14;

export interface CorridorFieldOptions {
  /** Laplacian diffusion passes. More = smoother/wider bands, less spatial
   *  precision claimed. 3 is enough to merge adjacent routes into one band
   *  without smearing genuinely separate corridors together. */
  smoothingIterations?: number;
  /** Per-pass share of a cell's new value taken from its neighbours' mean
   *  (0 = no smoothing, 1 = fully replaced by the neighbour mean). */
  smoothingWeight?: number;
  /** A cell joins a corridor when its smoothed density reaches this fraction
   *  of the field's own peak. Lower = wider, more inclusive corridors. */
  membershipThreshold?: number;
  /** Iso-arrival-time slices used to measure corridor width/bottleneck. */
  widthSlices?: number;
  /** Corridors smaller than this many cells are dropped as noise rather than
   *  reported as a real avenue of approach. */
  minCorridorCells?: number;
}

const DEFAULTS = {
  smoothingIterations: 3,
  smoothingWeight: 0.5,
  membershipThreshold: 0.12,
  widthSlices: 18,
  minCorridorCells: 4,
};

export interface CorridorCell {
  key: string;
  center: LatLng;
  polygon: LatLng[];
  /** Smoothed density, normalised 0..1 against this field's own peak. Drives
   *  the band's opacity gradient — the visual honesty signal. */
  density: number;
  /** How many raw routes crossed this EXACT cell before smoothing. 0 is
   *  normal and expected for a cell that is in the band only because
   *  smoothing carried density into it — that distinction is exactly what
   *  keeps "analysed" separate from "inferred". */
  routeCount: number;
}

/**
 * Kept as a re-export for existing callers — the canonical definition now
 * lives in `mobilityClass.ts` (OCOKA 1, docs/ROUTE_INTELLIGENCE.md §47),
 * collapsing this module's `'open'`/… corridor vocabulary and
 * `mobilityCost.ts`'s edge vocabulary onto one union. `'open'` becomes
 * `'unrestricted'`.
 */
export type CorridorEaseClass = MobilityClass;

/**
 * "Avenues of approach sized by echelon" (roadmap Pass 2, docs §15.2) —
 * delivered as far as the data honestly allows, and no further.
 *
 * WHAT IS REAL HERE: `abreast` is arithmetic over two real numbers — the
 * corridor's grid-resolution-limited bottleneck width, and the mover
 * profile's own `widthM`. Nothing is inferred.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED: a doctrinal echelon label (platoon /
 * company / battalion frontage) is NOT asserted, because translating
 * "n vehicles abreast" into an echelon needs sourced doctrinal frontage and
 * march-spacing figures, and none were sourced for this product (docs §11.2
 * sources march RATES, not frontages). Reporting "company-sized avenue"
 * off unsourced arithmetic would be exactly the invented-precision this
 * project forbids. Likewise absent: column throughput per hour, which needs
 * those same spacing figures, and VCI₁/VCI₅₀ pass verdicts, which need the
 * soil data Pass 3 has not sampled yet.
 */
export type CorridorFrontage = 'single-file' | 'two-abreast' | 'multi-lane';

export interface Corridor {
  id: string;
  /** 1 = carries the most (weighted) movement. */
  rank: number;
  cells: CorridorCell[];
  /** Distinct routes from the analysed set that use any cell in this corridor. */
  routeCount: number;
  /** Share of the analysed route set using this corridor (0..1). */
  shareOfRoutes: number;
  /** Median / fastest total origin→objective time among routes through it. */
  medianTravelSeconds: number;
  fastestTravelSeconds: number;
  /** Narrowest iso-arrival-time cross-section, in cells and in metres. The
   *  metres figure is `cells × hex width` — a grid-resolution-limited
   *  estimate, NOT a surveyed gap width (docs §10.4: deriving real gap width
   *  is its own research task). Treat as "about this wide, at this grid
   *  resolution". */
  bottleneckCells: number;
  bottleneckWidthM: number;
  /** The exact cell keys making up the corridor's own narrowest iso-arrival-
   *  time slice — i.e. `bottleneckCells` cells, named rather than merely
   *  counted. Added for OCOKA 4 (docs/ROUTE_INTELLIGENCE.md §47.1), which
   *  needs to test "denial of this exact ground", not just its width. Falls
   *  back to every cell in the corridor under the same condition
   *  `bottleneckCells` itself falls back to `cells.length` (fewer than two
   *  finite arrival times, or a zero-span bucket set) — the whole corridor
   *  is the only honest "slice" available in that case. */
  bottleneckCellKeys: string[];
  widestCells: number;
  widestWidthM: number;
  /** How many of THIS mover fit side by side through the bottleneck —
   *  `floor(bottleneckWidthM / profile.widthM)`, arithmetic over two real
   *  numbers. See `CorridorFrontage` for what is deliberately not claimed
   *  on top of this. */
  bottleneckAbreast: number;
  frontage: CorridorFrontage;
  /** Real fractions over the corridor's own cells. */
  unrestrictedFraction: number;
  restrictedFraction: number;
  severelyRestrictedFraction: number;
  easeClass: CorridorEaseClass;
  /** This corridor's OWN narrowest iso-arrival-time cross-section ÷ its
   *  widest (docs §35 remainder — the field-level `CorridorField.pinchRatio`
   *  only ever covered the busiest corridor; siting/risk questions need every
   *  corridor's own throat, not just corridor 1's). Low = a real single
   *  point of failure somewhere along it; near 1 = uniformly wide, never
   *  pinches. Feeds `riskScore` below. */
  pinchRatio: number;
  /** Fraction of this corridor's own cells carrying a real water signal
   *  (`carriesWaterSignal` — standing water, a mapped watercourse within
   *  snap distance, or high DEA WOfS wet-frequency; docs §34). A genuine,
   *  already-sampled per-cell fact, aggregated here rather than computed
   *  fresh — feeds `riskScore` below. */
  waterCrossingFraction: number;
  /**
   * Composite hazard/vulnerability score, 0..1 — the basis for
   * `CorridorField.mostRiskyCorridorId` (docs §35 remainder, owner: "we
   * should be seeing a 'most likely' and 'most risky' type of option to
   * inform our planning"). Built ENTIRELY from real, already-computed
   * per-corridor fractions — no new source, no invented signal:
   *
   *   riskScore = 0.4 × (restrictedFraction + severelyRestrictedFraction)   — terrain hazard
   *             + 0.3 × waterCrossingFraction                                — fording exposure
   *             + 0.3 × (1 − pinchRatio)                                     — single-point-of-failure throat
   *
   * The WEIGHTS are this product's own engineering judgement over its own
   * computed mix — the identical honesty framing `easeClass`'s thresholds
   * already carry ("doctrinal-flavoured wording, but... deliberately NOT
   * presented as a doctrinal classification"), stated here rather than
   * implied. `severelyRestrictedFraction` counting toward hazard (rather than
   * being excluded as "already avoided") is deliberate: a corridor with real
   * severely-restricted cells along its band is one whose passable line has
   * less lateral room to route around a newly-found obstacle than a corridor
   * that is unrestricted throughout, which is itself a real vulnerability.
   * Not a probability, not validated against any incident data — a relative,
   * WITHIN-THIS-RUN ranking signal only, exactly like `easeClass`. */
  riskScore: number;
  /** True when ANY cell in this corridor carries estimated/fallback sample
   *  data — surfaced per corridor so a caveat lands on the specific corridor
   *  it applies to, not just once for the whole run. */
  usedEstimatedData: boolean;
  /** The single FASTEST analysed route that actually uses this corridor —
   *  the one real hairline worth drawing for it, rather than every route in
   *  the analysed set (docs §28 addendum, 2026-07-28: "the individual white
   *  lines of the considered paths don't work as a visualisation... they
   *  need to be consolidated to show substantive differences in the
   *  pathways / corridors, not show that every piece of ground has been
   *  considered"). Null only when the corridor's own `routeCount` is
   *  somehow 0 (should not happen in practice — a corridor without any
   *  route crossing it would not have formed). Still rides hex cell
   *  centres; presentation-side smoothing/road-snapping (`pathRefinement.ts`)
   *  is applied by the caller, not here — this module stays geometry-of-
   *  record, not a rendering decision. */
  representativeRoute: DissimilarRoute | null;
}

/**
 * What the corridors were derived FROM. This has to be carried and shown,
 * because the two answer subtly different questions and a reader must not
 * confuse them:
 *
 *  - 'optimiser-routes' — k globally-cheapest routes under iterative edge
 *    penalties. "Where the best routes are." Perfect knowledge assumed.
 *  - 'simulated-movers' — the transit frequency of an ensemble of independent,
 *    boundedly-rational movers (movementSimulation.ts). "Where movers actually
 *    went." Includes their road preference, their imperfect knowledge, and
 *    their mistakes — and is therefore MODELLED BEHAVIOUR, with all the
 *    assumed parameters that module documents.
 */
export type CorridorEvidence = 'optimiser-routes' | 'simulated-movers';

export interface CorridorField {
  corridors: Corridor[];
  evidence: CorridorEvidence;
  /** The route set the corridors were formed from — kept so the UI can draw
   *  the individual pathways faintly INSIDE the bands ("the analysis is
   *  visible underneath the presentation"). */
  routes: DissimilarRoute[];
  /** Every cell that reached corridor membership, across all corridors. */
  cellCount: number;
  /** Cells that at least one raw route actually crossed (pre-smoothing) — the
   *  honest "measured" count, vs `cellCount`'s "measured + smoothed into". */
  routedCellCount: number;
  peakDensity: number;
  /** Corridor cells ÷ total sampled cells. */
  coverageFraction: number;
  /** Busiest corridor's narrowest cross-section ÷ its widest. Low = the
   *  corridor has a real throat somewhere (the ground a commander wants);
   *  near 1 = it is uniformly wide and never pinches. */
  pinchRatio: number;
  /**
   * True when movement is effectively UNCONSTRAINED — the route set spreads
   * across so much of the area that "corridors" is not an honest description
   * of it (found while testing this module against a featureless plain: 14
   * distinct routes covered 304 of 305 cells, and the segmentation duly
   * reported "one corridor" containing the entire AOI, which is arithmetically
   * correct and operationally useless).
   *
   * This is a REAL AND IMPORTANT FINDING for the ground-commander use case,
   * not an error to hide: terrain that does not canalise movement cannot be
   * denied by siting obstacles at chokepoints, because there are none —
   * denial there needs observation and fires, or a continuous barrier, which
   * is a completely different (and far more expensive) course of action. So
   * the UI must say "unconstrained" rather than draw corridor bands that
   * imply structure the terrain does not have.
   */
  unconstrained: boolean;
  options: Required<CorridorFieldOptions>;
  /** The rank-1 corridor's own id — carries the most (weighted) movement,
   *  i.e. where movement is MOST LIKELY to actually happen (docs §35
   *  remainder). Null only when `corridors` is empty (can't happen given
   *  `buildCorridorField` returns null in that case instead, but kept
   *  optional-safe rather than a non-null assertion). Equal to
   *  `mostRiskyCorridorId` when only one corridor exists — both labels are
   *  honestly the same ground when there is only one way through. */
  mostLikelyCorridorId: string | null;
  /** The corridor with the highest `riskScore` — the avenue MOST WORTH
   *  planning around (worse terrain, more water crossings, or a real
   *  single-point-of-failure throat), not necessarily the one movement is
   *  most likely to use. Deliberately independent of `rank`: the busiest
   *  corridor is very often also the easiest (that is usually WHY it is
   *  busiest), so the two ids commonly point at different corridors — that
   *  divergence is the whole value of showing both. */
  mostRiskyCorridorId: string | null;
}

/**
 * Degeneracy test, two conditions that must BOTH hold — coverage alone is
 * not enough, and testing it alone was a real bug caught in the smoke test:
 * a synthetic ridge with one genuine 3-cell gap still covered 80% of the
 * area (routes fan out across open ground either side before funnelling
 * through), so a coverage-only rule called that "unconstrained" while it
 * plainly had the most important chokepoint on the map.
 *
 *  1. Bands cover most of the area, AND
 *  2. the busiest corridor never actually PINCHES — its narrowest
 *     cross-section is still a large fraction of its widest.
 *
 * Condition 2 is what makes this meaningful: "wide everywhere" is
 * unconstrained; "wide but with a throat" is exactly the terrain a commander
 * wants to find.
 */
const UNCONSTRAINED_COVERAGE_THRESHOLD = 0.6;
const UNCONSTRAINED_PINCH_RATIO = 0.35;

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

/** Per-cell arrival time and trafficability, from one baseline search +
 *  classification — the inputs corridor metrics are measured against. */
interface CellFacts {
  arrivalSeconds: Map<string, number>;
  trafficability: Map<string, TrafficabilityClass>;
}

function computeCellFacts(
  cells: MobilityGridCell[],
  originKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  edgePenalties?: Map<string, number>
): CellFacts {
  const reach = runAccumulatedCostSearch(cells, originKeys, profile, nightMode, { edgePenalties });
  const arrivalSeconds = new Map<string, number>();
  for (const [key, v] of reach.best) arrivalSeconds.set(key, v.timeSeconds);

  // Per-cell trafficability from the profile's OWN worst outbound edge — the
  // same edgeMobilityCost the search uses, so a cell can never be coloured
  // unrestricted here while the search treats every way out of it as
  // severely restricted.
  const byKey = new Map(cells.map(c => [c.key, c]));
  const trafficability = new Map<string, TrafficabilityClass>();
  for (const cell of cells) {
    let worst: TrafficabilityClass = 'severely-restricted';
    let anyPassable = false;
    for (const nHex of hexNeighbors(cell.hex)) {
      const n = byKey.get(hexKey(nHex));
      if (!n) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, n.center.lat, n.center.lng);
      const r = edgeMobilityCost(
        profile,
        toMobilitySample(cell),
        toMobilitySample(n),
        dist,
        { nightMode, crossSlopeDeg: cell.crossSlopeDeg }
      );
      if (r.trafficability === 'unrestricted') { worst = 'unrestricted'; anyPassable = true; break; }
      if (r.trafficability === 'restricted') { worst = 'restricted'; anyPassable = true; }
    }
    trafficability.set(cell.key, anyPassable ? worst : 'severely-restricted');
  }
  return { arrivalSeconds, trafficability };
}

/** Discrete Laplacian smoothing over hex adjacency — the "smooth out the
 *  potential paths" step. Pure; returns a new map each pass. */
function smoothOverHexGrid(
  raw: Map<string, number>,
  cells: MobilityGridCell[],
  iterations: number,
  weight: number
): Map<string, number> {
  // Precomputed adjacency over cells that actually EXIST in the grid. A
  // boundary cell must not be dragged toward zero by phantom off-grid
  // neighbours — that would carve a false low-density rim around the whole
  // AOI and shrink every corridor that touches the edge.
  const present = new Set(cells.map(c => c.key));
  const adjacency = new Map<string, string[]>();
  for (const cell of cells) {
    adjacency.set(cell.key, hexNeighbors(cell.hex).map(hexKey).filter(k => present.has(k)));
  }

  let current = new Map(raw);
  for (let it = 0; it < iterations; it++) {
    const next = new Map<string, number>();
    for (const cell of cells) {
      const self = current.get(cell.key) ?? 0;
      const neighbours = adjacency.get(cell.key) ?? [];
      let sum = 0;
      for (const nKey of neighbours) sum += current.get(nKey) ?? 0;
      const neighbourMean = neighbours.length > 0 ? sum / neighbours.length : self;
      next.set(cell.key, (1 - weight) * self + weight * neighbourMean);
    }
    current = next;
  }
  return current;
}

/** Which normalised progress fractions along each route are sampled to test
 *  whether two routes represent the same avenue (see `clusterRoutes`). Three
 *  points rather than one: a route's start/end are always near the shared
 *  origin/objective AOI regardless of which avenue it takes, so the
 *  discriminating evidence sits in the MIDDLE of the crossing — but a single
 *  midpoint sample would miss a detour whose divergence isn't centred at
 *  exactly 50%. */
const ROUTE_CLUSTER_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

/** How many hex-widths apart two routes' sampled points may be and still
 *  count as "the same avenue, wiggling" rather than "a different avenue"
 *  (docs §35/§28 addendum, 2026-07-27 — see `clusterRoutes`'s own doc
 *  comment for why this replaced a cell-overlap measure). Calibrated
 *  against a synthetic two-gap grid (`corridorClustering.test.ts`): routes
 *  sharing a real avenue never sampled more than ~5.3 hex-widths apart at
 *  ANY of the three fractions, while routes on genuinely different avenues
 *  were never LESS than ~8.6 hex-widths apart at every fraction
 *  simultaneously — this sits centred in that gap. */
const ROUTE_CLUSTER_DISTANCE_HEX_MULTIPLIER = 7;

/** Sample a route's position at a normalised progress fraction along its own
 *  path (index-based — search paths step one hex per node, so index
 *  fraction and distance fraction track closely enough for this purpose). */
function sampleRoutePoint(route: DissimilarRoute, fraction: number): LatLng {
  const path = route.path;
  const idx = Math.min(path.length - 1, Math.max(0, Math.round(fraction * (path.length - 1))));
  return path[idx];
}

/**
 * Group routes into corridor clusters by SPATIAL proximity at sampled
 * progress fractions — the segmentation-time fix for a real, reproducible
 * defect (owner, 2026-07-27, live-testing a west<->east Lake George crossing
 * with visibly distinct east-shore and west-shore detour tracks on the map:
 * "it only generated 1 corridor, we need two minimum... consider how
 * corridors and alternative pathways are explored and identified").
 *
 * WHY THIS HAS TO HAPPEN BEFORE any spatial segmentation: every route
 * between the SAME origin and objective necessarily SHARES cells at both
 * ends (they all start in the origin AOI and end in the objective AOI). A
 * segmentation pass that connects any two geometrically-adjacent
 * high-density cells will therefore always find the west-shore and
 * east-shore routes connected to EACH OTHER through those shared endpoints
 * — collapsing two genuinely distinct avenues of approach into one
 * connected component. That is not an edge case; it is the normal shape of
 * the problem whenever origin/objective are compact areas (the usual case),
 * which is exactly why it reproduced on the very first live geometry that
 * had two real detours to find.
 *
 * FIRST ATTEMPT (superseded): Jaccard cell-set overlap (|A∩B| / |A∪B|).
 * Measured against the synthetic two-gap fixture, this proved inadequate —
 * on open terrain, routes have huge freedom to wiggle through unconstrained
 * ground even while representing the same avenue, so same-avenue route
 * pairs scored as low as 0.09-0.20 Jaccard, barely distinguishable from
 * genuinely cross-avenue pairs (0.00-0.08). No single threshold separated
 * them cleanly, which is exactly what the two `corridorClustering.test.ts`
 * failures this caused were showing (over-fragmentation on a single real
 * avenue; unreliable top-rank selection).
 *
 * CURRENT APPROACH: sample each route's actual lat/lng at three normalised
 * progress fractions and compare GEOGRAPHIC distance between corresponding
 * points, unanimously across all three fractions (a route's start and end
 * are always near the shared AOIs regardless of avenue, so a majority vote
 * can be won by two agreeing endpoint samples even when the middle — where
 * the real divergence is — disagrees; requiring all three closes that gap).
 * Measured against the same fixture, this separates same-avenue from
 * cross-avenue pairs with a clean, un-overlapping margin (worst same-avenue
 * pair: every sample within ~273 m; best-separated cross-avenue pair: every
 * sample at least ~449 m apart) — see `ROUTE_CLUSTER_DISTANCE_HEX_MULTIPLIER`.
 *
 * Union-find over that unanimous spatial-proximity test — two routes merge
 * into the same cluster only if they track close to each other along their
 * whole middle, not merely because they touch the same launching point.
 *
 * COST NOTE: O(n²) route-pairs, each a fixed 3-point distance check — at
 * `DEFAULT_CORRIDOR_ROUTE_COUNT` (14) this is trivial; at the movement
 * ensemble's mover count (a few hundred tracks) it is still well under a
 * second at this product's grid scale, the same "linear/quadratic but
 * bounded" cost discipline `buildCorridorField`'s own note already applies
 * to k.
 */
/** Exported so `mobilityLazyGrid.ts` can reuse the SAME avenue-clustering
 *  test to decide whether the search has found ENOUGH distinct corridors yet
 *  (docs §35 design point 3: "stop on corridor count, not path count") —
 *  the identical similarity test the final presentation build uses, not a
 *  second, possibly-disagreeing approximation. */
export function clusterRoutes(routes: DissimilarRoute[], hexWidthM: number): number[][] {
  const n = routes.length;
  const thresholdM = hexWidthM * ROUTE_CLUSTER_DISTANCE_HEX_MULTIPLIER;
  const samples = routes.map(r => ROUTE_CLUSTER_SAMPLE_FRACTIONS.map(f => sampleRoutePoint(r, f)));
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sameAvenue = true;
      for (let f = 0; f < ROUTE_CLUSTER_SAMPLE_FRACTIONS.length; f++) {
        const pa = samples[i][f];
        const pb = samples[j][f];
        if (calculateDistance(pa.lat, pa.lng, pb.lat, pb.lng) > thresholdM) { sameAvenue = false; break; }
      }
      if (sameAvenue) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  return [...groups.values()];
}

/**
 * Build the smoothed movement-density field and segment it into ranked
 * corridors. `edgePenalties` flows straight through to the SAME search the
 * baseline uses, which is what makes the counter-measure ("with these
 * obstacles emplaced") case identical maths rather than a separate estimate.
 *
 * COST NOTE: `k` exhaustive searches (one per route) plus one for cell facts.
 * At the grid sizes this mode caps at (docs §8 / mobilityGrid.ts), each is a
 * few milliseconds, so the default k of 14 is well inside a frame budget's
 * worth of work — but it IS linear in k, which is why k is a bounded
 * constant and not unbounded.
 */
export function buildCorridorField(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  hexSize: number,
  proj: LocalProjection,
  options: CorridorFieldOptions & {
    routeCount?: number;
    edgePenalties?: Map<string, number>;
    /**
     * Use THESE paths as the evidence instead of deriving k cheapest routes.
     * The presentation pipeline below (density → smooth → segment → metrics)
     * does not care where the paths came from, which is what lets the
     * simulated movement ensemble become the evidence base for what is shown
     * without a second, parallel corridor implementation that could disagree
     * with this one.
     */
    routesOverride?: DissimilarRoute[];
    evidence?: CorridorEvidence;
    /**
     * Weight each path by how attractive it is (best time ÷ this path's time).
     * Correct for OPTIMISER routes, where one route standing for "the second
     * best way" should not count as much as the best. Wrong for a SIMULATED
     * ensemble, where each mover is one independent observation and the
     * frequency itself is the evidence — so this defaults to true but is set
     * false for ensemble input.
     */
    weightByAttractiveness?: boolean;
  } = {}
): CorridorField | null {
  const opts: Required<CorridorFieldOptions> = {
    smoothingIterations: options.smoothingIterations ?? DEFAULTS.smoothingIterations,
    smoothingWeight: options.smoothingWeight ?? DEFAULTS.smoothingWeight,
    membershipThreshold: options.membershipThreshold ?? DEFAULTS.membershipThreshold,
    widthSlices: options.widthSlices ?? DEFAULTS.widthSlices,
    minCorridorCells: options.minCorridorCells ?? DEFAULTS.minCorridorCells,
  };
  const routeCount = options.routeCount ?? DEFAULT_CORRIDOR_ROUTE_COUNT;

  const routes = options.routesOverride ?? findKDissimilarPaths(
    cells, originKeys, objectiveKeys, profile, nightMode, routeCount, options.edgePenalties
  );
  if (routes.length === 0) return null;
  const evidence: CorridorEvidence = options.evidence ?? 'optimiser-routes';
  const weightByAttractiveness = options.weightByAttractiveness ?? true;

  const facts = computeCellFacts(cells, originKeys, profile, nightMode, options.edgePenalties);
  const byKey = new Map(cells.map(c => [c.key, c]));
  const bestSeconds = Math.min(...routes.map(r => r.totalSeconds));
  const hexWidthM = hexSize * Math.sqrt(3); // pointy-top hex flat-to-flat width

  // --- Cluster ROUTES first, by cell-overlap similarity — NOT a single
  // global density-then-segment pass (owner, 2026-07-27, live-testing a real
  // west<->east Lake George crossing with genuinely distinct east-shore and
  // west-shore detours visible on the map: "it only generated 1 corridor, we
  // need two minimum... consider how corridors and alternative pathways are
  // explored and identified.").
  //
  // THE BUG a single global pass has: every route between the SAME origin
  // and objective necessarily SHARES cells at both ends (they all start in
  // the origin AOI and end in the objective AOI). Segmenting the density
  // field by raw hex adjacency therefore always finds the west-shore and
  // east-shore routes connected to EACH OTHER through those shared
  // endpoints, collapsing two genuinely distinct avenues of approach into
  // one connected component. This is not an edge case — it is the NORMAL
  // shape of the problem whenever origin/objective are compact areas (the
  // usual case), which is why it reproduced immediately on real data.
  //
  // Fix: group routes by SPATIAL proximity at sampled progress fractions
  // before any spatial segmentation (see `clusterRoutes`'s doc comment for
  // why cell-overlap similarity was tried first and abandoned). Two routes
  // join the same corridor only if they track close to each other along
  // their whole middle, not merely because they touch the same launching
  // point. Density/smoothing/segmentation then run PER CLUSTER, so one
  // cluster's shared start/end cells can never bridge it to a DIFFERENT
  // cluster's cells — they were never part of that cluster's density source
  // to begin with.
  const routeClusters = clusterRoutes(routes, hexWidthM);

  // Global peak across ALL clusters (not each cluster's own) — so a minor
  // corridor still reads dimmer than the primary one, preserving the
  // cross-corridor relative-importance signal the density gradient carries.
  const clusterRaw: { indices: number[]; raw: Map<string, number>; rawRouteCount: Map<string, number>; routesByCell: Map<string, Set<number>> }[] = [];
  let peak = 0;
  for (const indices of routeClusters) {
    const raw = new Map<string, number>();
    const rawRouteCount = new Map<string, number>();
    const routesByCell = new Map<string, Set<number>>();
    for (const idx of indices) {
      const route = routes[idx];
      const weight = weightByAttractiveness
        ? (route.totalSeconds > 0 ? Math.max(0.05, bestSeconds / route.totalSeconds) : 1)
        : 1;
      for (const key of new Set(route.keys)) {
        raw.set(key, (raw.get(key) ?? 0) + weight);
        rawRouteCount.set(key, (rawRouteCount.get(key) ?? 0) + 1);
        if (!routesByCell.has(key)) routesByCell.set(key, new Set());
        routesByCell.get(key)!.add(idx);
      }
    }
    clusterRaw.push({ indices, raw, rawRouteCount, routesByCell });
  }
  const clusterSmoothed = clusterRaw.map(c => smoothOverHexGrid(c.raw, cells, opts.smoothingIterations, opts.smoothingWeight));
  for (const smoothedMap of clusterSmoothed) {
    for (const v of smoothedMap.values()) if (v > peak) peak = v;
  }
  if (peak <= 0) return null;

  const cutoff = peak * opts.membershipThreshold;
  const built: Corridor[] = [];
  clusterRaw.forEach((c, ci) => {
    const smoothed = clusterSmoothed[ci];
    const member = new Set<string>();
    for (const [key, v] of smoothed) {
      if (v >= cutoff && byKey.has(key)) member.add(key);
    }
    if (member.size === 0) return;

    // Connected components WITHIN this cluster's own members — a cluster
    // whose routes are themselves disjoint bundles (possible with a loose
    // similarity threshold via transitive chaining) still correctly splits
    // into more than one corridor here, same as the original single-pass
    // logic did, just now scoped to routes that actually resemble each other.
    const seen = new Set<string>();
    for (const key of member) {
      if (seen.has(key)) continue;
      const comp: string[] = [];
      const queue = [key];
      seen.add(key);
      while (queue.length > 0) {
        const cur = queue.pop()!;
        comp.push(cur);
        const cell = byKey.get(cur);
        if (!cell) continue;
        for (const nHex of hexNeighbors(cell.hex)) {
          const nKey = hexKey(nHex);
          if (member.has(nKey) && !seen.has(nKey)) { seen.add(nKey); queue.push(nKey); }
        }
      }
      if (comp.length < opts.minCorridorCells) continue;
      built.push(buildCorridor(
        `corridor-${built.length}`, comp, byKey, smoothed, c.rawRouteCount, c.routesByCell, routes, facts, peak, hexSize, hexWidthM, proj, opts, profile
      ));
    }
  });

  if (built.length === 0) return null;

  // Rank by weighted movement carried, not raw cell count — a short fat
  // component that few routes use is not the primary avenue of approach.
  built.sort((a, b) => b.routeCount - a.routeCount || b.cells.length - a.cells.length);
  built.forEach((c, i) => { c.id = `corridor-${i}`; c.rank = i + 1; });

  const cellCount = built.reduce((s, c) => s + c.cells.length, 0);
  const coverageFraction = cells.length > 0 ? cellCount / cells.length : 0;
  const busiest = built[0];
  const pinchRatio = busiest.widestCells > 0 ? busiest.bottleneckCells / busiest.widestCells : 1;

  // Distinct cells at least one raw route crossed, across ALL clusters —
  // the honest "measured" count (vs `cellCount`'s "measured + smoothed
  // into"). Union rather than a single map's size now that density is
  // computed per-cluster.
  const routedCellCount = new Set(clusterRaw.flatMap(c => [...c.rawRouteCount.keys()])).size;

  // "Most likely" is simply rank 1 — already the corridor carrying the most
  // weighted movement, by construction of the sort above. "Most risky" is
  // whichever corridor's OWN `riskScore` is highest, independent of rank —
  // see `Corridor.riskScore`'s own doc comment for the formula and why it is
  // deliberately not the same signal as "busiest".
  const mostLikelyCorridorId = built[0]?.id ?? null;
  const mostRiskyCorridorId = built.reduce(
    (best, c) => (best === null || c.riskScore > best.riskScore ? c : best),
    null as Corridor | null
  )?.id ?? null;

  return {
    corridors: built,
    evidence,
    routes,
    cellCount,
    routedCellCount,
    peakDensity: peak,
    coverageFraction,
    pinchRatio,
    unconstrained:
      coverageFraction >= UNCONSTRAINED_COVERAGE_THRESHOLD && pinchRatio > UNCONSTRAINED_PINCH_RATIO,
    options: opts,
    mostLikelyCorridorId,
    mostRiskyCorridorId,
  };
}

/**
 * Adapt simulated mover tracks into the same `DissimilarRoute` shape the
 * corridor pipeline already consumes, so an ensemble can be fed straight into
 * `buildCorridorField({ routesOverride })`.
 *
 * `path` is rebuilt from the mover's own cell sequence with its own cumulative
 * times, so the hairlines drawn inside a band really are the simulated tracks —
 * not a re-derived or smoothed version of them.
 */
export function ensembleTracksToRoutes(
  tracks: { keys: string[]; totalSeconds: number }[],
  cells: MobilityGridCell[]
): DissimilarRoute[] {
  const byKey = new Map(cells.map(c => [c.key, c]));
  return tracks
    .filter(t => t.keys.length > 1)
    .map(t => {
      const steps = t.keys.length - 1;
      const path = t.keys.map((key, i) => {
        const cell = byKey.get(key);
        return {
          lat: cell?.center.lat ?? 0,
          lng: cell?.center.lng ?? 0,
          // Even spacing across the mover's own total: the per-step times are
          // not retained for every mover (only for the animated sample), and
          // an evenly-spaced approximation is honest for a hairline whose only
          // job is to show WHERE the mover went.
          cumulativeSeconds: steps > 0 ? (t.totalSeconds * i) / steps : 0,
        };
      });
      return { keys: t.keys, path, totalSeconds: t.totalSeconds };
    });
}

function buildCorridor(
  id: string,
  comp: string[],
  byKey: Map<string, MobilityGridCell>,
  smoothed: Map<string, number>,
  rawRouteCount: Map<string, number>,
  routesByCell: Map<string, Set<number>>,
  routes: DissimilarRoute[],
  facts: CellFacts,
  peak: number,
  hexSize: number,
  hexWidthM: number,
  proj: LocalProjection,
  opts: Required<CorridorFieldOptions>,
  profile: MoverProfile
): Corridor {
  const cells: CorridorCell[] = comp.map(key => {
    const cell = byKey.get(key)!;
    const local = axialToLocal(cell.hex, hexSize);
    const polygon = hexCorners(local, hexSize).map(p => toLatLng(proj, p));
    polygon.push(polygon[0]);
    return {
      key,
      center: cell.center,
      polygon,
      density: Math.min(1, (smoothed.get(key) ?? 0) / peak),
      routeCount: rawRouteCount.get(key) ?? 0,
    };
  });

  // Which analysed routes actually use this corridor.
  const routeIdx = new Set<number>();
  for (const key of comp) {
    const s = routesByCell.get(key);
    if (s) for (const i of s) routeIdx.add(i);
  }
  const usingRoutes = [...routeIdx].map(i => routes[i]).filter(Boolean);
  const times = usingRoutes.map(r => r.totalSeconds).sort((a, b) => a - b);
  const medianTravelSeconds = times.length > 0
    ? (times.length % 2 === 1 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2)
    : Infinity;
  const fastestTravelSeconds = times.length > 0 ? times[0] : Infinity;

  // --- Width / bottleneck from iso-arrival-time slices. Arrival time rises
  // monotonically along direction of travel, so cells sharing an arrival-time
  // band form a cross-section of the corridor — the same principle the
  // isochrone bands already use, reused here as a width measure rather than
  // a display band.
  const finiteArrivals = comp
    .map(k => facts.arrivalSeconds.get(k))
    .filter((t): t is number => typeof t === 'number' && isFinite(t));
  let bottleneckCells = cells.length;
  let widestCells = cells.length;
  let bottleneckCellKeys = comp;
  if (finiteArrivals.length > 1) {
    const lo = Math.min(...finiteArrivals);
    const hi = Math.max(...finiteArrivals);
    const span = hi - lo;
    if (span > 0) {
      const buckets = new Array(opts.widthSlices).fill(0);
      const bucketKeys: string[][] = Array.from({ length: opts.widthSlices }, () => []);
      for (const k of comp) {
        const t = facts.arrivalSeconds.get(k);
        if (typeof t !== 'number' || !isFinite(t)) continue;
        const b = Math.min(opts.widthSlices - 1, Math.floor(((t - lo) / span) * opts.widthSlices));
        buckets[b]++;
        bucketKeys[b].push(k);
      }
      const occupied = buckets.filter(b => b > 0);
      if (occupied.length > 0) {
        bottleneckCells = Math.min(...occupied);
        widestCells = Math.max(...occupied);
        const narrowestIdx = buckets.findIndex(b => b === bottleneckCells);
        if (narrowestIdx >= 0) bottleneckCellKeys = bucketKeys[narrowestIdx];
      }
    }
  }

  const classes = comp.map(k => facts.trafficability.get(k) ?? 'severely-restricted');
  const n = Math.max(1, classes.length);
  const unrestrictedFraction = classes.filter(c => c === 'unrestricted').length / n;
  const restrictedFraction = classes.filter(c => c === 'restricted').length / n;
  const severelyRestrictedFraction = classes.filter(c => c === 'severely-restricted').length / n;

  // Doctrinal-flavoured wording, but the thresholds are this product's own
  // engineering choice over its own computed mobility-class mix — deliberately
  // NOT presented as a doctrinal classification of the terrain itself.
  const easeClass: CorridorEaseClass =
    unrestrictedFraction >= 0.6 ? 'unrestricted' : unrestrictedFraction >= 0.25 ? 'restricted' : 'severely-restricted';

  const bottleneckWidthM = bottleneckCells * hexWidthM;
  const bottleneckAbreast = profile.widthM > 0 ? Math.floor(bottleneckWidthM / profile.widthM) : 0;
  const frontage: CorridorFrontage =
    bottleneckAbreast >= 3 ? 'multi-lane' : bottleneckAbreast === 2 ? 'two-abreast' : 'single-file';

  // docs §35 remainder — this corridor's OWN pinch ratio (not the field-level
  // one, which only ever tracked the busiest corridor) and water-crossing
  // exposure, both real aggregates over cells already in hand. Feed
  // `riskScore` below — see that field's own doc comment for the formula.
  const pinchRatio = widestCells > 0 ? bottleneckCells / widestCells : 1;
  const waterCrossingFraction = comp.filter(k => {
    const cell = byKey.get(k);
    return cell ? carriesWaterSignal(cell) : false;
  }).length / n;
  const riskScore = Math.max(0, Math.min(1,
    0.4 * (restrictedFraction + severelyRestrictedFraction) +
    0.3 * waterCrossingFraction +
    0.3 * (1 - pinchRatio)
  ));

  return {
    id,
    rank: 0, // assigned by the caller after sorting
    cells,
    routeCount: usingRoutes.length,
    shareOfRoutes: routes.length > 0 ? usingRoutes.length / routes.length : 0,
    medianTravelSeconds,
    fastestTravelSeconds,
    bottleneckCells,
    bottleneckWidthM,
    bottleneckCellKeys,
    widestCells,
    widestWidthM: widestCells * hexWidthM,
    bottleneckAbreast,
    frontage,
    unrestrictedFraction,
    restrictedFraction,
    severelyRestrictedFraction,
    easeClass,
    pinchRatio,
    waterCrossingFraction,
    riskScore,
    usedEstimatedData: comp.some(k => byKey.get(k)?.vegEstimated ?? false),
    representativeRoute: usingRoutes.length > 0
      ? usingRoutes.reduce((best, r) => (r.totalSeconds < best.totalSeconds ? r : best))
      : null,
  };
}

// ---------------------------------------------------------------------------
// Counter-measure effect: diff two corridor fields
// ---------------------------------------------------------------------------

export type CorridorEffectStatus = 'collapsed' | 'degraded' | 'unchanged' | 'displaced-into';

export interface CorridorEffect {
  corridorId: string;
  rankBefore: number;
  /** null when this corridor no longer exists after the measures. */
  rankAfter: number | null;
  status: CorridorEffectStatus;
  routeCountBefore: number;
  routeCountAfter: number;
  /** Median travel time change through this corridor, seconds. Positive =
   *  slower. Infinity when the corridor became impassable outright. */
  medianDelaySeconds: number;
  bottleneckWidthBeforeM: number;
  bottleneckWidthAfterM: number;
  easeBefore: CorridorEaseClass;
  easeAfter: CorridorEaseClass | null;
}

export interface CorridorComparison {
  effects: CorridorEffect[];
  /** Corridors present AFTER that match nothing before — genuinely new
   *  ground the movement was pushed onto. This is the bypass question asked
   *  spatially rather than as a single number (docs §5's bypass rule). */
  newCorridors: Corridor[];
  collapsedCount: number;
  degradedCount: number;
  displacedIntoCount: number;
}

/** Overlap fraction of `a`'s cells that also appear in `b`. */
function overlapFraction(a: Corridor, b: Corridor): number {
  const bKeys = new Set(b.cells.map(c => c.key));
  const shared = a.cells.filter(c => bKeys.has(c.key)).length;
  return a.cells.length > 0 ? shared / a.cells.length : 0;
}

const MATCH_MIN_OVERLAP = 0.25;

/**
 * Diff a baseline corridor field against one computed with counter-measures
 * emplaced. Matches corridors by cell overlap (they are the same ground, not
 * the same object identity — a measure can shrink, split or shift a
 * corridor), then classifies what the measures actually did to each.
 *
 * Every figure here is a difference between two REAL runs of the same
 * search — nothing is modelled or assumed about what an obstacle "should" do.
 */
export function compareCorridorFields(
  before: CorridorField,
  after: CorridorField | null
): CorridorComparison {
  const effects: CorridorEffect[] = [];
  const matchedAfter = new Set<string>();

  for (const b of before.corridors) {
    if (!after) {
      effects.push({
        corridorId: b.id,
        rankBefore: b.rank,
        rankAfter: null,
        status: 'collapsed',
        routeCountBefore: b.routeCount,
        routeCountAfter: 0,
        medianDelaySeconds: Infinity,
        bottleneckWidthBeforeM: b.bottleneckWidthM,
        bottleneckWidthAfterM: 0,
        easeBefore: b.easeClass,
        easeAfter: null,
      });
      continue;
    }

    let bestMatch: Corridor | null = null;
    let bestOverlap = 0;
    for (const a of after.corridors) {
      const o = overlapFraction(b, a);
      if (o > bestOverlap) { bestOverlap = o; bestMatch = a; }
    }

    if (!bestMatch || bestOverlap < MATCH_MIN_OVERLAP) {
      effects.push({
        corridorId: b.id,
        rankBefore: b.rank,
        rankAfter: null,
        status: 'collapsed',
        routeCountBefore: b.routeCount,
        routeCountAfter: 0,
        medianDelaySeconds: Infinity,
        bottleneckWidthBeforeM: b.bottleneckWidthM,
        bottleneckWidthAfterM: 0,
        easeBefore: b.easeClass,
        easeAfter: null,
      });
      continue;
    }

    matchedAfter.add(bestMatch.id);
    const delay = isFinite(bestMatch.medianTravelSeconds) && isFinite(b.medianTravelSeconds)
      ? bestMatch.medianTravelSeconds - b.medianTravelSeconds
      : Infinity;
    // "Displaced-into" = this corridor now carries MORE of the route set than
    // it did: the measures pushed traffic here. That is the spatial form of
    // the bypass rule — the honest counterpart to a delay figure.
    const gainedRoutes = bestMatch.routeCount > b.routeCount;
    const status: CorridorEffectStatus =
      gainedRoutes ? 'displaced-into'
        : (delay > 60 || bestMatch.bottleneckWidthM < b.bottleneckWidthM * 0.75 || bestMatch.routeCount < b.routeCount)
          ? 'degraded'
          : 'unchanged';

    effects.push({
      corridorId: b.id,
      rankBefore: b.rank,
      rankAfter: bestMatch.rank,
      status,
      routeCountBefore: b.routeCount,
      routeCountAfter: bestMatch.routeCount,
      medianDelaySeconds: delay,
      bottleneckWidthBeforeM: b.bottleneckWidthM,
      bottleneckWidthAfterM: bestMatch.bottleneckWidthM,
      easeBefore: b.easeClass,
      easeAfter: bestMatch.easeClass,
    });
  }

  const newCorridors = after ? after.corridors.filter(a => !matchedAfter.has(a.id)) : [];

  return {
    effects: effects.sort((a, b) => a.rankBefore - b.rankBefore),
    newCorridors,
    collapsedCount: effects.filter(e => e.status === 'collapsed').length,
    degradedCount: effects.filter(e => e.status === 'degraded').length,
    displacedIntoCount: effects.filter(e => e.status === 'displaced-into').length,
  };
}
