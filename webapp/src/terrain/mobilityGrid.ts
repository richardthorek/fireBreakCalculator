/**
 * Grid sampling for the Terrain Mobility mode — mirrors areaScan.ts's box
 * scan pattern (same hex machinery, same elevation/vegetation caches, so a
 * mobility run shares cache hits with any prior fire-break analysis or area
 * recon over the same ground) but also resolves trail proximity per cell,
 * which areaScan.ts deliberately skips (terrain+vegetation only, no
 * pathfinding claim). Trail-on cells matter here because they change both
 * speed (road vs cross-country factor) and vegetation passability (already
 * broken ground).
 *
 * Origin/objective areas are PAINTED (docs owner feedback 2026-07-26) — an
 * ordered sequence of paint/erase dabs (paintedArea.ts), not a drawn
 * rectangle — resolved ONCE per area into a single polygon
 * (`resolvePaintedAreaGeometry`) and tested per cell via a real area-overlap
 * fraction (`isPaintedAreaMember`/`paintedOverlapFraction`), not a bbox or
 * centre-point check: painting always tiles at a fixed 100m hex size
 * (paintedArea.ts) while this grid's own hex size is chosen independently
 * for the scale of the area (`chooseHexSize`), so the two tilings essentially
 * never line up — "breaking down or combining cells" (docs owner feedback
 * 2026-07-27), done geometrically rather than by literally re-tiling either
 * grid.
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { intersect } from '@turf/intersect';
import { area as turfArea } from '@turf/area';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';
import { LatLng } from '../utils/chainage';
import {
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes, hexCorners,
  LocalProjection, LocalPoint,
} from '../utils/hexGrid';
import { sampleElevationsCached, sampleVegetation } from '../utils/routeOptimizer';
import {
  fetchCorridorMobilityRoads, fetchCorridorWaterways, distanceToNearestTrail, distanceToNearestWater,
  InfrastructureTrail,
} from '../utils/infrastructureService';
import { MobilityGridCell } from './accumulatedCost';
import { PaintedArea, paintedAreaBounds, resolvePaintedAreaGeometry } from './paintedArea';
import { computeDemDerivatives } from './dataLayers/demDerivatives';
import { fetchSurfaceWaterFrequencyArea, sampleSurfaceWaterFrequencyRaster } from './dataLayers/deaWaterObservationsService';
import { RoadWayTags } from './roadSpeedModel';

// Raised from 1400/1800 (2026-07-26, "think about a larger area"): both
// upstream sampling calls this grid depends on are already area-batched, not
// per-point (sampleVegetation resolves from at most two area requests once
// enough points are uncached; sampleElevationsCached batches misses in one
// call) — the "hundreds of upstream requests" risk that keeps NAFI/DEA point
// queries capped small (docs §10.7, dataLayers/nafiFireHistoryService.ts)
// does not apply here. The search itself is O(cells log cells) in a Web
// Worker, and demDerivatives.ts's per-cell plane fit + one MFD accumulation
// pass are the same order — both stay well under a second at this size.
const TARGET_CELL_COUNT = 2200;
const MAX_HEX_CELLS = 2800;
const TRAIL_SNAP_M = 30;
/** How close a cell (or one of its hex corners — see `waterDistanceM`'s own
 *  doc) has to come to a mapped watercourse to count as "on it" for the
 *  fording gate. Matches `TRAIL_SNAP_M`'s own precedent rather than inventing
 *  a different tolerance for the same class of problem (a linear OSM feature
 *  vs a hex grid). */
const WATER_SNAP_M = 30;

export interface MobilityGridResult {
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  /** Cell keys whose centre falls inside the painted origin area — the
   *  multi-source search's super-source seed set. */
  originKeys: string[];
  /** Cell keys whose centre falls inside the painted objective area — the
   *  target set `extractPath` picks the cheapest-reached cell from. */
  objectiveKeys: string[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  /** True when EITHER hydrology source (OSM waterway/water-body geometry, DEA
   *  WOfS frequency) returned real data for this AOI — the run log and the
   *  panel both need to say plainly when the water gate had nothing to work
   *  from, the same honesty `infrastructureAvailable` already provides for
   *  trails. */
  hydrologyAvailable: boolean;
  /** The raw OSM waterway/water-body geometry this run fetched (docs §34) —
   *  kept alongside the per-cell derived fields so the map can draw the
   *  ACTUAL mapped river/lake shape as its own reference layer, not just the
   *  hex cells it influenced. Empty when hydrologyAvailable's OSM half
   *  returned nothing (query failed, or genuinely no mapped water here). */
  waterFeatures: InfrastructureTrail[];
  /** True when the painted AOI was large enough that the hex size had to be
   *  coarsened (doubled at least once) to stay inside MAX_HEX_CELLS — an
   *  honesty flag, not a silent trade-off: a coarsened grid is still a real
   *  search over real samples, but at lower spatial resolution than the
   *  target, so a narrow gap or a short-radius obstacle may not survive
   *  being averaged into a bigger cell. */
  usedCoarseGrid: boolean;
}

/** Real overlap fraction (0..1) between one hex cell's actual polygon and a
 *  resolved painted-area shape — geodesic area via `@turf/area`/
 *  `@turf/intersect`, not a projected approximation, since both inputs are
 *  already plain lng/lat rings. */
export function paintedOverlapFraction(cellCorners: LatLng[], geom: Polygon | MultiPolygon | null): number {
  if (!geom) return 0;
  const ring = [...cellCorners, cellCorners[0]].map(p => [p.lng, p.lat] as [number, number]);
  const cellPoly = turfPolygon([ring]);
  const cellAreaM2 = turfArea(cellPoly);
  if (cellAreaM2 <= 0) return 0;
  const geomFeature: Feature<Polygon | MultiPolygon> = { type: 'Feature', properties: {}, geometry: geom };
  let intersection;
  try {
    intersection = intersect(featureCollection([cellPoly, geomFeature]));
  } catch {
    return 0;
  }
  if (!intersection) return 0;
  return Math.min(1, turfArea(intersection) / cellAreaM2);
}

/** Minimum area-overlap fraction for an analysis hex to count as part of a
 *  painted area. Low enough that a patch painted off-centre (rather than
 *  dead-centre of the cell) still registers, high enough that a cell merely
 *  brushing the edge of a large painted region doesn't falsely seed the
 *  whole cell as origin/objective. */
export const PAINTED_OVERLAP_THRESHOLD = 0.15;

export function isPaintedAreaMember(cellCorners: LatLng[], geom: Polygon | MultiPolygon | null): boolean {
  return paintedOverlapFraction(cellCorners, geom) >= PAINTED_OVERLAP_THRESHOLD;
}

/**
 * Build and sample a hex grid covering `origin`, `objective` (padded so the
 * search has room either side to route around obstacles) and everything
 * between them.
 */
export async function buildMobilityGrid(
  origin: PaintedArea,
  objective: PaintedArea,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<MobilityGridResult | null> {
  const { signal, onProgress } = options;

  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;

  const minLat = Math.min(originBounds.minLat, objectiveBounds.minLat);
  const maxLat = Math.max(originBounds.maxLat, objectiveBounds.maxLat);
  const minLng = Math.min(originBounds.minLng, objectiveBounds.minLng);
  const maxLng = Math.max(originBounds.maxLng, objectiveBounds.maxLng);
  if (maxLat - minLat < 1e-6 || maxLng - minLng < 1e-6) return null;

  // Pad ~20% either side so the search has room to route around obstacles
  // rather than being boxed in exactly between the two AOIs.
  const padLat = (maxLat - minLat) * 0.2;
  const padLng = (maxLng - minLng) * 0.2;
  const boundsSw: LatLng = { lat: minLat - padLat, lng: minLng - padLng };
  const boundsNe: LatLng = { lat: maxLat + padLat, lng: maxLng + padLng };

  const center: LatLng = { lat: (boundsSw.lat + boundsNe.lat) / 2, lng: (boundsSw.lng + boundsNe.lng) / 2 };
  const proj = makeProjection(center);
  const boxMinLocal = toLocal(proj, boundsSw);
  const boxMaxLocal = toLocal(proj, boundsNe);
  const min: LocalPoint = { x: Math.min(boxMinLocal.x, boxMaxLocal.x), y: Math.min(boxMinLocal.y, boxMaxLocal.y) };
  const max: LocalPoint = { x: Math.max(boxMinLocal.x, boxMaxLocal.x), y: Math.max(boxMinLocal.y, boxMaxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) return null;

  let size = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, TARGET_CELL_COUNT);
  let cellsRaw = generateBoxHexes(min, max, size);
  let tries = 0;
  while (cellsRaw.length > MAX_HEX_CELLS && tries < 5) {
    size *= 1.25;
    cellsRaw = generateBoxHexes(min, max, size);
    tries++;
  }
  if (cellsRaw.length < 1) return null;
  if (signal?.aborted) return null;
  onProgress?.(0.05);

  const points = cellsRaw.map(c => toLatLng(proj, c.center));
  // Corner points too — see `waterDistanceM`'s doc comment on why a linear
  // watercourse narrower than the hex is more likely caught this way than by
  // testing cell centres alone. Local coords converted once here, alongside
  // the centres, rather than recomputed per cell in the sampling loop below.
  const cornerPoints = cellsRaw.map(c => hexCorners(c.center, size).map(p => toLatLng(proj, p)));

  const [elevRes, vegRes, infra, waterways, waterFrequencyRaster] = await Promise.all([
    sampleElevationsCached(points),
    sampleVegetation(points, signal, (done, total) => onProgress?.(0.05 + 0.55 * (done / Math.max(1, total))),
      { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng }),
    // 'highway-mobility' (docs §35 — the wider road set, motorway/trunk/
    // primary included), NOT the fire-break optimizer's REUSABLE_HIGHWAYS
    // default: a hex sitting on a motorway is exactly the case a movement/
    // denial appreciation most needs to register as onTrail, and the
    // fire-break "reusable broken ground" set deliberately excludes it. Also
    // carries surface/tracktype/smoothness per way, feeding the road-class
    // speed ceiling below.
    fetchCorridorMobilityRoads(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
    // Hydrology (docs §34) — two independent sources, batched exactly like
    // everything else here (one request each regardless of grid size, not
    // per-cell): OSM waterway/water-body geometry for a crisp, resolution-
    // independent "is there a mapped watercourse here" answer, and DEA WOfS
    // for a measured (if colour-ramp-approximated) wet-frequency where OSM
    // tagging is sparse. Neither failure blocks the run — a hydrology-blind
    // appreciation degrades to what Pass 1-4 already shipped, flagged via
    // `hydrologyAvailable` rather than silently.
    fetchCorridorWaterways(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
    fetchSurfaceWaterFrequencyArea(
      { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng }, signal
    ).catch(() => null),
  ]);
  if (signal?.aborted) return null;
  onProgress?.(0.65);

  const cells: MobilityGridCell[] = cellsRaw.map((c, i) => {
    const center = points[i];
    let waterDistanceM = Infinity;
    let inWaterBody = false;
    let nearestWaterwayKind: string | null = null;
    if (waterways.trails.length > 0) {
      // Centre + six hex corners (see the field's own doc comment on why):
      // stop the moment any sample point lands inside/on the water, since
      // nothing can beat 0.
      const samplePoints = [center, ...cornerPoints[i]];
      for (const p of samplePoints) {
        const d = distanceToNearestWater(p, waterways.trails);
        if (d < waterDistanceM) waterDistanceM = d;
        if (waterDistanceM <= 0) break;
      }
      // Any sample point — not just the centre — landing inside a water BODY
      // is enough: a lake's edge clipping a hex corner is still the lake, and
      // a centre-only check missed that cell entirely.
      const waterBodyFeatures = waterways.trails.filter(f => f.kind === 'water');
      if (waterBodyFeatures.length > 0) {
        inWaterBody = samplePoints.some(p => distanceToNearestWater(p, waterBodyFeatures, 0) === 0);
      }
      if (waterDistanceM <= WATER_SNAP_M) {
        // Representative severity label: the nearest LINEAR watercourse class
        // (river/canal/stream) within snap distance of the cell centre. A
        // water BODY doesn't need this — `inWaterBody` already says enough,
        // and `estimateFordingRequirement` in mobilityCost.ts treats a body as
        // maximally severe regardless of a nearby line's class.
        let bestD = Infinity;
        for (const feature of waterways.trails) {
          if (feature.kind === 'water') continue;
          const d = distanceToNearestTrail(center, [feature], WATER_SNAP_M);
          if (d < bestD) { bestD = d; nearestWaterwayKind = feature.kind; }
        }
        if (bestD > WATER_SNAP_M) nearestWaterwayKind = null;
      }
    }
    const waterFrequency = waterFrequencyRaster
      ? sampleSurfaceWaterFrequencyRaster(waterFrequencyRaster, center.lat, center.lng)?.frequency ?? null
      : null;

    // onTrail + the nearest trail's own tags in ONE scan (docs §35) — the
    // road-class speed model (roadSpeedModel.ts) needs surface/tracktype/
    // smoothness, not just "is there a trail here", so this now finds the
    // SAME nearest feature onTrail already needed rather than re-scanning
    // `infra.trails` a second time for it.
    let onTrail = false;
    let nearestTrailTags: RoadWayTags | null = null;
    if (infra.trails.length > 0) {
      let bestD = Infinity;
      for (const feature of infra.trails) {
        const d = distanceToNearestTrail(center, [feature], TRAIL_SNAP_M);
        if (d < bestD) {
          bestD = d;
          nearestTrailTags = { highway: feature.kind, surface: feature.surface, tracktype: feature.tracktype, smoothness: feature.smoothness };
        }
        if (bestD <= 0) break; // nothing can beat 0
      }
      onTrail = bestD <= TRAIL_SNAP_M;
      if (!onTrail) nearestTrailTags = null;
    }

    return {
      key: hexKey(c.hex),
      hex: c.hex,
      center,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      onTrail,
      nearestTrailTags,
      crossSlopeDeg: 0, // filled in below once the grid is finalised
      waterDistanceM,
      inWaterBody,
      nearestWaterwayKind,
      waterFrequency,
    };
  });

  // Real cross-slope, not the dormant "always unknown" placeholder Pass 1
  // shipped with (docs §10.7 M3a / §3's own stated scope cut) — computed
  // once here from the elevation grid already in hand, no new network call.
  // `edgeMobilityCost`'s hard side-slope NO-GO gate only ever fires when a
  // real number reaches it; this is what makes that gate live instead of
  // permanently inert.
  const derivatives = computeDemDerivatives(cells);
  for (const cell of cells) {
    cell.crossSlopeDeg = derivatives.get(cell.key)?.crossSlopeDeg ?? 0;
  }

  // Resolve each painted area's paint/erase strokes into one shape ONCE
  // here, rather than per cell — the geometry-boolean-ops replay is real
  // work, membership testing against the already-resolved shape is cheap.
  const originGeom = resolvePaintedAreaGeometry(origin);
  const objectiveGeom = resolvePaintedAreaGeometry(objective);
  const originKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], originGeom)).map(c => c.key);
  const objectiveKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], objectiveGeom)).map(c => c.key);

  onProgress?.(0.7);

  // Fording depth is always a Tier 0 assumption (estimateFordingRequirement
  // in mobilityCost.ts), so a run whose only estimated ingredient is "this
  // cell needed a fording judgement" must still trip the honesty flag — not
  // just elevation/vegetation fallback.
  const usedHydrologyEstimate = cells.some(
    c => c.inWaterBody || c.nearestWaterwayKind !== null || (c.waterFrequency !== null && c.waterFrequency >= 0.15)
  );

  return {
    cells,
    hexSize: size,
    proj,
    originKeys: originKeys.length > 0 ? originKeys : [cells[0].key], // never an empty seed set
    objectiveKeys: objectiveKeys.length > 0 ? objectiveKeys : [cells[cells.length - 1].key],
    usedEstimatedData: elevRes.estimated || vegRes.some(v => v.estimated) || usedHydrologyEstimate,
    infrastructureAvailable: infra.available,
    hydrologyAvailable: waterways.available || waterFrequencyRaster !== null,
    waterFeatures: waterways.trails,
    usedCoarseGrid: tries > 0,
  };
}
