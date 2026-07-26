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
 * entirely), tripled when both ends are on a mapped trail (real sampled data,
 * not an invented number) on the reasoning that a trail carries more
 * realistic throughput than the same distance cross-country. This is NOT yet
 * weighted by real vehicle-capacity data (VCI/RCI, docs §6a) — that needs the
 * soil layers Pass 3 brings in. So today's min-cut answers "the fewest,
 * most trail-favouring chokepoints that fully sever this corridor", not yet
 * "the cheapest to physically build" — the latter needs the Pass 4
 * production-model + breach-cost integration this doc's §5 already gates on
 * a citable basis.
 */

import { LatLng } from '../utils/chainage';
import { hexKey, hexNeighbors } from '../utils/hexGrid';
import { MobilityGridCell } from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { edgeMobilityCost, MobilitySample } from './mobilityCost';
import { calculateDistance } from '../utils/slopeCalculation';

const SOURCE = '__SOURCE__';
const SINK = '__SINK__';
const TRAIL_CAPACITY_MULTIPLIER = 3;

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

  const toSample = (c: MobilityGridCell): MobilitySample => ({
    lat: c.center.lat, lng: c.center.lng, elevation: c.elevation,
    vegetation: c.vegetation, vegEstimated: c.vegEstimated, onTrail: c.onTrail,
  });

  let edgeCount = 0;
  for (const cell of cells) {
    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const result = edgeMobilityCost(profile, toSample(cell), toSample(neighbor), dist, { nightMode });
      if (!isFinite(result.timeSeconds)) continue; // NO-GO — carries no traffic, excluded
      const capacity = cell.onTrail && neighbor.onTrail ? TRAIL_CAPACITY_MULTIPLIER : 1;
      graph.addEdge(cell.key, nKey, capacity);
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
      const result = edgeMobilityCost(profile, toSample(cell), toSample(neighbor), dist, { nightMode });
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
