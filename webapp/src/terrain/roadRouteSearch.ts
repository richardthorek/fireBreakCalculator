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
 * PARTIALLY FUSED (docs §42, 2026-07-28; extended same day): `roadRouteToDissimilarRoute`
 * below converts this route into the hex-grid's own `DissimilarRoute` shape so
 * it can be injected into the chokepoint/corridor-band analysis alongside the
 * hex-optimiser's k cheapest routes and the movement ensemble's tracks —
 * "the known-good road is a real route candidate", not just a separate
 * additive display. The SAME converted route's hex keys are also passed into
 * the movement ensemble (`MovementSimulationOptions.preferredRouteKeys`) as a
 * small per-step tie-break bias — at a genuine junction where two or more
 * `onTrail` neighbours are candidates, the generic road-affinity term can't
 * tell them apart, but the road graph's own exact-geometry A* already knows
 * which fork is fastest. And min-cut's trail-edge capacity multiplier
 * (`minCutBarrier.ts`) is now tiered by the same real OSM highway
 * classification, rather than one flat multiplier for every trail regardless
 * of class.
 *
 * FULLY FUSED (docs §42b, 2026-07-28): the movement ensemble now genuinely
 * walks the road graph's own edges (a bounded candidate-set extension,
 * `movementSimulation.ts`'s `roadMix` machinery — unrestricted baseline only,
 * see that module's own doc comment for the safety reasoning), and a
 * SEPARATE `computeRoadNetworkMinCut` (`minCutBarrier.ts`) can target an
 * exact road choke point narrower than a hex. Neither rewrote the hex
 * adjacency graph itself — both are additive, bounded extensions — closing
 * the "fuse road-graph routes into movement simulation / min-cut" roadmap
 * item without the full mixed-adjacency rewrite once assessed as too risky
 * for one pass.
 *
 * ROAD-ROUTE DECOUPLING (docs §38's stated remainder, closed 2026-07-28):
 * `findEarlyVehicleRoadRoutePreview` below computes this SAME route
 * independently of `mobilityAppreciation.ts`'s hex-grid retry loop, using the
 * identical first-attempt bounding box — surfaced via a new `onRoadRoute`
 * callback typically seconds in, rather than waiting on the entire grid/
 * search pipeline (tens of seconds on a large or fine-fidelity AOI). A
 * PREVIEW only; the authoritative `roadRoute` on the final result is still
 * computed from the grid's actual final bounds, unchanged.
 *
 * HONESTY ON SCOPE: the returned route runs between the nearest road ACCESS
 * POINT to the origin area and the nearest to the objective area — it does
 * NOT include the off-road leg from the painted area to the road, or from
 * the road back to the painted area. Labelled as such in the result and the
 * log line that reports it; never presented as a door-to-door ETA.
 */

import { PaintedArea, paintedAreaBounds } from './paintedArea';
import { InfrastructureTrail, fetchCorridorMobilityRoads, fetchCorridorWaterways } from '../utils/infrastructureService';
import { buildRoadGraph, nodesWithin, RoadWay, RoadGraph, WaterBodyPolygon } from './roadGraph';
import { findRoadRoute } from './roadRouting';
import { RoadSpeedOverrides } from './roadSpeedModel';
import { MoverProfile } from './moverProfiles';
import { calculateDistance } from '../utils/slopeCalculation';
import { nearestCellKey, computePaddedBounds } from './mobilityGrid';
import { MobilityGridCell } from './accumulatedCost';
import { DissimilarRoute } from './corridorAnalysis';

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
export const ROAD_ACCESS_SNAP_M = 3000;

export function areaCentroid(area: PaintedArea): { lat: number; lng: number } | null {
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
 *
 * `waterFeatures`: the SAME OSM waterway/water-body geometry the hex-grid
 * search's own hydrology gate uses (`grid.waterFeatures`, docs §34) — passed
 * through to `buildRoadGraph` so this graph gets the identical water
 * awareness the hex grid already has, rather than the "no water logic at
 * all" gap that let a real vehicle route run straight across Lake George
 * (docs §35 addendum, 2026-07-28).
 */
export function findVehicleRoadRoute(
  origin: PaintedArea,
  objective: PaintedArea,
  roadWays: InfrastructureTrail[],
  profile: MoverProfile,
  overrides?: RoadSpeedOverrides,
  waterFeatures: InfrastructureTrail[] = []
): RoadRouteSearchResult | null {
  if (profile.speedModel !== 'vehicle-gradient') return null;
  if (roadWays.length === 0) return null;

  const originPoint = areaCentroid(origin);
  const objectivePoint = areaCentroid(objective);
  if (!originPoint || !objectivePoint) return null;

  const waterBodies: WaterBodyPolygon[] = waterFeatures
    .filter(f => f.kind === 'water')
    .map(f => ({ coords: f.coords, holes: f.holes }));
  const graph: RoadGraph = buildRoadGraph(roadWays as RoadWay[], waterBodies);
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

/**
 * The EARLY, box-free vehicle road route — road-route decoupling (docs §38's
 * stated remainder, closed 2026-07-28). Fetches road/water data for the SAME
 * bounding box `mobilityAppreciation.ts`'s hex-grid retry loop will ALSO
 * request for its own first attempt (identical `computePaddedBounds` inputs
 * — `boundsPadFactor`/`detourPadM` must be the caller's actual attempt-0
 * values, or the two requests land on different rounded bbox keys and the
 * result/in-flight cache in `infrastructureService.ts` can't collapse them
 * into one real network round trip), then runs `findVehicleRoadRoute`
 * exactly as the authoritative pipeline does. Returns null cleanly for a
 * non-vehicle profile, a degenerate span, or when nothing connects — never a
 * throw, since this is a best-effort preview and must never be allowed to
 * fail the run it's racing alongside.
 */
export async function findEarlyVehicleRoadRoutePreview(
  origin: PaintedArea,
  objective: PaintedArea,
  profile: MoverProfile,
  boundsPadFactor: number,
  detourPadM: number,
  overrides?: RoadSpeedOverrides,
  signal?: AbortSignal
): Promise<RoadRouteSearchResult | null> {
  if (profile.speedModel !== 'vehicle-gradient') return null;
  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;
  const padded = computePaddedBounds(originBounds, objectiveBounds, boundsPadFactor, detourPadM);
  if (!padded) return null;
  const { boundsSw, boundsNe } = padded;

  const [roads, waterways] = await Promise.all([
    fetchCorridorMobilityRoads(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
    fetchCorridorWaterways(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
  ]);
  if (signal?.aborted || roads.trails.length === 0) return null;
  return findVehicleRoadRoute(origin, objective, roads.trails, profile, overrides, waterways.trails);
}

/** How many points to resample the road route into before snapping onto the
 *  hex grid — real road waypoint spacing is very uneven (long straight
 *  stretches vs. many closely-packed curve vertices), but
 *  `corridorField.ts`'s `sampleRoutePoint` samples a `DissimilarRoute.path`
 *  by INDEX fraction, assuming roughly even spacing the way a hex-stepped
 *  search path naturally has. Resampling to evenly-spaced-by-distance points
 *  first keeps that assumption true for a road route too, rather than
 *  silently skewing which "25%/50%/75% of the way" ends up sampled. */
const ROAD_ROUTE_RESAMPLE_POINTS = 64;

/**
 * Convert a road-network route into the SAME `DissimilarRoute` shape the
 * hex-optimiser's k-cheapest-routes search and the movement ensemble's
 * tracks already produce — so the real, box-free road route can be injected
 * into chokepoint counting and corridor-band clustering as one more genuine
 * route candidate, not just displayed alongside them. See this module's own
 * header comment for what remains unfused (the ensemble's per-step movement,
 * min-cut).
 *
 * `keys` (hex cell keys the route passes through, for chokepoint counting)
 * are resolved by snapping each resampled point onto the CALLER's own hex
 * grid (`cells` — the same grid the rest of the run already sampled), so a
 * cell counted here is directly comparable to one counted from a hex-grid
 * route. Cumulative time is distributed proportionally by distance along the
 * route — an honest, stated approximation: this module doesn't retain a
 * per-original-edge time breakdown, only the aggregate, so mid-route timing
 * is linear-by-distance rather than reflecting real speed changes between
 * road classes along the way (the aggregate `totalSeconds` itself IS exact).
 */
export function roadRouteToDissimilarRoute(
  route: RoadRouteSearchResult,
  cells: MobilityGridCell[]
): DissimilarRoute | null {
  if (route.waypoints.length < 2 || cells.length === 0) return null;

  // Cumulative distance at each ORIGINAL waypoint.
  const cumDist: number[] = [0];
  for (let i = 1; i < route.waypoints.length; i++) {
    const prev = route.waypoints[i - 1];
    const cur = route.waypoints[i];
    cumDist.push(cumDist[i - 1] + calculateDistance(prev.lat, prev.lng, cur.lat, cur.lng));
  }
  const totalDist = cumDist[cumDist.length - 1];
  if (totalDist <= 0) return null;

  const resampled: { lat: number; lng: number; cumulativeSeconds: number }[] = [];
  for (let i = 0; i < ROAD_ROUTE_RESAMPLE_POINTS; i++) {
    const targetDist = (i / (ROAD_ROUTE_RESAMPLE_POINTS - 1)) * totalDist;
    // Find the original segment this target distance falls within.
    let seg = 0;
    while (seg < cumDist.length - 2 && cumDist[seg + 1] < targetDist) seg++;
    const segStart = cumDist[seg];
    const segEnd = cumDist[seg + 1];
    const segFrac = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;
    const a = route.waypoints[seg];
    const b = route.waypoints[seg + 1];
    resampled.push({
      lat: a.lat + (b.lat - a.lat) * segFrac,
      lng: a.lng + (b.lng - a.lng) * segFrac,
      cumulativeSeconds: (targetDist / totalDist) * route.totalSeconds,
    });
  }

  const keys: string[] = [];
  for (const p of resampled) {
    const key = nearestCellKey(cells, { lat: p.lat, lng: p.lng });
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  if (keys.length === 0) return null;

  return { keys, path: resampled, totalSeconds: route.totalSeconds };
}
