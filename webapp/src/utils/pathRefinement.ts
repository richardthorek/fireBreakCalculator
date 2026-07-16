/**
 * Post-optimization path refinement.
 *
 * The hex-grid Dijkstra search finds the cheapest route through terrain and
 * fuel, but its output rides the hex cell CENTRES — so the drawn line steps
 * from centre to centre in a slightly blocky zig-zag, and where the search
 * chose to reuse an existing trail (a discounted edge) the line runs roughly
 * ALONGSIDE the road rather than ON it. This module takes that coarse path and
 * refines it into a more realistic line, using data already held locally (the
 * OSM trails fetched for the corridor + the session-retained vegetation
 * rasters/polygons) so it costs no extra network round trips:
 *
 *  1. **Snap to trails.** Where the path runs close to and roughly PARALLEL
 *     with a mapped trail/road, pull its vertices onto the trail geometry — a
 *     dozer following Old Mill Rd should trace the road, not weave beside it.
 *     An angle gate stops a path that merely CROSSES a trail from spiking onto
 *     it.
 *  2. **Local fuel-aware smoothing.** Between hex centres the true fuel edge
 *     sits somewhere the coarse grid never sampled. Each free (un-snapped)
 *     vertex is allowed one small lateral nudge toward lower-fuel ground,
 *     resolved from the retained local vegetation data — a finer, more
 *     realistic line without re-running the whole search at a finer hex size.
 *
 * Everything here is pure geometry over already-fetched data; the heavy hex
 * heatmap is untouched (it still shows the full scanned corridor). Endpoints —
 * the user's own waypoints — are never moved.
 */

import { LatLng } from './chainage';
import { calculateDistance } from './slopeCalculation';
import { InfrastructureTrail } from './infrastructureService';

export interface RefineOptions {
  /** Max distance (m) a vertex will snap to a trail. Default 35. */
  snapThresholdM?: number;
  /** Max angle (deg) between the local path heading and the trail's heading at
   *  the projection for a snap to be allowed — stops perpendicular crossings
   *  spiking onto the trail. Default 40. */
  maxSnapAngleDeg?: number;
  /** Spacing (m) the path is densified to before refining. Finer = smoother
   *  snap/nudge but more points to process. Default 20. */
  resampleM?: number;
  /** Enable trail snapping. Default true. */
  snapToTrails?: boolean;
  /** Max lateral nudge (m) a free vertex may take toward lower fuel. 0 disables
   *  the fuel-aware smoothing. Default 0 (caller opts in by passing fuelCostAt). */
  maxFuelNudgeM?: number;
  /** Local fuel-cost lookup (higher = harder to cut), zero-network — typically
   *  backed by the retained area vegetation resolver. When omitted, the
   *  fuel-aware smoothing step is skipped entirely. */
  fuelCostAt?: (lat: number, lng: number) => number | null;
}

const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Local planar projection of a lat/lng around an origin, in metres. */
function toXY(p: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * mPerDegLng(origin.lat),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}
function toLL(xy: { x: number; y: number }, origin: LatLng): LatLng {
  return {
    lat: origin.lat + xy.y / M_PER_DEG_LAT,
    lng: origin.lng + xy.x / mPerDegLng(origin.lat),
  };
}

/**
 * Resample a polyline to roughly uniform spacing, preserving the exact first
 * and last vertices (the user's waypoints). Densifying first means the snap and
 * nudge steps act on a fine, even set of points instead of the sparse hex
 * centres, so the refined line hugs curved trails smoothly.
 */
export function resamplePath(coords: LatLng[], spacingM: number): LatLng[] {
  if (coords.length < 2 || spacingM <= 0) return coords.slice();
  const out: LatLng[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = calculateDistance(a.lat, a.lng, b.lat, b.lng);
    if (seg <= spacingM) {
      out.push(b);
      continue;
    }
    const steps = Math.ceil(seg / spacingM);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return out;
}

interface Projection {
  /** Closest point on any trail, in the local XY frame. */
  point: { x: number; y: number };
  /** Distance (m) from the query point to that projection. */
  distM: number;
  /** Unit tangent of the trail segment at the projection (local XY). */
  tangent: { x: number; y: number };
}

/**
 * Project a point onto the nearest segment across all trails, returning the
 * closest point, its distance, and the trail's local direction there. Works in
 * a local metric frame centred on the query point so distances and angles are
 * true metres/degrees regardless of latitude.
 */
function projectToTrails(p: LatLng, trails: InfrastructureTrail[]): Projection | null {
  let best: Projection | null = null;
  for (const trail of trails) {
    const c = trail.coords;
    for (let i = 1; i < c.length; i++) {
      const a = toXY(c[i - 1], p);
      const b = toXY(c[i], p);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? -(a.x * dx + a.y * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      const d = Math.hypot(qx, qy);
      if (!best || d < best.distM) {
        const tl = Math.hypot(dx, dy) || 1;
        best = { point: { x: qx, y: qy }, distM: d, tangent: { x: dx / tl, y: dy / tl } };
      }
    }
  }
  return best;
}

/** Smallest angle (deg) between two directions, treating a heading and its
 *  reverse as equivalent (a trail traversed either way is "parallel"). */
function headingDeltaDeg(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const la = Math.hypot(a.x, a.y) || 1;
  const lb = Math.hypot(b.x, b.y) || 1;
  let cos = (a.x * b.x + a.y * b.y) / (la * lb);
  cos = Math.max(-1, Math.min(1, Math.abs(cos))); // |cos| → treat reversed as parallel
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Snap path vertices onto nearby, roughly-parallel trails. Interior vertices
 * only — the endpoints stay put. A vertex snaps when the nearest trail is
 * within `snapThresholdM` AND the trail runs within `maxSnapAngleDeg` of the
 * local path heading there, so a route that follows a road collapses onto it
 * while one that merely crosses a road is left alone.
 */
export function snapPathToTrails(
  coords: LatLng[],
  trails: InfrastructureTrail[],
  snapThresholdM: number,
  maxSnapAngleDeg: number
): LatLng[] {
  if (coords.length < 3 || trails.length === 0) return coords.slice();
  const out = coords.slice();
  for (let i = 1; i < coords.length - 1; i++) {
    const p = coords[i];
    const proj = projectToTrails(p, trails);
    if (!proj || proj.distM > snapThresholdM) continue;
    // Local path heading at this vertex (neighbour to neighbour), local frame.
    const prev = toXY(coords[i - 1], p);
    const next = toXY(coords[i + 1], p);
    const heading = { x: next.x - prev.x, y: next.y - prev.y };
    if (headingDeltaDeg(heading, proj.tangent) > maxSnapAngleDeg) continue;
    out[i] = toLL(proj.point, p);
  }
  return out;
}

/**
 * Nudge each free (un-snapped) interior vertex a small step perpendicular to
 * the local path direction toward lower-fuel ground, using the zero-network
 * local fuel lookup. Bounded by `maxNudgeM` so refinement smooths the line
 * without undoing the search's corridor-level routing. Vertices whose position
 * is already fixed (snapped to a trail) are passed through unchanged via the
 * `locked` set.
 */
export function nudgePathByFuel(
  coords: LatLng[],
  fuelCostAt: (lat: number, lng: number) => number | null,
  maxNudgeM: number,
  locked: Set<number>
): LatLng[] {
  if (coords.length < 3 || maxNudgeM <= 0) return coords.slice();
  const out = coords.slice();
  for (let i = 1; i < coords.length - 1; i++) {
    if (locked.has(i)) continue;
    const p = coords[i];
    const prev = toXY(coords[i - 1], p);
    const next = toXY(coords[i + 1], p);
    const dir = { x: next.x - prev.x, y: next.y - prev.y };
    const dl = Math.hypot(dir.x, dir.y);
    if (dl < 1e-6) continue;
    // Unit perpendicular (left/right of travel).
    const perp = { x: -dir.y / dl, y: dir.x / dl };
    const here = fuelCostAt(p.lat, p.lng);
    if (here == null) continue;
    // Sample a modest step to each side; move toward the cheaper one only if
    // the improvement is real (avoids jitter on flat-fuel ground).
    const step = maxNudgeM;
    const leftLL = toLL({ x: perp.x * step, y: perp.y * step }, p);
    const rightLL = toLL({ x: -perp.x * step, y: -perp.y * step }, p);
    const left = fuelCostAt(leftLL.lat, leftLL.lng);
    const right = fuelCostAt(rightLL.lat, rightLL.lng);
    let target: LatLng | null = null;
    let bestCost = here;
    if (left != null && left < bestCost - 1e-3) { bestCost = left; target = leftLL; }
    if (right != null && right < bestCost - 1e-3) { bestCost = right; target = rightLL; }
    if (target) out[i] = target;
  }
  return out;
}

/**
 * Refine a coarse (hex-centre) optimized path into a more realistic line.
 * Densify → snap-to-trails → local fuel nudge. Pure over already-fetched data;
 * returns a new coordinate array (the caller still simplifies for rendering).
 */
export function refinePath(
  coords: LatLng[],
  trails: InfrastructureTrail[],
  options: RefineOptions = {}
): LatLng[] {
  if (coords.length < 2) return coords.slice();
  const {
    snapThresholdM = 35,
    maxSnapAngleDeg = 40,
    resampleM = 20,
    snapToTrails = true,
    maxFuelNudgeM = 0,
    fuelCostAt,
  } = options;

  let path = resamplePath(coords, resampleM);

  // Track which vertices got snapped so the fuel nudge leaves them fixed.
  const locked = new Set<number>();
  if (snapToTrails && trails.length > 0) {
    const snapped = snapPathToTrails(path, trails, snapThresholdM, maxSnapAngleDeg);
    for (let i = 0; i < snapped.length; i++) {
      if (snapped[i] !== path[i]) locked.add(i);
    }
    path = snapped;
  }

  if (maxFuelNudgeM > 0 && fuelCostAt) {
    path = nudgePathByFuel(path, fuelCostAt, maxFuelNudgeM, locked);
  }

  return path;
}
