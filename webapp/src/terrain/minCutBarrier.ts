/**
 * Min-cut counter-mobility barrier siting — Pass 2
 * (docs/ROUTE_INTELLIGENCE.md §4, §15.2).
 *
 * The headline finding behind this module: a fire break and a counter-
 * mobility barrier are the same object — a line severing a plane. Here, the
 * cheapest set of cells that disconnects the origin AOI from the objective
 * AOI for a given mover is exactly a minimum s-t cut over the same hex
 * adjacency graph the search already uses.
 *
 * IMPLEMENTATION NOTE, stated plainly: the design doc's original framing
 * ("min-cut = shortest path in the planar dual graph") is the elegant,
 * classical result for planar graphs, but implementing that construction
 * correctly for a HEX grid under time pressure was judged a real risk of a
 * subtly wrong answer — exactly the kind of confident-but-incorrect output
 * this project's data-honesty principle forbids. This ships instead via the
 * standard, well-understood max-flow/min-cut equivalence (Ford-Fulkerson,
 * Edmonds-Karp augmenting paths), which is straightforward to verify by
 * construction (the returned cut value must equal the max flow found, and
 * removing the cut edges must genuinely disconnect origin from objective —
 * both checked in the smoke test). The dual-graph shortest-path form remains
 * a valid future performance optimisation, not a correctness requirement.
 *
 * CAPACITY MODEL, also stated plainly: capacity is UNIT per passable edge
 * (GO/SLOW-GO only — a NO-GO edge already carries no traffic and is excluded
 * entirely), multiplied when both ends are on a mapped trail — TIERED by the
 * trail's own OSM `highway` classification (docs §42 follow-on, 2026-07-28)
 * rather than a single flat multiplier for "on a trail" regardless of class.
 * A two-lane sealed highway and a single-track fire trail were previously
 * treated as identical throughput once either counted as `onTrail`, which
 * meant a genuine highway chokepoint and a farm track chokepoint could tie on
 * cut value for no real reason. `HIGHWAY_CAPACITY_TIER` reuses the SAME real,
 * sourced classification (`nearestTrailTags.highway`, already on every cell —
 * accumulatedCost.ts) the road-class speed model keys off — not a second,
 * unrelated hierarchy invented for this. The MULTIPLIER VALUES themselves are
 * still an engineering judgement (no source gives an exact vehicle-capacity-
 * per-road-class figure, same honesty position the original flat 3× already
 * held) — only the fact that they now vary by real class, rather than
 * collapsing every trail to one bucket, is new. This is NOT yet weighted by
 * real vehicle-capacity data (VCI/RCI, docs §6a) — that needs the soil layers
 * Pass 3 brings in. So today's min-cut answers "the fewest, most
 * trail-class-aware chokepoints that fully sever this corridor", not yet
 * "the cheapest to physically build" — the latter needs the Pass 4
 * production-model + breach-cost integration this doc's §5 already gates on
 * a citable basis.
 */

import { LatLng } from '../utils/chainage';
import { hexKey, hexNeighbors } from '../utils/hexGrid';
import { MobilityGridCell, toMobilitySample } from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { edgeMobilityCost } from './mobilityCost';
import { calculateDistance } from '../utils/slopeCalculation';
import { RoadGraph } from './roadGraph';
import { edgeTravelTime } from './roadRouting';
import { RoadSpeedOverrides } from './roadSpeedModel';

const SOURCE = '__SOURCE__';
const SINK = '__SINK__';

/** Capacity multiplier by OSM `highway` class, tiered off the SAME real
 *  classification `roadSpeedModel.ts`'s `HIGHWAY_SPEED_KMH` keys off — see
 *  the module header. Absent classes (a track/path with no clearer tag, or a
 *  trail whose nearest-feature scan didn't resolve a class) fall back to
 *  `DEFAULT_TRAIL_CAPACITY_MULTIPLIER`, matching the original flat value this
 *  replaces. */
const HIGHWAY_CAPACITY_TIER: Readonly<Record<string, number>> = {
  motorway: 8, motorway_link: 8,
  trunk: 7, trunk_link: 7,
  primary: 6, primary_link: 6,
  secondary: 5, secondary_link: 5,
  tertiary: 4, tertiary_link: 4,
  unclassified: 3, residential: 3, living_street: 3, service: 3,
};
const DEFAULT_TRAIL_CAPACITY_MULTIPLIER = 3;

/** Capacity for one passable edge, unit per cross-country hex, tiered when
 *  both ends sit on a mapped trail (see module header). Reads the FROM cell's
 *  own resolved trail tags — `onTrail` for both ends already means they were
 *  snapped to the same nearby feature in the overwhelming common case (a
 *  short hex edge), so a second independent lookup on the neighbour would
 *  only ever re-derive the same class at real extra cost, not new information. */
function edgeCapacity(cell: MobilityGridCell, neighbor: MobilityGridCell): number {
  if (!cell.onTrail || !neighbor.onTrail) return 1;
  const highway = cell.nearestTrailTags?.highway;
  return (highway ? HIGHWAY_CAPACITY_TIER[highway] : undefined) ?? DEFAULT_TRAIL_CAPACITY_MULTIPLIER;
}

export interface BarrierSegment {
  fromKey: string;
  toKey: string;
  from: LatLng;
  to: LatLng;
}

export interface MinCutResult {
  segments: BarrierSegment[];
  /** Total capacity severed (= the max flow value) — informational, not a
   *  physical cost figure (see module note above). */
  cutValue: number;
  /** Cells on the origin side of the cut, for map shading. */
  originSideKeys: string[];
}

class ResidualGraph {
  private cap = new Map<string, Map<string, number>>();

  private ensure(u: string): Map<string, number> {
    let m = this.cap.get(u);
    if (!m) { m = new Map(); this.cap.set(u, m); }
    return m;
  }

  /** Add a directed edge with the given capacity, plus its reverse residual
   *  arc (0 capacity initially, per standard max-flow bookkeeping). */
  addEdge(u: string, v: string, capacity: number): void {
    const uMap = this.ensure(u);
    uMap.set(v, (uMap.get(v) ?? 0) + capacity);
    this.ensure(v); // ensure a reverse-arc entry exists (defaults to 0 via get() ?? 0)
  }

  capacityOf(u: string, v: string): number {
    return this.cap.get(u)?.get(v) ?? 0;
  }

  neighborsOf(u: string): string[] {
    return Array.from(this.cap.get(u)?.keys() ?? []);
  }

  /** Push `amount` of flow along u->v (decrease forward residual, increase
   *  reverse residual — standard Edmonds-Karp bookkeeping). */
  pushFlow(u: string, v: string, amount: number): void {
    const uMap = this.ensure(u);
    uMap.set(v, (uMap.get(v) ?? 0) - amount);
    const vMap = this.ensure(v);
    vMap.set(u, (vMap.get(u) ?? 0) + amount);
  }
}

/** BFS for an augmenting path from SOURCE to SINK with remaining capacity > 0.
 *  Returns the parent-pointer map, or null if SINK is unreachable. */
function bfsAugmentingPath(graph: ResidualGraph): Map<string, string> | null {
  const parent = new Map<string, string>();
  const visited = new Set<string>([SOURCE]);
  const queue: string[] = [SOURCE];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    if (u === SINK) return parent;
    for (const v of graph.neighborsOf(u)) {
      if (visited.has(v)) continue;
      if (graph.capacityOf(u, v) <= 1e-9) continue;
      visited.add(v);
      parent.set(v, u);
      queue.push(v);
    }
  }
  return visited.has(SINK) ? parent : null;
}

/**
 * Minimum s-t cut severing the origin AOI from the objective AOI, for one
 * mover profile. Returns null if the objective is already unreachable (cut
 * value 0 / nothing to sever) or the grid is degenerate.
 */
export function computeMinCutBarrier(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean
): MinCutResult | null {
  if (cells.length === 0) return null;
  const byKey = new Map(cells.map(c => [c.key, c]));
  const graph = new ResidualGraph();

  let edgeCount = 0;
  for (const cell of cells) {
    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const result = edgeMobilityCost(profile, toMobilitySample(cell), toMobilitySample(neighbor), dist, { nightMode, crossSlopeDeg: cell.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue; // NO-GO — carries no traffic, excluded
      graph.addEdge(cell.key, nKey, edgeCapacity(cell, neighbor));
      edgeCount++;
    }
  }
  if (edgeCount === 0) return null;

  const INF = 1e9;
  for (const key of originKeys) if (byKey.has(key)) graph.addEdge(SOURCE, key, INF);
  for (const key of objectiveKeys) if (byKey.has(key)) graph.addEdge(key, SINK, INF);

  let maxFlow = 0;
  for (let guard = 0; guard < 200000; guard++) {
    const parent = bfsAugmentingPath(graph);
    if (!parent) break;
    let bottleneck = Infinity;
    let v = SINK;
    while (v !== SOURCE) {
      const u = parent.get(v)!;
      bottleneck = Math.min(bottleneck, graph.capacityOf(u, v));
      v = u;
    }
    v = SINK;
    while (v !== SOURCE) {
      const u = parent.get(v)!;
      graph.pushFlow(u, v, bottleneck);
      v = u;
    }
    maxFlow += bottleneck;
  }

  if (maxFlow >= INF / 2) return null; // objective effectively unseverable (shouldn't happen with finite capacities)
  if (maxFlow === 0) return null; // origin and objective already disconnected before any cut

  // Final BFS over the residual graph from SOURCE finds the origin-side set;
  // the min-cut edges are original (pre-flow) edges crossing that boundary.
  const reachable = new Set<string>([SOURCE]);
  const queue = [SOURCE];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const v of graph.neighborsOf(u)) {
      if (reachable.has(v)) continue;
      if (graph.capacityOf(u, v) > 1e-9) { reachable.add(v); queue.push(v); }
    }
  }

  const segments: BarrierSegment[] = [];
  for (const cell of cells) {
    if (!reachable.has(cell.key)) continue;
    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      if (reachable.has(nKey)) continue; // not crossing the cut boundary
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const result = edgeMobilityCost(profile, toMobilitySample(cell), toMobilitySample(neighbor), dist, { nightMode, crossSlopeDeg: cell.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue; // wasn't a real edge in the original graph
      segments.push({ fromKey: cell.key, toKey: nKey, from: cell.center, to: neighbor.center });
    }
  }

  return {
    segments,
    cutValue: maxFlow,
    originSideKeys: Array.from(reachable).filter(k => k !== SOURCE && k !== SINK),
  };
}

// ---------------------------------------------------------------------------
// Road-network-EXACT min-cut (docs §42b, 2026-07-28) — the "genuinely
// road-graph-aware" half of the "fuse road-graph routes into min-cut" roadmap
// item, closing the gap the hex-based cut above always had: it can only ever
// sever a whole HEX, never a specific point along a road narrower than one.
//
// This is deliberately NOT a rewrite of `computeMinCutBarrier` to accept a
// mixed hex+road adjacency (that remains the larger, harder architectural
// change) — it is a SEPARATE, self-contained max-flow problem run directly
// over the road graph's own nodes and edges, reusing the identical
// `ResidualGraph`/`bfsAugmentingPath` machinery above unchanged (both are
// already generic over string node IDs — nothing hex-specific in either).
// Where the hex cut answers "the cheapest set of hexes that severs ALL
// movement, on- or off-road", this answers "the cheapest set of REAL road
// segments that severs the road network specifically" — a genuinely more
// precise answer for the vehicle/road case, at the exact resolution the road
// graph itself carries (a single OSM vertex-to-vertex edge, which is very
// often far narrower than one hex). Vehicle profiles only, matching every
// other road-graph consumer in this codebase (`roadRouteSearch.ts`) — a
// road-class speed ceiling has no meaning for a foot mover.
//
// Capacity reuses the SAME `HIGHWAY_CAPACITY_TIER` table the hex cut's
// `edgeCapacity` reads — one real classification, not two independently
// tuned hierarchies for what is conceptually the same "how much throughput
// does this road class carry" question.
// ---------------------------------------------------------------------------

export interface RoadBarrierSegment {
  fromNodeId: string;
  toNodeId: string;
  from: LatLng;
  to: LatLng;
  /** The OSM way this segment belongs to, when named — for a log line/label,
   *  mirroring `roadRouteSearch.ts`'s own `wayNames` treatment. */
  wayName?: string;
}

export interface RoadMinCutResult {
  segments: RoadBarrierSegment[];
  /** Total capacity severed (= the max flow value) — same informational,
   *  not-a-physical-cost-figure caveat as `MinCutResult.cutValue`. */
  cutValue: number;
  /** Road graph node IDs on the origin side of the cut. */
  originSideNodeIds: string[];
}

/**
 * Minimum s-t cut over the road graph's own nodes/edges, severing
 * `originNodeIds` from `objectiveNodeIds` — the road-network access points a
 * caller has already resolved (e.g. `nodesWithin` in `roadGraph.ts`, the same
 * seed sets `findVehicleRoadRoute` uses). Returns null under the same
 * conditions as `computeMinCutBarrier`: no edges at all, the objective
 * already disconnected (nothing to sever), or a degenerate/empty graph.
 */
export function computeRoadNetworkMinCut(
  graph: RoadGraph,
  originNodeIds: string[],
  objectiveNodeIds: string[],
  profile: MoverProfile,
  overrides?: RoadSpeedOverrides
): RoadMinCutResult | null {
  if (graph.nodes.size === 0) return null;
  const flowGraph = new ResidualGraph();

  let edgeCount = 0;
  for (const [fromId, edges] of graph.adjacency) {
    for (const edge of edges) {
      const travel = edgeTravelTime(edge, profile, overrides);
      if (travel.blocked) continue; // a real NO-GO (impassable/unfordable) — carries no traffic, excluded
      const highway = edge.wayTags.highway;
      const capacity = (highway ? HIGHWAY_CAPACITY_TIER[highway] : undefined) ?? DEFAULT_TRAIL_CAPACITY_MULTIPLIER;
      flowGraph.addEdge(fromId, edge.to, capacity);
      edgeCount++;
    }
  }
  if (edgeCount === 0) return null;

  const INF = 1e9;
  for (const id of originNodeIds) if (graph.nodes.has(id)) flowGraph.addEdge(SOURCE, id, INF);
  for (const id of objectiveNodeIds) if (graph.nodes.has(id)) flowGraph.addEdge(id, SINK, INF);

  let maxFlow = 0;
  for (let guard = 0; guard < 200000; guard++) {
    const parent = bfsAugmentingPath(flowGraph);
    if (!parent) break;
    let bottleneck = Infinity;
    let v = SINK;
    while (v !== SOURCE) {
      const u = parent.get(v)!;
      bottleneck = Math.min(bottleneck, flowGraph.capacityOf(u, v));
      v = u;
    }
    v = SINK;
    while (v !== SOURCE) {
      const u = parent.get(v)!;
      flowGraph.pushFlow(u, v, bottleneck);
      v = u;
    }
    maxFlow += bottleneck;
  }

  if (maxFlow >= INF / 2) return null;
  if (maxFlow === 0) return null;

  const reachable = new Set<string>([SOURCE]);
  const queue = [SOURCE];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const v of flowGraph.neighborsOf(u)) {
      if (reachable.has(v)) continue;
      if (flowGraph.capacityOf(u, v) > 1e-9) { reachable.add(v); queue.push(v); }
    }
  }

  const segments: RoadBarrierSegment[] = [];
  for (const [fromId, edges] of graph.adjacency) {
    if (!reachable.has(fromId)) continue;
    for (const edge of edges) {
      if (reachable.has(edge.to)) continue; // not crossing the cut boundary
      const travel = edgeTravelTime(edge, profile, overrides);
      if (travel.blocked) continue; // wasn't a real edge in the original graph
      const fromNode = graph.nodes.get(fromId);
      const toNode = graph.nodes.get(edge.to);
      if (!fromNode || !toNode) continue;
      segments.push({
        fromNodeId: fromId,
        toNodeId: edge.to,
        from: { lat: fromNode.lat, lng: fromNode.lng },
        to: { lat: toNode.lat, lng: toNode.lng },
        wayName: edge.wayName,
      });
    }
  }

  return {
    segments,
    cutValue: maxFlow,
    originSideNodeIds: Array.from(reachable).filter(id => id !== SOURCE && id !== SINK),
  };
}
