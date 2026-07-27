/**
 * Vehicle road-route search — Terrain Mobility Slice A, live-pipeline wiring
 * (docs/ROUTE_INTELLIGENCE.md §35). `roadGraph.ts`/`roadRouting.ts` were built
 * and proven correct in isolation (the synthetic Lake George test,
 * `lakeGeorgeRoadRouting.test.ts`), but nothing in the live app ever called
 * them: `mobilityAppreciation.ts`'s real run only ever executed the hex-grid
 * Dijkstra, which still has the padded-box defect §35 reports. This module is
 * the missing wire — for VEHICLE-GRADIENT profiles only, find the fastest
 * ROAD-NETWORK route between the painted origin and objective areas,
 * independent of the hex grid's box. This is what actually fixes Lake George
 * for vehicles in the RUNNING app, not just in a test fixture.
 *
 * DELIBERATELY ADDITIVE, NOT A REPLACEMENT: this result sits ALONGSIDE the
 * hex-grid search's path/corridors/simulation, which still runs unchanged.
 * Fusing the two into one search (so movement simulation, chokepoints and
 * min-cut all see road-graph routes too) is real future work, tracked in
 * master_plan.md, not attempted here. What THIS gives a vehicle profile
 * today: a genuine, box-free route recommendation even when the hex-grid
 * search inside its padded box finds nothing at all — exactly the Lake
 * George failure mode.
 *
 * HONESTY ON SCOPE: the returned route runs between the nearest road ACCESS
 * POINT to the origin area and the nearest to the objective area — it does
 * NOT include the off-road leg from the painted area to the road, or from
 * the road back to the painted area. Labelled as such in the result and the
 * log line that reports it; never presented as a door-to-door ETA.
 */

import { PaintedArea, paintedAreaBounds } from './paintedArea';
import { InfrastructureTrail } from '../utils/infrastructureService';
import { buildRoadGraph, nodesWithin, RoadWay, RoadGraph } from './roadGraph';
import { findRoadRoute } from './roadRouting';
import { RoadSpeedOverrides } from './roadSpeedModel';
import { MoverProfile } from './moverProfiles';

export interface RoadRouteWaypoint {
  lat: number;
  lng: number;
}

export interface RoadRouteSearchResult {
  waypoints: RoadRouteWaypoint[];
  totalSeconds: number;
  totalDistanceM: number;
  /** Distinct way names crossed, in route order, deduplicated consecutively
   *  — for a log line / label, not a turn-by-turn instruction set. Unnamed
   *  ways (very common for tracks) simply don't contribute an entry. */
  wayNames: string[];
}

/** How far from a painted area's bounding-box centre a road node may sit and
 *  still count as that area's road access point. Generous relative to the
 *  largest single brush dab (~1.8 km equivalent-area radius for `xl` — see
 *  `paintedArea.ts`'s `brushApproxRadiusM`): a painted area is typically at
 *  or under this size, and origin/objective areas are exactly the kind of
 *  place a user paints BECAUSE they're near infrastructure, not deep bush. */
const ROAD_ACCESS_SNAP_M = 3000;

function areaCentroid(area: PaintedArea): { lat: number; lng: number } | null {
  const bounds = paintedAreaBounds(area);
  if (!bounds) return null;
  return { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 };
}

/**
 * The fastest road-network route between `origin` and `objective`, for
 * VEHICLE-GRADIENT profiles only (see module header — foot profiles are
 * never modulated by road class, and off-road movement is a foot mover's
 * whole point, so a road-only route would misrepresent what they'd do).
 *
 * Returns null when: the profile isn't a vehicle, no road data was fetched
 * for this AOI, neither painted area has a road within snapping distance, or
 * the road network genuinely doesn't connect the two — a real "no road
 * route" answer, not a box artefact, since this graph has no box.
 */
export function findVehicleRoadRoute(
  origin: PaintedArea,
  objective: PaintedArea,
  roadWays: InfrastructureTrail[],
  profile: MoverProfile,
  overrides?: RoadSpeedOverrides
): RoadRouteSearchResult | null {
  if (profile.speedModel !== 'vehicle-gradient') return null;
  if (roadWays.length === 0) return null;

  const originPoint = areaCentroid(origin);
  const objectivePoint = areaCentroid(objective);
  if (!originPoint || !objectivePoint) return null;

  const graph: RoadGraph = buildRoadGraph(roadWays as RoadWay[]);
  if (graph.wayCount === 0) return null;

  const originNodes = nodesWithin(graph, originPoint, ROAD_ACCESS_SNAP_M);
  const objectiveNodes = nodesWithin(graph, objectivePoint, ROAD_ACCESS_SNAP_M);
  if (originNodes.length === 0 || objectiveNodes.length === 0) return null;

  const route = findRoadRoute(
    graph, originNodes.map(n => n.id), objectiveNodes.map(n => n.id), profile, { overrides }
  );
  if (!route) return null;

  const waypoints: RoadRouteWaypoint[] = route.nodeIds.map(id => {
    const node = graph.nodes.get(id)!;
    return { lat: node.lat, lng: node.lng };
  });

  // Re-walk the resolved path to recover per-edge distance/name — the router
  // itself only returns node IDs + total time, so this is the cheapest way
  // to get a distance and a human-readable label without changing what
  // `findRoadRoute` returns for every OTHER caller.
  let totalDistanceM = 0;
  const wayNames: string[] = [];
  for (let i = 0; i < route.nodeIds.length - 1; i++) {
    const from = route.nodeIds[i];
    const to = route.nodeIds[i + 1];
    const edge = (graph.adjacency.get(from) ?? []).find(e => e.to === to);
    if (!edge) continue;
    totalDistanceM += edge.distanceM;
    if (edge.wayName && wayNames[wayNames.length - 1] !== edge.wayName) wayNames.push(edge.wayName);
  }

  return { waypoints, totalSeconds: route.totalSeconds, totalDistanceM, wayNames };
}
