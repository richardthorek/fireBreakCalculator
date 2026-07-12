/**
 * Chainage helpers for a drawn line.
 *
 * "Chainage" is the along-line distance from the start of the route (metres).
 * The analysis panel, elevation profile, advisor insights and map highlights all
 * reference locations on the line by chainage, and these helpers convert between
 * chainage and geographic coordinates so every surface points at the same spot.
 */

import { calculateDistance } from './slopeCalculation';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ChainageIndex {
  /** Ordered line vertices. */
  coords: LatLng[];
  /** Cumulative distance (m) at each vertex; same length as coords. */
  cumulative: number[];
  /** Total line length in metres. */
  total: number;
}

/** Precompute cumulative distances along a line for fast chainage lookups. */
export function buildChainageIndex(coords: LatLng[]): ChainageIndex {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += calculateDistance(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
    cumulative.push(total);
  }
  return { coords, cumulative, total };
}

/** Coordinate at a given chainage (clamped to [0, total]). */
export function pointAtChainage(index: ChainageIndex, chainage: number): LatLng | null {
  const { coords, cumulative, total } = index;
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const m = Math.max(0, Math.min(chainage, total));
  // Find the vertex pair spanning m.
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < m) i++;
  const segLen = cumulative[i] - cumulative[i - 1];
  const t = segLen > 0 ? (m - cumulative[i - 1]) / segLen : 0;
  const a = coords[i - 1];
  const b = coords[i];
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Coordinates covering the slice of line between two chainages (inclusive of
 * interpolated endpoints). Used to highlight a segment on the map.
 */
export function sliceByChainage(index: ChainageIndex, startM: number, endM: number): LatLng[] {
  const { coords, cumulative, total } = index;
  if (coords.length < 2) return [...coords];
  const a = Math.max(0, Math.min(startM, endM, total));
  const b = Math.min(total, Math.max(startM, endM, 0));
  if (b - a <= 0) {
    const p = pointAtChainage(index, a);
    return p ? [p] : [];
  }
  const out: LatLng[] = [];
  const startPt = pointAtChainage(index, a);
  if (startPt) out.push(startPt);
  for (let i = 0; i < coords.length; i++) {
    if (cumulative[i] > a && cumulative[i] < b) out.push(coords[i]);
  }
  const endPt = pointAtChainage(index, b);
  if (endPt) out.push(endPt);
  return out;
}

/** Format a chainage in metres for display, e.g. 850 → "0.85 km", 90 → "90 m". */
export function formatChainage(m: number): string {
  if (!isFinite(m)) return '—';
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

/** Format a chainage range, e.g. "0.85–1.20 km". */
export function formatChainageRange(startM: number, endM: number): string {
  if (Math.max(startM, endM) >= 1000) {
    return `${(startM / 1000).toFixed(2)}–${(endM / 1000).toFixed(2)} km`;
  }
  return `${Math.round(startM)}–${Math.round(endM)} m`;
}
