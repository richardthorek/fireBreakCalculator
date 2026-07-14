/**
 * Area recon — "draw a box, get the heatmap first" (issue #165, WP6).
 *
 * Tiles a user-drawn rectangle in the same hexagons the route optimizer
 * uses, samples terrain and vegetation only (no pathfinding, no trail
 * lookup — nothing here claims to find a route), and returns a heatmap in
 * the same shape the optimizer already renders. The elevation/vegetation
 * samples land in the optimizer's shared caches, so scanning a box before
 * drawing a line through it turns that line's search into mostly cache
 * hits — the box genuinely pre-warms the corridor it covers.
 */

import { LatLng } from './chainage';
import {
  makeProjection, toLocal, toLatLng, hexKey, hexNeighbors, hexCorners,
  chooseHexSize, generateBoxHexes, LocalProjection, LocalPoint, AxialCoord,
} from './hexGrid';
import {
  sampleElevationsCached, sampleVegetation, edgeCost, normalizeHeatmap,
  HexHeatmapCell, SampledNode, RawHeatmapCell,
} from './routeOptimizer';

export interface AreaScanOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface AreaScanResult {
  heatmap: HexHeatmapCell[];
  usedEstimatedData: boolean;
  cellCount: number;
}

const TARGET_CELL_COUNT = 900;
const MAX_HEX_CELLS = 1200;

/**
 * Scan the box between `sw` and `ne` (opposite corners, order doesn't
 * matter) for terrain + vegetation difficulty. Returns null if the box is
 * degenerate or the scan was aborted.
 */
export async function scanArea(sw: LatLng, ne: LatLng, options: AreaScanOptions = {}): Promise<AreaScanResult | null> {
  const { signal, onProgress } = options;

  const minLat = Math.min(sw.lat, ne.lat);
  const maxLat = Math.max(sw.lat, ne.lat);
  const minLng = Math.min(sw.lng, ne.lng);
  const maxLng = Math.max(sw.lng, ne.lng);
  if (maxLat - minLat < 1e-6 || maxLng - minLng < 1e-6) return null;

  const center: LatLng = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const proj: LocalProjection = makeProjection(center);
  const minLocal = toLocal(proj, { lat: minLat, lng: minLng });
  const maxLocal = toLocal(proj, { lat: maxLat, lng: maxLng });
  const boxMin: LocalPoint = { x: Math.min(minLocal.x, maxLocal.x), y: Math.min(minLocal.y, maxLocal.y) };
  const boxMax: LocalPoint = { x: Math.max(minLocal.x, maxLocal.x), y: Math.max(minLocal.y, maxLocal.y) };
  const width = boxMax.x - boxMin.x;
  const height = boxMax.y - boxMin.y;
  if (width < 10 || height < 10) return null;

  let size = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, TARGET_CELL_COUNT);
  let cellsRaw = generateBoxHexes(boxMin, boxMax, size);
  let tries = 0;
  while (cellsRaw.length > MAX_HEX_CELLS && tries < 5) {
    size *= 1.25;
    cellsRaw = generateBoxHexes(boxMin, boxMax, size);
    tries++;
  }
  if (cellsRaw.length < 1) return null;
  if (signal?.aborted) return null;

  onProgress?.(0.1);

  const points = cellsRaw.map(c => toLatLng(proj, c.center));
  const [elevRes, vegRes] = await Promise.all([
    sampleElevationsCached(points),
    // The vegetation sweep is the long haul of a scan — its per-point
    // progress drives the bar through the 0.1 → 0.7 span instead of the
    // old single end-of-fetch jump.
    sampleVegetation(points, signal, (done, total) => onProgress?.(0.1 + 0.6 * (done / Math.max(1, total)))),
  ]);
  if (signal?.aborted) return null;
  onProgress?.(0.7);
  const usedEstimatedData = elevRes.estimated || vegRes.some(v => v.estimated);

  const nodeByKey = new Map<string, SampledNode>();
  cellsRaw.forEach((c: { hex: AxialCoord; center: LocalPoint }, i: number) => {
    nodeByKey.set(hexKey(c.hex), {
      lat: points[i].lat,
      lng: points[i].lng,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      // No trail lookup for area recon — terrain + vegetation only, per WP6.
      onTrail: false,
    });
  });

  const cells: RawHeatmapCell[] = cellsRaw.map((cell: { hex: AxialCoord; center: LocalPoint }) => {
    const id = hexKey(cell.hex);
    const node = nodeByKey.get(id)!;
    const neighborIds = hexNeighbors(cell.hex).map(hexKey).filter(nid => nodeByKey.has(nid));
    let unitCost = 0.6;
    let avgSlopeDegrees = 0;
    if (neighborIds.length > 0) {
      let costSum = 0;
      let slopeSum = 0;
      for (const nid of neighborIds) {
        const e = edgeCost(node, nodeByKey.get(nid)!);
        if (e.dist > 0) costSum += e.cost / e.dist;
        slopeSum += e.slope;
      }
      unitCost = costSum / neighborIds.length;
      avgSlopeDegrees = slopeSum / neighborIds.length;
    }
    const corners = hexCorners(cell.center, size).map(c => toLatLng(proj, c));
    return {
      center: { lat: node.lat, lng: node.lng },
      polygon: [...corners, corners[0]],
      unitCost,
      avgSlopeDegrees,
      vegetation: node.vegetation,
      onTrail: false,
      estimated: node.vegEstimated,
    };
  });

  onProgress?.(1);

  return {
    heatmap: normalizeHeatmap(cells),
    usedEstimatedData,
    cellCount: cells.length,
  };
}
