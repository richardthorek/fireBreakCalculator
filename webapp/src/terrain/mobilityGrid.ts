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
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes,
  LocalProjection, LocalPoint,
} from '../utils/hexGrid';
import { sampleElevationsCached, sampleVegetation } from '../utils/routeOptimizer';
import { fetchCorridorInfrastructure, distanceToNearestTrail } from '../utils/infrastructureService';
import { MobilityGridCell } from './accumulatedCost';
import { PaintedArea, paintedAreaBounds, resolvePaintedAreaGeometry, isInsideResolvedArea } from './paintedArea';
import { computeDemDerivatives } from './dataLayers/demDerivatives';

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

  const [elevRes, vegRes, infra] = await Promise.all([
    sampleElevationsCached(points),
    sampleVegetation(points, signal, (done, total) => onProgress?.(0.05 + 0.55 * (done / Math.max(1, total))),
      { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng }),
    fetchCorridorInfrastructure(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
  ]);
  if (signal?.aborted) return null;
  onProgress?.(0.65);

  const cells: MobilityGridCell[] = cellsRaw.map((c, i) => ({
    key: hexKey(c.hex),
    hex: c.hex,
    center: points[i],
    elevation: elevRes.elevations[i],
    vegetation: vegRes[i].type,
    vegEstimated: vegRes[i].estimated,
    onTrail: infra.trails.length > 0 && distanceToNearestTrail(points[i], infra.trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M,
    crossSlopeDeg: 0, // filled in below once the grid is finalised
  }));

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
    usedCoarseGrid: tries > 0,
  };
}
