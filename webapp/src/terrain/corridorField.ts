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

import { LatLng } from '../utils/chainage';
import {
  MobilityGridCell, runAccumulatedCostSearch, extractPath, AccumulatedCostSearchOptions,
} from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { LocalProjection, axialToLocal, hexCorners, toLatLng, hexKey, hexNeighbors } from '../utils/hexGrid';
import { DissimilarRoute, findKDissimilarPaths } from './corridorAnalysis';
import { edgeMobilityCost, TrafficabilityClass } from './mobilityCost';
import { calculateDistance } from '../utils/slopeCalculation';

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

export type CorridorEaseClass = 'open' | 'restricted' | 'severely-restricted';

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
  widestCells: number;
  widestWidthM: number;
  /** How many of THIS mover fit side by side through the bottleneck —
   *  `floor(bottleneckWidthM / profile.widthM)`, arithmetic over two real
   *  numbers. See `CorridorFrontage` for what is deliberately not claimed
   *  on top of this. */
  bottleneckAbreast: number;
  frontage: CorridorFrontage;
  /** Real fractions over the corridor's own cells. */
  goFraction: number;
  slowGoFraction: number;
  noGoFraction: number;
  easeClass: CorridorEaseClass;
  /** True when ANY cell in this corridor carries estimated/fallback sample
   *  data — surfaced per corridor so a caveat lands on the specific corridor
   *  it applies to, not just once for the whole run. */
  usedEstimatedData: boolean;
}

export interface CorridorField {
  corridors: Corridor[];
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
  // GO here while the search treats every way out of it as NO-GO.
  const byKey = new Map(cells.map(c => [c.key, c]));
  const trafficability = new Map<string, TrafficabilityClass>();
  for (const cell of cells) {
    let worst: TrafficabilityClass = 'NO-GO';
    let anyPassable = false;
    for (const nHex of hexNeighbors(cell.hex)) {
      const n = byKey.get(hexKey(nHex));
      if (!n) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, n.center.lat, n.center.lng);
      const r = edgeMobilityCost(
        profile,
        { lat: cell.center.lat, lng: cell.center.lng, elevation: cell.elevation, vegetation: cell.vegetation, vegEstimated: cell.vegEstimated, onTrail: cell.onTrail },
        { lat: n.center.lat, lng: n.center.lng, elevation: n.elevation, vegetation: n.vegetation, vegEstimated: n.vegEstimated, onTrail: n.onTrail },
        dist,
        { nightMode, crossSlopeDeg: cell.crossSlopeDeg }
      );
      if (r.trafficability === 'GO') { worst = 'GO'; anyPassable = true; break; }
      if (r.trafficability === 'SLOW-GO') { worst = 'SLOW-GO'; anyPassable = true; }
    }
    trafficability.set(cell.key, anyPassable ? worst : 'NO-GO');
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
  options: CorridorFieldOptions & { routeCount?: number; edgePenalties?: Map<string, number> } = {}
): CorridorField | null {
  const opts: Required<CorridorFieldOptions> = {
    smoothingIterations: options.smoothingIterations ?? DEFAULTS.smoothingIterations,
    smoothingWeight: options.smoothingWeight ?? DEFAULTS.smoothingWeight,
    membershipThreshold: options.membershipThreshold ?? DEFAULTS.membershipThreshold,
    widthSlices: options.widthSlices ?? DEFAULTS.widthSlices,
    minCorridorCells: options.minCorridorCells ?? DEFAULTS.minCorridorCells,
  };
  const routeCount = options.routeCount ?? DEFAULT_CORRIDOR_ROUTE_COUNT;

  const routes = findKDissimilarPaths(
    cells, originKeys, objectiveKeys, profile, nightMode, routeCount, options.edgePenalties
  );
  if (routes.length === 0) return null;

  const facts = computeCellFacts(cells, originKeys, profile, nightMode, options.edgePenalties);
  const byKey = new Map(cells.map(c => [c.key, c]));

  // --- Weighted density: an attractive route contributes more. Weight is the
  // real ratio best/this, so a route twice as slow as the best counts half —
  // a computed figure, not an arbitrary rank decay.
  const bestSeconds = Math.min(...routes.map(r => r.totalSeconds));
  const raw = new Map<string, number>();
  const rawRouteCount = new Map<string, number>();
  const routesByCell = new Map<string, Set<number>>();
  routes.forEach((route, idx) => {
    const weight = route.totalSeconds > 0 ? Math.max(0.05, bestSeconds / route.totalSeconds) : 1;
    for (const key of new Set(route.keys)) {
      raw.set(key, (raw.get(key) ?? 0) + weight);
      rawRouteCount.set(key, (rawRouteCount.get(key) ?? 0) + 1);
      if (!routesByCell.has(key)) routesByCell.set(key, new Set());
      routesByCell.get(key)!.add(idx);
    }
  });

  const smoothed = smoothOverHexGrid(raw, cells, opts.smoothingIterations, opts.smoothingWeight);
  let peak = 0;
  for (const v of smoothed.values()) if (v > peak) peak = v;
  if (peak <= 0) return null;

  const cutoff = peak * opts.membershipThreshold;
  const member = new Set<string>();
  for (const [key, v] of smoothed) {
    if (v >= cutoff && byKey.has(key)) member.add(key);
  }
  if (member.size === 0) return null;

  // --- Segment into connected components over hex adjacency.
  const seen = new Set<string>();
  const components: string[][] = [];
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
    components.push(comp);
  }

  const hexWidthM = hexSize * Math.sqrt(3); // pointy-top hex flat-to-flat width

  const built = components
    .filter(comp => comp.length >= opts.minCorridorCells)
    .map((comp, i) => buildCorridor(
      `corridor-${i}`, comp, byKey, smoothed, rawRouteCount, routesByCell, routes, facts, peak, hexSize, hexWidthM, proj, opts, profile
    ))
    // Rank by weighted movement carried, not raw cell count — a short fat
    // component that few routes use is not the primary avenue of approach.
    .sort((a, b) => b.routeCount - a.routeCount || b.cells.length - a.cells.length)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  if (built.length === 0) return null;

  const cellCount = built.reduce((s, c) => s + c.cells.length, 0);
  const coverageFraction = cells.length > 0 ? cellCount / cells.length : 0;
  const busiest = built[0];
  const pinchRatio = busiest.widestCells > 0 ? busiest.bottleneckCells / busiest.widestCells : 1;

  return {
    corridors: built,
    routes,
    cellCount,
    routedCellCount: rawRouteCount.size,
    peakDensity: peak,
    coverageFraction,
    pinchRatio,
    unconstrained:
      coverageFraction >= UNCONSTRAINED_COVERAGE_THRESHOLD && pinchRatio > UNCONSTRAINED_PINCH_RATIO,
    options: opts,
  };
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
  if (finiteArrivals.length > 1) {
    const lo = Math.min(...finiteArrivals);
    const hi = Math.max(...finiteArrivals);
    const span = hi - lo;
    if (span > 0) {
      const buckets = new Array(opts.widthSlices).fill(0);
      for (const k of comp) {
        const t = facts.arrivalSeconds.get(k);
        if (typeof t !== 'number' || !isFinite(t)) continue;
        const b = Math.min(opts.widthSlices - 1, Math.floor(((t - lo) / span) * opts.widthSlices));
        buckets[b]++;
      }
      const occupied = buckets.filter(b => b > 0);
      if (occupied.length > 0) {
        bottleneckCells = Math.min(...occupied);
        widestCells = Math.max(...occupied);
      }
    }
  }

  const classes = comp.map(k => facts.trafficability.get(k) ?? 'NO-GO');
  const n = Math.max(1, classes.length);
  const goFraction = classes.filter(c => c === 'GO').length / n;
  const slowGoFraction = classes.filter(c => c === 'SLOW-GO').length / n;
  const noGoFraction = classes.filter(c => c === 'NO-GO').length / n;

  // Doctrinal-flavoured wording, but the thresholds are this product's own
  // engineering choice over its own computed GO/SLOW-GO mix — deliberately
  // NOT presented as a doctrinal classification of the terrain itself.
  const easeClass: CorridorEaseClass =
    goFraction >= 0.6 ? 'open' : goFraction >= 0.25 ? 'restricted' : 'severely-restricted';

  const bottleneckWidthM = bottleneckCells * hexWidthM;
  const bottleneckAbreast = profile.widthM > 0 ? Math.floor(bottleneckWidthM / profile.widthM) : 0;
  const frontage: CorridorFrontage =
    bottleneckAbreast >= 3 ? 'multi-lane' : bottleneckAbreast === 2 ? 'two-abreast' : 'single-file';

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
    widestCells,
    widestWidthM: widestCells * hexWidthM,
    bottleneckAbreast,
    frontage,
    goFraction,
    slowGoFraction,
    noGoFraction,
    easeClass,
    usedEstimatedData: comp.some(k => byKey.get(k)?.vegEstimated ?? false),
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
