/**
 * Grid sampling for the Terrain Mobility mode — mirrors areaScan.ts's box
 * scan pattern (same hex machinery, same elevation/vegetation caches, so a
 * mobility run shares cache hits with any prior fire-break analysis or area
 * recon over the same ground) but also resolves trail proximity per cell,
 * which areaScan.ts deliberately skips (terrain+vegetation only, no
 * pathfinding claim). Trail-on cells matter here because they change both
 * speed (road vs cross-country factor) and vegetation passability (already
 * broken ground).
 */

import { LatLng } from '../utils/chainage';
import {
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes,
  LocalProjection, LocalPoint,
} from '../utils/hexGrid';
import { sampleElevationsCached, sampleVegetation } from '../utils/routeOptimizer';
import { fetchCorridorInfrastructure, distanceToNearestTrail } from '../utils/infrastructureService';
import { MobilityGridCell } from './accumulatedCost';

const TARGET_CELL_COUNT = 1400;
const MAX_HEX_CELLS = 1800;
const TRAIL_SNAP_M = 30;

export interface MobilityAoi {
  sw: LatLng;
  ne: LatLng;
}

export interface MobilityGridResult {
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  /** Cell keys whose centre falls inside the origin AOI box — the
   *  multi-source search's super-source seed set. */
  originKeys: string[];
  /** Cell keys whose centre falls inside the objective AOI box — the target
   *  set `extractPath` picks the cheapest-reached cell from. */
  objectiveKeys: string[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
}

function boxLocal(proj: LocalProjection, aoi: MobilityAoi): { min: LocalPoint; max: LocalPoint } {
  const a = toLocal(proj, aoi.sw);
  const b = toLocal(proj, aoi.ne);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

function containsLocal(min: LocalPoint, max: LocalPoint, p: LocalPoint): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

/**
 * Build and sample a hex grid covering `origin`, `objective` (padded so the
 * search has room either side to route around obstacles) and everything
 * between them.
 */
export async function buildMobilityGrid(
  origin: MobilityAoi,
  objective: MobilityAoi,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<MobilityGridResult | null> {
  const { signal, onProgress } = options;

  const minLat = Math.min(origin.sw.lat, origin.ne.lat, objective.sw.lat, objective.ne.lat);
  const maxLat = Math.max(origin.sw.lat, origin.ne.lat, objective.sw.lat, objective.ne.lat);
  const minLng = Math.min(origin.sw.lng, origin.ne.lng, objective.sw.lng, objective.ne.lng);
  const maxLng = Math.max(origin.sw.lng, origin.ne.lng, objective.sw.lng, objective.ne.lng);
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

  const originLocal = boxLocal(proj, origin);
  const objectiveLocal = boxLocal(proj, objective);

  const cells: MobilityGridCell[] = cellsRaw.map((c, i) => ({
    key: hexKey(c.hex),
    hex: c.hex,
    center: points[i],
    elevation: elevRes.elevations[i],
    vegetation: vegRes[i].type,
    vegEstimated: vegRes[i].estimated,
    onTrail: infra.trails.length > 0 && distanceToNearestTrail(points[i], infra.trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M,
  }));

  const originKeys = cellsRaw
    .filter(c => containsLocal(originLocal.min, originLocal.max, c.center))
    .map(c => hexKey(c.hex));
  const objectiveKeys = cellsRaw
    .filter(c => containsLocal(objectiveLocal.min, objectiveLocal.max, c.center))
    .map(c => hexKey(c.hex));

  onProgress?.(0.7);

  return {
    cells,
    hexSize: size,
    proj,
    originKeys: originKeys.length > 0 ? originKeys : [cells[0].key], // never an empty seed set
    objectiveKeys: objectiveKeys.length > 0 ? objectiveKeys : [cells[cells.length - 1].key],
    usedEstimatedData: elevRes.estimated || vegRes.some(v => v.estimated),
    infrastructureAvailable: infra.available,
  };
}
