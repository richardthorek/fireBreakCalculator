/**
 * Road network graph — Terrain Mobility Slice A (docs/ROUTE_INTELLIGENCE.md
 * §35). Builds a routable node/edge graph from the OSM ways
 * `infrastructureService.ts`'s `highway-mobility` kind fetches.
 *
 * WHY A SEPARATE GRAPH, NOT MORE HEX CELLS: roads are a NETWORK — a vehicle
 * follows a road wherever it leads, with no tessellation and no bounding box.
 * Hexes are a TESSELLATION of open ground. Forcing road routing through the
 * hex grid was the mechanism that produced §35's root defect (padding
 * proportional to a span that has nothing to do with where a road actually
 * runs). A road graph sidesteps that failure mode entirely, by construction.
 *
 * TOPOLOGY: OSM ways SHARE actual node coordinates at junctions — two ways
 * that meet at an intersection carry the identical lat/lng for that vertex
 * in Overpass's `out geom` response. Nodes are therefore identified by a
 * rounded coordinate key (6 dp ≈ 0.11 m — tight enough that two genuinely
 * distinct nodes essentially never collide, loose enough to absorb any float
 * noise), not by OSM node IDs (which `out geom` does not return). every
 * vertex of every way becomes a node, not just endpoints, so a Y-junction
 * partway along a mapped way is still captured correctly.
 *
 * NOT MODELLED (recorded, not silently dropped): `oneway` restrictions.
 * Every edge is treated as bidirectional. OSM's `oneway` tag is available in
 * the same `out geom` response as the other tags this module consumes, so
 * this is a real, addressable gap for a later pass — not a data limitation,
 * a scope cut. For counter-mobility planning (denial, chokepoint siting)
 * this is conservative in the direction that matters less: a one-way
 * restriction can only ever REDUCE an approaching force's real options
 * relative to what this graph assumes, so a corridor this graph finds is
 * never falsely optimistic about a road being usable in both directions
 * where oneway would forbid one.
 */

import type { RoadWayTags } from './roadSpeedModel';

export interface LatLngLike { lat: number; lng: number; }

export interface RoadNode {
  id: string;
  lat: number;
  lng: number;
}

export interface RoadEdge {
  from: string;
  to: string;
  distanceM: number;
  /** Tags of the WAY this edge segment belongs to — feeds `roadClassCeiling`. */
  wayTags: RoadWayTags;
  wayName?: string;
  /** True when this edge sits inside a CONTIGUOUS run of the way's own
   *  geometry passing through the interior of a mapped standing water body
   *  (a lake/reservoir), longer than a single plausible bridge span (docs §35
   *  addendum, 2026-07-28 — Lake George again: field-tested, a vehicle route
   *  ran straight across the real lake. Root cause: this graph had ZERO water
   *  awareness at all, unlike the hex-grid search's own
   *  `estimateFordingRequirement` gate — a road/track tagged in OSM across a
   *  lake bed that is dry often enough for vehicles to have driven and mapped
   *  it was simply never checked). A SHORT dip into a water polygon — a real
   *  bridge or causeway abutment — is deliberately NOT flagged; see
   *  `MAX_ASSUMED_BRIDGE_SPAN_M`. Consumed by `roadRouting.ts`'s
   *  `edgeTravelTime`, which blocks it for any profile without a stated
   *  fording capability, mirroring `mobilityCost.ts`'s "standing water body —
   *  assumed genuinely deep" default exactly. */
  crossesStandingWater?: boolean;
}

/** Minimal water-body polygon shape — mirrors `RoadWay`'s own "no import
 *  dependency" design (see that interface's doc comment): the caller maps
 *  its own `InfrastructureTrail`/`kind === 'water'` features into this shape
 *  rather than this module importing `infrastructureService.ts`. */
export interface WaterBodyPolygon {
  coords: LatLngLike[];
}

/** How far a road may run through the interior of a mapped standing water
 *  body and still be assumed to be a real bridge/causeway rather than a
 *  track across dry ground (docs §35 addendum, 2026-07-28). A genuine bridge
 *  span is typically tens to a few hundred metres; Lake George's own
 *  reported crossing was ~8.5 km — nowhere near this threshold, which is
 *  deliberately generous in the direction of NOT falsely blocking a real,
 *  short causeway. */
const MAX_ASSUMED_BRIDGE_SPAN_M = 250;

/** Ray-casting point-in-polygon — self-contained rather than pulling in
 *  `@turf/boolean-point-in-polygon` (`infrastructureService.ts`'s own
 *  choice), matching this module's stated "no import dependency" design. */
function pointInPolygon(p: LatLngLike, polygon: LatLngLike[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = (yi > p.lat) !== (yj > p.lat) &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInAnyWaterBody(p: LatLngLike, waterBodies: WaterBodyPolygon[]): boolean {
  for (const body of waterBodies) {
    if (body.coords.length < 4) continue; // not enough vertices to be a meaningful ring
    if (pointInPolygon(p, body.coords)) return true;
  }
  return false;
}

export interface RoadGraph {
  nodes: Map<string, RoadNode>;
  /** Every edge leaving a node, both directions (see module header on
   *  `oneway` not being modelled — this is why adjacency is symmetric). */
  adjacency: Map<string, RoadEdge[]>;
  /** Total way count the graph was built from, for logging/honesty (e.g. "0
   *  ways" should read as "no road data", distinct from "built, empty area"
   *  at the call site). */
  wayCount: number;
}

/** Input way shape — matches `InfrastructureTrail` from either
 *  `infrastructureService.ts` copy, kept minimal here so this module has no
 *  import dependency on either (mirrors `roadSpeedModel.ts`'s own approach). */
export interface RoadWay {
  name?: string;
  kind: string; // OSM highway tag value
  coords: LatLngLike[];
  surface?: string;
  tracktype?: string;
  smoothness?: string;
}

const NODE_KEY_PRECISION = 6; // ~0.11 m at the equator

function nodeKey(lat: number, lng: number): string {
  return `${lat.toFixed(NODE_KEY_PRECISION)},${lng.toFixed(NODE_KEY_PRECISION)}`;
}

/** Great-circle distance, metres — full haversine (not the small-corridor
 *  planar approximation `infrastructureService.ts` uses for proximity
 *  checks) since a single way can legitimately span kilometres. */
function haversineM(a: LatLngLike, b: LatLngLike): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function addEdge(adjacency: Map<string, RoadEdge[]>, edge: RoadEdge): void {
  const list = adjacency.get(edge.from);
  if (list) list.push(edge);
  else adjacency.set(edge.from, [edge]);
}

/**
 * Build a routable graph from a set of fetched ways. Each consecutive vertex
 * pair within a way becomes one bidirectional edge pair; ways sharing a
 * coordinate (a real OSM junction) share a node and are therefore connected.
 * Zero-length consecutive-vertex pairs (duplicate points within a way's own
 * geometry — an occasional Overpass/OSM data quirk) are skipped rather than
 * creating a zero-cost edge.
 *
 * `waterBodies`, when supplied, flags edges per `RoadEdge.crossesStandingWater`
 * — see that field's own doc comment for why and `MAX_ASSUMED_BRIDGE_SPAN_M`
 * for the threshold. Detection walks each way's OWN vertex sequence in order,
 * testing each EDGE's midpoint against every water polygon, and accumulates
 * a running length across a CONTIGUOUS in-water stretch (resetting the moment
 * a dry edge is seen) — so a long track across a lake bed is flagged in full,
 * while a short bridge span over the same lake's edge is not.
 */
export function buildRoadGraph(ways: RoadWay[], waterBodies: WaterBodyPolygon[] = []): RoadGraph {
  const nodes = new Map<string, RoadNode>();
  const adjacency = new Map<string, RoadEdge[]>();

  const getOrCreateNode = (p: LatLngLike): RoadNode => {
    const key = nodeKey(p.lat, p.lng);
    let node = nodes.get(key);
    if (!node) {
      node = { id: key, lat: p.lat, lng: p.lng };
      nodes.set(key, node);
    }
    return node;
  };

  for (const way of ways) {
    if (way.coords.length < 2) continue;
    const wayTags: RoadWayTags = { highway: way.kind, surface: way.surface, tracktype: way.tracktype, smoothness: way.smoothness };

    // Tracks the CURRENT contiguous in-water run of edges (both directions'
    // objects, so flagging one flags the other) — flushed the moment a dry
    // edge is seen, or at the end of the way, whichever comes first.
    let run: RoadEdge[] = [];
    let runLengthM = 0;
    const flushRun = () => {
      if (runLengthM > MAX_ASSUMED_BRIDGE_SPAN_M) {
        for (const e of run) e.crossesStandingWater = true;
      }
      run = [];
      runLengthM = 0;
    };

    for (let i = 0; i < way.coords.length - 1; i++) {
      const a = getOrCreateNode(way.coords[i]);
      const b = getOrCreateNode(way.coords[i + 1]);
      if (a.id === b.id) continue; // duplicate consecutive point — no real edge here

      const distanceM = haversineM(a, b);
      if (distanceM <= 0) continue;

      const forward: RoadEdge = { from: a.id, to: b.id, distanceM, wayTags, wayName: way.name };
      const backward: RoadEdge = { from: b.id, to: a.id, distanceM, wayTags, wayName: way.name };
      addEdge(adjacency, forward);
      addEdge(adjacency, backward);

      if (waterBodies.length > 0) {
        const midpoint: LatLngLike = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        if (isInAnyWaterBody(midpoint, waterBodies)) {
          run.push(forward, backward);
          runLengthM += distanceM;
        } else {
          flushRun();
        }
      }
    }
    flushRun(); // the way may end mid-run
  }

  return { nodes, adjacency, wayCount: ways.length };
}

/**
 * Nearest graph node to an arbitrary point (e.g. a painted origin/objective
 * centroid), within `maxDistanceM`. Linear scan — fine at corridor-graph node
 * counts (hundreds to low thousands); revisit with a spatial index only if a
 * real deployment shows this binding.
 */
export function nearestNode(graph: RoadGraph, point: LatLngLike, maxDistanceM: number): RoadNode | null {
  let best: RoadNode | null = null;
  let bestDist = maxDistanceM;
  for (const node of graph.nodes.values()) {
    const d = haversineM(point, node);
    if (d <= bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

/**
 * Every graph node within `maxDistanceM` of `point` — the multi-source/
 * multi-target seed set `findRoadRoute`/`findKDissimilarRoadRoutes` expect
 * (`originNodeIds`/`objectiveNodeIds`), rather than a single nearest node.
 * A painted origin/objective is an AREA, not a point, so there is genuinely
 * no single "correct" access node — any road within snapping distance is a
 * legitimate candidate, and A* itself picks whichever actually gives the
 * cheapest route. Same linear-scan caveat as `nearestNode`.
 */
export function nodesWithin(graph: RoadGraph, point: LatLngLike, maxDistanceM: number): RoadNode[] {
  const found: RoadNode[] = [];
  for (const node of graph.nodes.values()) {
    if (haversineM(point, node) <= maxDistanceM) found.push(node);
  }
  return found;
}
