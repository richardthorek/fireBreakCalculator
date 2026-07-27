/**
 * PROBABILISTIC MOVEMENT SIMULATION — "where will they actually go", as an
 * ensemble rather than a single line (owner, 2026-07-27):
 *
 *   "the simulate movement draws a single line very quickly. This app is
 *    trying to simulate 'likely' movement pathways. There is a degree of
 *    probability that over the course of many simulations units take common
 *    paths... moving more slowly or around obstacles. At the moment we're
 *    attempting to see the most likely or easiest path. We need to account for
 *    the unknown of what the moving unit will TRY to do, as they progress from
 *    cell to cell and make the next routing decision."
 *
 * WHAT WAS WRONG WITH THE OLD ANSWER. Everything this mode computed until now
 * was an OPTIMISER's answer: the cheapest path (`extractPath`), or k cheapest
 * paths under iterative edge penalties (`corridorField.ts`). Those are correct
 * as analysis, and the corridor bands honestly widen them — but every one of
 * them is a global optimum computed with perfect knowledge of the whole grid.
 * A real unit does not solve Dijkstra over ground it has not seen. It heads
 * for the objective, decides at each step from what it can perceive, and finds
 * out about the gully when it reaches the gully.
 *
 * THE MODEL. A mover standing on cell `u` picks its next cell `v` from `u`'s
 * traversable neighbours, scoring each by the total remaining time it BELIEVES
 * that step commits it to:
 *
 *     score(v) = edgeTime(u→v) + perceivedToGo(v) + turnPenalty + revisitPenalty
 *     P(v)     ∝ exp( −score(v) / τ )
 *
 * THREE distinct, separately-meaningful sources of uncertainty, which is the
 * whole substance of "the unknown of what the unit will TRY to do":
 *
 *  0. NETWORK PREFERENCE (`roadAffinitySeconds`) — the first thing a real
 *     mover decides is not "which patch of dirt", it is "am I on the road or
 *     off it" (owner, 2026-07-27: "you might take roads and highways as a
 *     preference until they're blocked or denied. A longer route would be
 *     assumed to be quicker on a road. Going cross country then brings into
 *     scope all of the vegetation and landscape elements"). Leaving the
 *     trail/road network costs the mover `roadAffinitySeconds` of BELIEVED
 *     time, and joining it credits the same — so a mover stays on a road well
 *     past the point where raw cost alone would leave it, takes the longer
 *     road route, and only goes bush when the network stops serving it or is
 *     denied. The size of that reluctance comes from the profile: a truck
 *     accepts a very long detour to stay on a road, a foot patrol barely
 *     cares. This is the term that makes vegetation and micro-terrain matter
 *     exactly WHEN they should — once the mover has been forced off the
 *     network — rather than uniformly everywhere.
 *
 *  1. KNOWLEDGE (`terrainKnowledge`, k ∈ [0,1]) — what the mover believes the
 *     remaining journey costs:
 *         perceivedToGo(v) = k · trueToGo(v) + (1 − k) · naiveToGo(v)
 *     `trueToGo` is the exact remaining time from the reverse cost field
 *     (`runCostToGoSearch`) — a mover who has worked this ground before.
 *     `naiveToGo` is straight-line distance ÷ the profile's own nominal
 *     cross-country speed — a mover navigating on a map and a compass bearing,
 *     who cannot see what is behind the next ridge. k = 1 recovers perfect
 *     knowledge; k = 0 is pure bearing-following. Real movers sit in between
 *     and differ from each other, so k is drawn per mover.
 *
 *  2. DECISION NOISE (`decisionTemperatureSeconds`, τ) — a Boltzmann/softmax
 *     policy over those scores. τ is in SECONDS and is therefore readable:
 *     "differences smaller than about τ seconds of believed total journey time
 *     do not reliably decide which way this mover turns." τ → 0 collapses to
 *     always taking the best-believed step.
 *
 * IMPORTANT PROPERTY: **the mover pays the REAL edge cost regardless of what
 * it believed.** Belief steers the choice; terrain charges for it. That is
 * what produces the behaviour actually asked for — a low-knowledge mover
 * commits to a bearing, walks into ground that costs more than it expected,
 * and has to work around it, arriving later than the optimiser's figure. None
 * of that is scripted; it falls out of the same `edgeMobilityCost` every other
 * part of this mode uses. A NO-GO edge is never traversable here either, so
 * the ensemble can never show movement the analysis calls impossible.
 *
 * THE OUTPUT is an empirical transit frequency per cell over N independent
 * movers — literally "over the course of many simulations, how often did a
 * unit cross this cell" — plus the arrival-time DISTRIBUTION (p10/p50/p90) and
 * the fraction that never arrived at all. A spread of arrival times is a more
 * honest planning input than one optimal ETA, and the never-arrived fraction
 * is a real finding, not a failure to hide. Per-DIRECTED-EDGE transit counts
 * come out of the same pass, which is what `restrictionPlanner.ts` needs to
 * answer the other half of the question: given that this is how they move
 * UNRESTRICTED, which specific stretch of road is worth denying.
 *
 * BLOCKED EDGES are how a restriction enters the model. A blocked edge is
 * simply never traversable — the same treatment a NO-GO edge gets, so a
 * proposed road block can never be quietly driven through. It is also removed
 * from the true cost-to-go field, which produces the right asymmetry for free:
 * a mover who KNOWS about the block (high k) plans around it from the start,
 * while a mover who does not drives up to it, finds it, and has to work out
 * another way from where it now stands.
 *
 * ---------------------------------------------------------------------------
 * HONESTY BOUNDARY — read before presenting any number from this module.
 *
 * The TERRAIN inputs (slope, vegetation, trails, the edge cost itself) are the
 * same measured/estimated data, carrying the same Tier 0/1 flags, as the rest
 * of the mode. The BEHAVIOUR parameters (τ, the k distribution, the turn and
 * revisit penalties, the step budget, the unreachable-lookahead penalty) are
 * ASSUMED. No source was found that calibrates how a real unit trades off
 * believed remaining time against local effort, and none is claimed. They are
 * engineering choices, chosen to be plausible and to degrade to the existing
 * deterministic answer at their limits.
 *
 * Therefore: a transit frequency from this module is "the share of simulated
 * movers UNDER THIS BEHAVIOUR MODEL that crossed this cell", never "the
 * probability a real unit goes here". Everything this module returns is
 * flagged `behaviourModelled: true` and every caller must surface that
 * distinction. This is the same rule the rest of the product follows for
 * estimated data — a modelled number that presents as a measured one is the
 * failure mode this project exists to avoid.
 * ---------------------------------------------------------------------------
 */

import { LatLng } from '../utils/chainage';
import { calculateDistance } from '../utils/slopeCalculation';
import {
  MobilityGridCell, runCostToGoSearch,
} from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { edgeMobilityCost, irmischerClarkeSpeedKmh, toblerSpeedKmh, MobilitySample } from './mobilityCost';
import {
  LocalProjection, axialToLocal, hexCorners, toLatLng, hexKey, hexNeighbors,
} from '../utils/hexGrid';

// ---------------------------------------------------------------------------
// Behaviour parameters — ASSUMED, not sourced (see the honesty boundary above)
// ---------------------------------------------------------------------------

export interface MoverBehaviour {
  /** Softmax temperature, SECONDS of believed total remaining time. Higher =
   *  less decisive: more movers take a step that is not the best-believed one. */
  decisionTemperatureSeconds: number;
  /** 0..1. How much of the mover's remaining-time belief comes from the true
   *  cost field vs a straight-line bearing estimate. See module note. */
  terrainKnowledge: number;
  /** Seconds of believed journey time this mover will trade away rather than
   *  leave the road/trail network (and equally, will chase to rejoin it). */
  roadAffinitySeconds: number;
}

/**
 * Base network reluctance by mover kind, SECONDS. Read it as "this mover would
 * rather add about this much to its journey than come off the road."
 *
 * ASSUMED — no source was found that quantifies route-choice road preference
 * for these classes, and none is claimed. The ORDERING is the defensible part
 * and follows directly from the physical facts the profiles already encode: a
 * wheeled vehicle off a formed surface is slow, fragile and at real bogging
 * risk (its `crossCountryFactor` is the smallest), tracked movement is far
 * less penalised, and a dismounted mover is barely constrained by the network
 * at all — and may have positive reasons to avoid it, which this model does
 * not attempt to represent.
 */
const ROAD_AFFINITY_BASE_SECONDS: Record<string, number> = {
  wheeled: 900,
  tracked: 420,
  'foot-unit': 300,
  'foot-individual': 150,
};

export function baseRoadAffinitySeconds(profile: MoverProfile): number {
  return ROAD_AFFINITY_BASE_SECONDS[profile.kind] ?? 300;
}

/** Per-run population spread. Each mover draws its own behaviour uniformly
 *  from these ranges, so the ensemble is a POPULATION of movers rather than N
 *  copies of one mover — which is the point: the spread is the uncertainty. */
export interface BehaviourSpread {
  id: string;
  label: string;
  /** Plain-English statement of the assumption, shown in the UI. */
  description: string;
  temperatureSecondsMin: number;
  temperatureSecondsMax: number;
  knowledgeMin: number;
  knowledgeMax: number;
  /** Multiplier applied to the profile's own base road affinity. Movers who
   *  do not know the ground lean on the road network HARDER, not less — it is
   *  the one thing they can be sure leads somewhere. */
  roadAffinityMultiplierMin: number;
  roadAffinityMultiplierMax: number;
}

export const BEHAVIOUR_SPREADS: BehaviourSpread[] = [
  {
    id: 'familiar',
    label: 'Familiar with the ground',
    description:
      'Movers mostly know what is over the next ridge and choose decisively. Paths cluster tightly and sit close to the optimiser\'s route.',
    temperatureSecondsMin: 20,
    temperatureSecondsMax: 90,
    knowledgeMin: 0.75,
    knowledgeMax: 1.0,
    roadAffinityMultiplierMin: 0.7,
    roadAffinityMultiplierMax: 1.1,
  },
  {
    id: 'mixed',
    label: 'Mixed / unknown (default)',
    description:
      'A spread of movers, from well-briefed to navigating on a bearing. Makes no assumption about how well the ground is known — the widest honest default.',
    temperatureSecondsMin: 40,
    temperatureSecondsMax: 300,
    knowledgeMin: 0.25,
    knowledgeMax: 0.95,
    roadAffinityMultiplierMin: 0.8,
    roadAffinityMultiplierMax: 1.6,
  },
  {
    id: 'unfamiliar',
    label: 'Unfamiliar / navigating on bearing',
    description:
      'Movers head for the objective and discover the terrain as they meet it. Expect longer, more scattered routes and more that fail to arrive.',
    temperatureSecondsMin: 90,
    temperatureSecondsMax: 500,
    knowledgeMin: 0.0,
    knowledgeMax: 0.45,
    roadAffinityMultiplierMin: 1.2,
    roadAffinityMultiplierMax: 2.2,
  },
];

export const DEFAULT_BEHAVIOUR_SPREAD_ID = 'mixed';

export function getBehaviourSpread(id: string): BehaviourSpread {
  return BEHAVIOUR_SPREADS.find(s => s.id === id) ?? BEHAVIOUR_SPREADS[1];
}

/** Seconds charged per radian of heading change. Discourages a mover from
 *  zig-zagging across the hex lattice for a marginal believed gain — real
 *  movement has momentum. ASSUMED (a hex step is 60°≈1.05 rad, so a hard
 *  reversal costs ~2.6× this). */
const TURN_PENALTY_SECONDS_PER_RADIAN = 25;

/** Seconds added per previous visit to a candidate cell. Keeps a mover from
 *  orbiting the same few cells when its belief field is nearly flat; a mover
 *  that has already been somewhere is disinclined to go back. ASSUMED. */
const REVISIT_PENALTY_SECONDS = 240;

/**
 * What an unreachable cell "looks like" to a mover's lookahead. A cell the
 * objective genuinely cannot be reached from has `trueToGo = ∞`, which would
 * make ANY mover with k > 0 avoid it absolutely — collapsing exactly the
 * behaviour this module exists to model (walking into a pocket you could not
 * see into, then working back out). Substituting a large FINITE penalty
 * instead lets a low-knowledge mover still be drawn in by a short straight-line
 * distance, and pay for it. ASSUMED; 4 hours is far beyond any believable
 * short-leg journey time at these grid scales, so it never competes with a
 * genuinely reachable route for a well-informed mover.
 */
const UNREACHABLE_LOOKAHEAD_SECONDS = 4 * 3600;

// ---------------------------------------------------------------------------
// Seeded RNG — planning tools must be reproducible: same AOI, same profile,
// same seed → same ensemble. mulberry32, a standard small PRNG.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_MOVEMENT_SIM_SEED = 20260727;

// ---------------------------------------------------------------------------
// Nominal speed — the mover's own "how fast do I normally cover ground"
// figure, used ONLY for the naive straight-line lookahead
// ---------------------------------------------------------------------------

/**
 * Flat-ground cross-country speed for this profile, km/h. This is the mover's
 * own rule of thumb for estimating a journey it cannot see — deliberately
 * derived from the SAME profile fields `edgeMobilityCost` uses, so a slower
 * profile also estimates more conservatively, rather than a separate constant
 * that could drift away from the cost model.
 */
export function nominalCrossCountrySpeedKmh(profile: MoverProfile, nightMode: boolean): number {
  let kmh: number;
  switch (profile.speedModel) {
    case 'irmischer-clarke-offpath':
      kmh = irmischerClarkeSpeedKmh(0);
      break;
    case 'tobler':
      kmh = toblerSpeedKmh(0);
      break;
    default:
      kmh = profile.roadSpeedKmh * profile.crossCountryFactor;
      break;
  }
  if (profile.loadPenaltyFactor) kmh *= profile.loadPenaltyFactor;
  if (nightMode) kmh *= profile.nightFactor;
  return Math.max(0.1, kmh);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Memoised directed-edge cost over one sampled grid + profile + night setting.
 *
 * Hoisted out of a single ensemble run on purpose: `restrictionPlanner.ts`
 * runs the ensemble many times over the SAME grid with different edges blocked,
 * and the edge costs themselves never change between those runs — only which
 * edges are usable does. Sharing one cache turns the planner from "N full
 * re-costings of the grid" into "N re-walks of a costed grid".
 */
export interface EdgeCostCache {
  seconds(from: MobilityGridCell, to: MobilityGridCell): number;
  neighboursOf(key: string): MobilityGridCell[];
  byKey: Map<string, MobilityGridCell>;
}

export function createEdgeCostCache(
  cells: MobilityGridCell[],
  profile: MoverProfile,
  nightMode: boolean
): EdgeCostCache {
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

  const adjacency = new Map<string, MobilityGridCell[]>();
  for (const cell of cells) {
    const ns: MobilityGridCell[] = [];
    for (const nHex of hexNeighbors(cell.hex)) {
      const n = byKey.get(hexKey(nHex));
      if (n) ns.push(n);
    }
    adjacency.set(cell.key, ns);
  }

  const cache = new Map<string, number>();
  return {
    byKey,
    neighboursOf: key => adjacency.get(key) ?? [],
    seconds(from, to) {
      const ck = `${from.key}|${to.key}`;
      const hit = cache.get(ck);
      if (hit !== undefined) return hit;
      const dist = calculateDistance(from.center.lat, from.center.lng, to.center.lat, to.center.lng);
      const a: MobilitySample = { lat: from.center.lat, lng: from.center.lng, elevation: from.elevation, vegetation: from.vegetation, vegEstimated: from.vegEstimated, onTrail: from.onTrail };
      const b: MobilitySample = { lat: to.center.lat, lng: to.center.lng, elevation: to.elevation, vegetation: to.vegetation, vegEstimated: to.vegEstimated, onTrail: to.onTrail };
      const r = edgeMobilityCost(profile, a, b, dist, { nightMode, crossSlopeDeg: from.crossSlopeDeg });
      cache.set(ck, r.timeSeconds);
      return r.timeSeconds;
    },
  };
}

export interface SimulatedStep {
  lat: number;
  lng: number;
  /** Seconds since this mover set off, charged at the REAL edge cost. */
  cumulativeSeconds: number;
}

export interface MoverTrajectory {
  steps: SimulatedStep[];
  arrived: boolean;
  totalSeconds: number;
  behaviour: MoverBehaviour;
}

/** The lightweight per-mover record kept for EVERY mover (the full trajectory
 *  is kept only for a sample). Cell keys in travel order — enough to build
 *  corridors from, which is what makes the simulation, rather than the
 *  optimiser, the evidence base for what gets presented. */
export interface MoverTrack {
  keys: string[];
  totalSeconds: number;
  arrived: boolean;
  /** Share of this mover's steps taken OFF the trail/road network. 0 = it
   *  drove the whole way on formed surfaces. */
  crossCountryFraction: number;
}

export interface TransitCell {
  key: string;
  center: LatLng;
  polygon: LatLng[];
  /** Movers that crossed this cell, as a fraction of all movers simulated
   *  (including those that never arrived — they still moved through ground). */
  transitFraction: number;
  moverCount: number;
}

export interface MovementEnsembleResult {
  /** Always true. Present so no consumer can render these numbers without
   *  having had to acknowledge what they are (see the module honesty note). */
  behaviourModelled: true;
  moverCount: number;
  arrivedCount: number;
  /** Movers that hit the step budget or ran into a dead end without reaching
   *  the objective. A real finding about the ground, not an error. */
  lostCount: number;
  cells: TransitCell[];
  /** Arrival times over ARRIVED movers only, seconds. Null when none arrived. */
  arrivalP10Seconds: number | null;
  arrivalP50Seconds: number | null;
  arrivalP90Seconds: number | null;
  /** The optimiser's own single cheapest time for the same grid/profile, for
   *  side-by-side comparison — "the best case, and what a spread of movers
   *  actually did". Null when the objective was unreachable outright. */
  optimalSeconds: number | null;
  /** A retained subset of full trajectories, for animating many movers at once
   *  instead of one line. */
  sampleTrajectories: MoverTrajectory[];
  /** Every mover's track, in travel order — the evidence corridors are built
   *  from (corridorField.ts's `routesOverride`). */
  tracks: MoverTrack[];
  /** Directed-edge transit counts (`${fromKey}|${toKey}` → movers). The input
   *  restrictionPlanner.ts ranks candidate restrictions from. */
  edgeTransit: Map<string, number>;
  /**
   * How much of this movement was off the trail/road network: the MEAN over
   * movers of each mover's own off-network share. Near 0 = this movement is a
   * road problem; near 1 = it is a vegetation and terrain problem. Denying
   * roads moves this number, which makes it the clearest single measure of
   * whether a restriction actually did what it was meant to.
   *
   * Deliberately a per-mover mean rather than a pooled count of all steps. The
   * pooled version was the first implementation and it was wrong in a way only
   * testing showed: a mover that never arrives runs to the full step budget
   * (~130 steps) while a mover that drives straight down the road finishes in
   * ~29, so a handful of stranded movers thrashing in the bush outweighed
   * everyone who succeeded — an ensemble whose every individual track was 4-7%
   * off-road reported 46% off-road overall. One mover, one vote fixes that
   * without hiding stranded movers: a mover that spent its whole run in the
   * bush still contributes 1.0, it just cannot contribute more than 1.0.
   */
  crossCountryFraction: number;
  /** Directed edges that were severed for this run (an emplaced restriction).
   *  Empty for the unrestricted baseline. */
  blockedEdgeCount: number;
  spread: BehaviourSpread;
  seed: number;
  maxSteps: number;
  /** True when any cell any mover crossed carried estimated/fallback terrain
   *  data — the ordinary Tier 0 flag, orthogonal to `behaviourModelled`. */
  usedEstimatedData: boolean;
}

export interface MovementSimulationOptions {
  moverCount?: number;
  spreadId?: string;
  seed?: number;
  /** How many full trajectories to keep for animation. */
  keepTrajectories?: number;
  /** Fires with 0..1 as movers complete, for progress UI. */
  onProgress?: (fraction: number) => void;
  /** Directed edges severed by an emplaced restriction. Never traversable. */
  blockedEdges?: Set<string>;
  /** Reuse a cache across runs over the same grid (restrictionPlanner.ts). */
  edgeCache?: EdgeCostCache;
  /** Precomputed cost-to-go field, if the caller already has one for exactly
   *  this `blockedEdges` set. Omit and it is computed here. */
  costToGo?: Map<string, number>;
}

const DEFAULT_MOVER_COUNT = 240;
const DEFAULT_KEEP_TRAJECTORIES = 14;

/** Bearing in radians from a→b, for the turn penalty. */
function bearingRad(a: LatLng, b: LatLng): number {
  const dLng = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dLat = b.lat - a.lat;
  return Math.atan2(dLng, dLat);
}

/** Smallest absolute angle between two bearings, radians (0..π). */
function angleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.round((sortedAscending.length - 1) * p)));
  return sortedAscending[idx];
}

/**
 * Run the ensemble. Pure and synchronous — no network, no DOM — so it runs
 * either on the main thread or (as it actually does) inside the existing
 * mobility Web Worker, over the SAME already-sampled cells the appreciation
 * searched. It never resamples and never invents a cell.
 */
export function simulateMovementEnsemble(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  hexSize: number,
  proj: LocalProjection,
  options: MovementSimulationOptions = {}
): MovementEnsembleResult | null {
  const moverCount = Math.max(1, options.moverCount ?? DEFAULT_MOVER_COUNT);
  const spread = getBehaviourSpread(options.spreadId ?? DEFAULT_BEHAVIOUR_SPREAD_ID);
  const seed = options.seed ?? DEFAULT_MOVEMENT_SIM_SEED;
  const keepTrajectories = options.keepTrajectories ?? DEFAULT_KEEP_TRAJECTORIES;

  const blockedEdges = options.blockedEdges;
  const cache = options.edgeCache ?? createEdgeCostCache(cells, profile, nightMode);
  const byKey = cache.byKey;
  const originSeeds = originKeys.filter(k => byKey.has(k));
  const objectiveSet = new Set(objectiveKeys.filter(k => byKey.has(k)));
  if (originSeeds.length === 0 || objectiveSet.size === 0) return null;

  // The mover's perfect-knowledge belief: exact seconds remaining to the
  // objective from every cell, computed once for the whole ensemble.
  const trueToGo = options.costToGo
    ?? runCostToGoSearch(cells, [...objectiveSet], profile, nightMode, blockedEdges);
  const optimalSecondsRaw = originSeeds
    .map(k => trueToGo.get(k))
    .filter((t): t is number => typeof t === 'number' && isFinite(t));
  const optimalSeconds = optimalSecondsRaw.length > 0 ? Math.min(...optimalSecondsRaw) : null;

  // The mover's bearing-only belief: straight-line distance to the NEAREST
  // objective cell centre ÷ its own nominal cross-country speed. Precomputed
  // per cell — it does not depend on the mover.
  const nominalMs = (nominalCrossCountrySpeedKmh(profile, nightMode) * 1000) / 3600;
  const objectiveCentres = [...objectiveSet].map(k => byKey.get(k)!.center);
  const naiveToGo = new Map<string, number>();
  for (const cell of cells) {
    let nearest = Infinity;
    for (const oc of objectiveCentres) {
      const d = calculateDistance(cell.center.lat, cell.center.lng, oc.lat, oc.lng);
      if (d < nearest) nearest = d;
    }
    naiveToGo.set(cell.key, nearest / nominalMs);
  }

  const roadAffinityBase = baseRoadAffinitySeconds(profile);

  // Step budget: generous enough that a mover working around a large obstacle
  // is not cut off mid-detour, bounded enough that a genuinely trapped mover
  // terminates. ~6× the grid's own diameter in cells.
  const maxSteps = Math.max(60, Math.round(6 * Math.sqrt(cells.length)));

  const rng = mulberry32(seed);
  const transitCounts = new Map<string, number>();
  const edgeTransit = new Map<string, number>();
  const arrivalTimes: number[] = [];
  const sampleTrajectories: MoverTrajectory[] = [];
  const tracks: MoverTrack[] = [];
  let lostCount = 0;
  let usedEstimatedData = false;

  // Keep an evenly-spaced sample of trajectories rather than the first N, so
  // the animated movers represent the whole ensemble, not just its opening.
  const trajectoryStride = Math.max(1, Math.floor(moverCount / Math.max(1, keepTrajectories)));

  for (let m = 0; m < moverCount; m++) {
    const behaviour: MoverBehaviour = {
      decisionTemperatureSeconds:
        spread.temperatureSecondsMin + rng() * (spread.temperatureSecondsMax - spread.temperatureSecondsMin),
      terrainKnowledge: spread.knowledgeMin + rng() * (spread.knowledgeMax - spread.knowledgeMin),
      roadAffinitySeconds:
        roadAffinityBase *
        (spread.roadAffinityMultiplierMin +
          rng() * (spread.roadAffinityMultiplierMax - spread.roadAffinityMultiplierMin)),
    };
    const tau = Math.max(1, behaviour.decisionTemperatureSeconds);
    const k = Math.min(1, Math.max(0, behaviour.terrainKnowledge));
    const roadAffinity = behaviour.roadAffinitySeconds;

    let cur = byKey.get(originSeeds[Math.floor(rng() * originSeeds.length)])!;
    let prevKey: string | null = null;
    let heading: number | null = null;
    let elapsed = 0;
    let arrived = objectiveSet.has(cur.key);
    const visits = new Map<string, number>([[cur.key, 1]]);
    const steps: SimulatedStep[] = [{ lat: cur.center.lat, lng: cur.center.lng, cumulativeSeconds: 0 }];
    const trackKeys: string[] = [cur.key];
    const crossed = new Set<string>([cur.key]);
    let moverSteps = 0;
    let moverOffNetworkSteps = 0;
    if (cur.vegEstimated) usedEstimatedData = true;

    for (let step = 0; step < maxSteps && !arrived; step++) {
      const candidates: { cell: MobilityGridCell; edge: number; score: number }[] = [];
      for (const n of cache.neighboursOf(cur.key)) {
        if (blockedEdges?.has(`${cur.key}|${n.key}`)) continue; // an emplaced restriction
        const edge = cache.seconds(cur, n);
        if (!isFinite(edge)) continue; // NO-GO — the ensemble may never cross it
        const trueTerm = trueToGo.get(n.key);
        const trueLookahead = typeof trueTerm === 'number' && isFinite(trueTerm)
          ? trueTerm
          : UNREACHABLE_LOOKAHEAD_SECONDS;
        const naiveLookahead = naiveToGo.get(n.key) ?? UNREACHABLE_LOOKAHEAD_SECONDS;
        const perceivedToGo = k * trueLookahead + (1 - k) * naiveLookahead;

        const turn = heading === null
          ? 0
          : TURN_PENALTY_SECONDS_PER_RADIAN * angleBetween(heading, bearingRad(cur.center, n.center));
        const revisit = REVISIT_PENALTY_SECONDS * (visits.get(n.key) ?? 0);
        // Network preference — the first-order route decision (see module
        // note 0). Leaving a formed surface costs believed time; regaining one
        // credits it. Symmetric on purpose: a mover that has been forced off
        // the road works its way back onto the network at the first chance,
        // which is exactly what makes a road block DISPLACE movement onto the
        // next road rather than scattering it evenly across the bush.
        let network = 0;
        if (cur.onTrail && !n.onTrail) network = roadAffinity;
        else if (!cur.onTrail && n.onTrail) network = -roadAffinity;
        candidates.push({ cell: n, edge, score: edge + perceivedToGo + turn + revisit + network });
      }
      if (candidates.length === 0) break; // genuinely boxed in

      // Never immediately step back the way we came unless there is no other
      // option — a mover does not bounce between two cells.
      const forward = candidates.filter(c => c.cell.key !== prevKey);
      const pool = forward.length > 0 ? forward : candidates;

      // Softmax, shifted by the best score for numerical stability.
      const best = Math.min(...pool.map(c => c.score));
      let total = 0;
      const weights = pool.map(c => {
        const w = Math.exp(-(c.score - best) / tau);
        total += w;
        return w;
      });
      let pick = pool.length - 1;
      if (total > 0) {
        let r = rng() * total;
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) { pick = i; break; }
        }
      }
      const chosen = pool[pick];

      heading = bearingRad(cur.center, chosen.cell.center);
      prevKey = cur.key;
      elapsed += chosen.edge; // the REAL cost, whatever the mover believed
      const onNetworkStep = cur.onTrail && chosen.cell.onTrail;
      edgeTransit.set(`${cur.key}|${chosen.cell.key}`, (edgeTransit.get(`${cur.key}|${chosen.cell.key}`) ?? 0) + 1);
      cur = chosen.cell;
      moverSteps++;
      if (!onNetworkStep) moverOffNetworkSteps++;
      visits.set(cur.key, (visits.get(cur.key) ?? 0) + 1);
      crossed.add(cur.key);
      trackKeys.push(cur.key);
      if (cur.vegEstimated) usedEstimatedData = true;
      steps.push({ lat: cur.center.lat, lng: cur.center.lng, cumulativeSeconds: elapsed });
      if (objectiveSet.has(cur.key)) arrived = true;
    }

    // One mover contributes at most once per cell — this is "what fraction of
    // movers passed through here", not "how many times was it stepped on".
    for (const key of crossed) transitCounts.set(key, (transitCounts.get(key) ?? 0) + 1);
    if (arrived) arrivalTimes.push(elapsed); else lostCount++;
    tracks.push({
      keys: trackKeys,
      totalSeconds: elapsed,
      arrived,
      crossCountryFraction: moverSteps > 0 ? moverOffNetworkSteps / moverSteps : 0,
    });
    if (m % trajectoryStride === 0 && sampleTrajectories.length < keepTrajectories) {
      sampleTrajectories.push({ steps, arrived, totalSeconds: elapsed, behaviour });
    }
    options.onProgress?.((m + 1) / moverCount);
  }

  const transitCells: TransitCell[] = [];
  for (const [key, count] of transitCounts) {
    const cell = byKey.get(key);
    if (!cell) continue;
    const local = axialToLocal(cell.hex, hexSize);
    const polygon = hexCorners(local, hexSize).map(p => toLatLng(proj, p));
    polygon.push(polygon[0]);
    transitCells.push({
      key,
      center: cell.center,
      polygon,
      transitFraction: count / moverCount,
      moverCount: count,
    });
  }
  transitCells.sort((a, b) => b.transitFraction - a.transitFraction);

  const sortedArrivals = [...arrivalTimes].sort((a, b) => a - b);

  return {
    behaviourModelled: true,
    moverCount,
    arrivedCount: arrivalTimes.length,
    lostCount,
    cells: transitCells,
    arrivalP10Seconds: percentile(sortedArrivals, 0.1),
    arrivalP50Seconds: percentile(sortedArrivals, 0.5),
    arrivalP90Seconds: percentile(sortedArrivals, 0.9),
    optimalSeconds,
    sampleTrajectories,
    tracks,
    edgeTransit,
    crossCountryFraction: tracks.length > 0
      ? tracks.reduce((s, t) => s + t.crossCountryFraction, 0) / tracks.length
      : 0,
    blockedEdgeCount: blockedEdges?.size ?? 0,
    spread,
    seed,
    maxSteps,
    usedEstimatedData,
  };
}
