/**
 * Road-network routing — Terrain Mobility Slice A (docs/ROUTE_INTELLIGENCE.md
 * §35). A* over the `RoadGraph` built by `roadGraph.ts`, then k-dissimilar
 * alternatives by the SAME iterative-penalty idiom `corridorAnalysis.ts`'s
 * `findKDissimilarPaths` already uses for the hex-grid search — deliberately
 * reused, not reinvented, so a route set from either graph means the same
 * thing to a caller (penalise used edges, re-search, stop on duplicate or
 * exhaustion).
 *
 * BOX-FREE BY CONSTRUCTION: unlike the hex grid this graph has no bounding
 * box at all — a vehicle follows a road wherever it leads. This is what
 * fixes the reported Lake George "no route" defect for vehicle movement
 * without any grid rewrite (§35's Slice B is the separate, off-road half).
 *
 * SPEED COMPOSITION: `roadSpeedModel.ts`'s road-class ceiling applies ONLY to
 * `vehicle-gradient` profiles (wheeled/tracked) — composed as
 * `min(profile.roadSpeedKmh, roadClassCeiling)`, never a replacement. Foot
 * profiles use `profile.roadSpeedKmh` alone with NO road-class ceiling: a
 * foot unit can and does follow roads at its own doctrinal march rate, but
 * OSRM's car-derived class speeds have no bearing on how fast a person walks
 * (see roadSpeedModel.ts's own header on why applying them to a foot mover
 * would be a fabrication).
 */

import { RoadGraph, RoadEdge } from './roadGraph';
import { roadClassCeiling, RoadSpeedOverrides, RoadClassConfidence } from './roadSpeedModel';
import { MoverProfile } from './moverProfiles';

// ---------------------------------------------------------------------------
// MinHeap — small, self-contained, same style as accumulatedCost.ts's own
// (deliberately duplicated rather than shared: this module has no import
// dependency on the hex-grid search, matching roadGraph.ts's own approach).
// ---------------------------------------------------------------------------
class MinHeap {
  private items: { key: string; priority: number }[] = [];
  get size(): number { return this.items.length; }
  push(key: string, priority: number): void {
    this.items.push({ key, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop(): { key: string; priority: number } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < n && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** The fastest speed anything in `roadSpeedModel.ts`'s tables can imply
 *  (motorway, 90 km/h) — used ONLY to build an admissible A* heuristic
 *  (never overestimate remaining cost). Not a claim about any real profile's
 *  speed. */
const FASTEST_POSSIBLE_KMH = 90;

export interface EdgeTravelResult {
  seconds: number;
  /** NO-GO — e.g. `smoothness=impassable` composed to 0 km/h. The caller
   *  must not traverse this edge, not treat it as merely slow. */
  blocked: boolean;
  confidence: RoadClassConfidence | 'vehicle-capability-only';
  source: string;
}

/**
 * Travel time for ONE directed edge, for one mover profile. This is the only
 * place `roadClassCeiling` is composed with a profile — see module header for
 * why foot profiles skip the composition entirely.
 */
export function edgeTravelTime(
  edge: RoadEdge,
  profile: MoverProfile,
  overrides?: RoadSpeedOverrides
): EdgeTravelResult {
  const isVehicle = profile.speedModel === 'vehicle-gradient';

  let speedKmh = profile.roadSpeedKmh;
  let confidence: EdgeTravelResult['confidence'] = 'vehicle-capability-only';
  let source = `${profile.label} road capability only (foot profile — road class does not modulate walking speed)`;

  if (isVehicle) {
    const ceiling = roadClassCeiling(edge.wayTags, overrides);
    if (ceiling) {
      speedKmh = Math.min(profile.roadSpeedKmh, ceiling.speedKmh);
      confidence = ceiling.confidence;
      source = speedKmh === profile.roadSpeedKmh
        ? `${profile.label} own road speed (vehicle-limited; road ceiling was ${ceiling.speedKmh} km/h — ${ceiling.source})`
        : `road-limited — ${ceiling.source}`;
    } else {
      source = `${profile.label} own road speed (no road-class data on this way at all)`;
    }
  }

  if (speedKmh <= 0) {
    return { seconds: Infinity, blocked: true, confidence, source };
  }
  const speedMs = (speedKmh * 1000) / 3600;
  return { seconds: edge.distanceM / speedMs, blocked: false, confidence, source };
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

export interface RoadRouteResult {
  nodeIds: string[];
  totalSeconds: number;
}

export interface RoadRouteOptions {
  /** Multiplicative penalty per DIRECTED edge (keyed `${fromId}|${toId}`) —
   *  same mechanism `AccumulatedCostSearchOptions.edgePenalties` uses on the
   *  hex-grid search, consumed by `findKDissimilarRoadRoutes` below. */
  edgePenalties?: Map<string, number>;
  overrides?: RoadSpeedOverrides;
}

/**
 * Multi-source, multi-target A* from any of `originNodeIds` to the nearest of
 * `objectiveNodeIds`. Straight-line-distance-at-`FASTEST_POSSIBLE_KMH`
 * heuristic keeps this admissible regardless of which mover profile or road
 * mix is in play. Returns `null` when no route exists AT ALL through this
 * graph — a genuinely disconnected road network (e.g. the fetched corridor's
 * roads don't actually connect origin to objective), not a bounding-box
 * artefact, since this graph has no box.
 */
export function findRoadRoute(
  graph: RoadGraph,
  originNodeIds: string[],
  objectiveNodeIds: string[],
  profile: MoverProfile,
  options: RoadRouteOptions = {}
): RoadRouteResult | null {
  if (originNodeIds.length === 0 || objectiveNodeIds.length === 0) return null;
  const objectiveSet = new Set(objectiveNodeIds);

  const objectiveNodes = objectiveNodeIds
    .map(id => graph.nodes.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n);
  if (objectiveNodes.length === 0) return null;

  const heuristic = (nodeId: string): number => {
    const node = graph.nodes.get(nodeId);
    if (!node) return 0;
    let best = Infinity;
    for (const obj of objectiveNodes) {
      const dLat = ((obj.lat - node.lat) * Math.PI) / 180;
      const dLng = ((obj.lng - node.lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((node.lat * Math.PI) / 180) * Math.cos((obj.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const distM = 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distM < best) best = distM;
    }
    const speedMs = (FASTEST_POSSIBLE_KMH * 1000) / 3600;
    return best / speedMs; // admissible: no real edge can be faster than this
  };

  const gScore = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap = new MinHeap();
  const closed = new Set<string>();

  for (const id of originNodeIds) {
    if (!graph.nodes.has(id)) continue;
    gScore.set(id, 0);
    heap.push(id, heuristic(id));
  }

  let reachedObjective: string | null = null;
  while (heap.size > 0) {
    const current = heap.pop()!;
    if (closed.has(current.key)) continue;
    closed.add(current.key);

    if (objectiveSet.has(current.key)) {
      reachedObjective = current.key;
      break;
    }

    const currentG = gScore.get(current.key) ?? Infinity;
    const edges = graph.adjacency.get(current.key) ?? [];
    for (const edge of edges) {
      if (closed.has(edge.to)) continue;
      const travel = edgeTravelTime(edge, profile, options.overrides);
      if (travel.blocked) continue; // a real NO-GO — never traversed, not just costly

      const penaltyKey = `${edge.from}|${edge.to}`;
      const penalty = options.edgePenalties?.get(penaltyKey) ?? 1;
      const tentativeG = currentG + travel.seconds * penalty;

      if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentativeG);
        prev.set(edge.to, current.key);
        heap.push(edge.to, tentativeG + heuristic(edge.to));
      }
    }
  }

  if (!reachedObjective) return null;

  const nodeIds: string[] = [reachedObjective];
  let cursor = reachedObjective;
  while (prev.has(cursor)) {
    cursor = prev.get(cursor)!;
    nodeIds.push(cursor);
  }
  nodeIds.reverse();

  return { nodeIds, totalSeconds: gScore.get(reachedObjective) ?? 0 };
}

// ---------------------------------------------------------------------------
// k-dissimilar alternatives — same idiom as corridorAnalysis.findKDissimilarPaths
// ---------------------------------------------------------------------------

/** Same multiplier `corridorAnalysis.ts` uses for the hex-grid search —
 *  deliberately identical, not independently tuned, so route diversity
 *  behaves consistently regardless of which graph produced it. */
const PENALTY_MULTIPLIER = 6;

/**
 * Up to `k` distinct road routes via iterative-penalty re-search — block a
 * route's edges, re-run, repeat until `k` routes are found, the search can no
 * longer find anything new, or no route exists at all. Mirrors
 * `corridorAnalysis.findKDissimilarPaths`'s duplicate-route guard exactly.
 */
export function findKDissimilarRoadRoutes(
  graph: RoadGraph,
  originNodeIds: string[],
  objectiveNodeIds: string[],
  profile: MoverProfile,
  k = 3,
  options: RoadRouteOptions = {}
): RoadRouteResult[] {
  const edgePenalties = new Map<string, number>(options.edgePenalties ?? []);
  const routes: RoadRouteResult[] = [];

  for (let i = 0; i < k; i++) {
    const route = findRoadRoute(graph, originNodeIds, objectiveNodeIds, profile, { ...options, edgePenalties });
    if (!route) break;

    if (routes.some(r => r.nodeIds.length === route.nodeIds.length && r.nodeIds.every((id, idx) => id === route.nodeIds[idx]))) {
      break;
    }
    routes.push(route);

    for (let j = 1; j < route.nodeIds.length; j++) {
      const forwardKey = `${route.nodeIds[j - 1]}|${route.nodeIds[j]}`;
      const backwardKey = `${route.nodeIds[j]}|${route.nodeIds[j - 1]}`;
      edgePenalties.set(forwardKey, (edgePenalties.get(forwardKey) ?? 1) * PENALTY_MULTIPLIER);
      edgePenalties.set(backwardKey, (edgePenalties.get(backwardKey) ?? 1) * PENALTY_MULTIPLIER);
    }
  }

  return routes;
}
