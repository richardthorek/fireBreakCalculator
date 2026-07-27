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
 * (`resolvePaintedAreaGeometry`) and tested per cell via
 * `isInsideResolvedArea` rather than a simple bbox containment check.
 */

import { LatLng } from '../utils/chainage';
import {
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes, hexCorners,
  LocalProjection, LocalPoint,
} from '../utils/hexGrid';
import { sampleElevationsCached, sampleVegetation } from '../utils/routeOptimizer';
import {
  fetchCorridorInfrastructure, fetchCorridorWaterways, distanceToNearestTrail, distanceToNearestWater,
  InfrastructureTrail,
} from '../utils/infrastructureService';
import { MobilityGridCell } from './accumulatedCost';
import { PaintedArea, paintedAreaBounds, resolvePaintedAreaGeometry, isInsideResolvedArea } from './paintedArea';
import { computeDemDerivatives } from './dataLayers/demDerivatives';
import { fetchSurfaceWaterFrequencyArea, sampleSurfaceWaterFrequencyRaster } from './dataLayers/deaWaterObservationsService';

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
    fetchCorridorInfrastructure(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
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
      inWaterBody = distanceToNearestWater(center, waterways.trails.filter(f => f.kind === 'water'), 0) === 0;
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

    return {
      key: hexKey(c.hex),
      hex: c.hex,
      center,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      onTrail: infra.trails.length > 0 && distanceToNearestTrail(center, infra.trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M,
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
  const originKeys = cells.filter(c => isInsideResolvedArea(c.center, originGeom)).map(c => c.key);
  const objectiveKeys = cells.filter(c => isInsideResolvedArea(c.center, objectiveGeom)).map(c => c.key);

  onProgress?.(0.7);

  return {
    cells,
    hexSize: size,
    proj,
    originKeys: originKeys.length > 0 ? originKeys : [cells[0].key], // never an empty seed set
    objectiveKeys: objectiveKeys.length > 0 ? objectiveKeys : [cells[cells.length - 1].key],
    usedEstimatedData: elevRes.estimated || vegRes.some(v => v.estimated),
    infrastructureAvailable: infra.available,
    hydrologyAvailable: waterways.available || waterFrequencyRaster !== null,
    waterFeatures: waterways.trails,
    usedCoarseGrid: tries > 0,
  };
}
