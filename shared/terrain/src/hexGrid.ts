/**
 * Pointy-top axial hex grid utilities for the corridor route optimizer.
 *
 * Standard formulas (Red Blob Games hexagonal grid reference — well-tested,
 * kept close to the reference to minimise transcription risk). All hex math
 * happens in a local tangent-plane projection (metres) centred on the
 * corridor being searched; `toLatLng`/`toLocal` convert at the boundary so
 * the rest of the optimizer only ever deals in real coordinates.
 *
 * This is the same style of grid Uber's H3 uses for spatial indexing: tiling
 * an area in hexagons gives each cell 6 equidistant neighbours (unlike a
 * square grid's awkward diagonal), so a path search over it can bend in any
 * of 6 directions at every step instead of being constrained to a forward
 * lane — the reason the optimizer can now find genuinely bending routes
 * rather than just nudging sideways off a straight line.
 */

import { LatLng } from './chainage';

export interface LocalProjection {
  origin: LatLng;
  mPerDegLat: number;
  mPerDegLng: number;
}

export interface LocalPoint {
  x: number;
  y: number;
}

export interface AxialCoord {
  q: number;
  r: number;
}

const DEG2RAD = Math.PI / 180;

/** Build a metres-based tangent-plane projection centred on `origin`. */
export function makeProjection(origin: LatLng): LocalProjection {
  return {
    origin,
    mPerDegLat: 111320,
    mPerDegLng: 111320 * Math.cos(origin.lat * DEG2RAD),
  };
}

export function toLocal(proj: LocalProjection, p: LatLng): LocalPoint {
  return {
    x: (p.lng - proj.origin.lng) * proj.mPerDegLng,
    y: (p.lat - proj.origin.lat) * proj.mPerDegLat,
  };
}

export function toLatLng(proj: LocalProjection, p: LocalPoint): LatLng {
  return {
    lat: proj.origin.lat + p.y / proj.mPerDegLat,
    lng: proj.origin.lng + p.x / proj.mPerDegLng,
  };
}

/** Pointy-top axial hex → local pixel centre (`size` = circumradius, metres). */
export function axialToLocal(hex: AxialCoord, size: number): LocalPoint {
  return {
    x: size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r),
    y: size * (1.5 * hex.r),
  };
}

/** Local pixel → nearest axial hex (cube-rounded). */
export function localToAxial(p: LocalPoint, size: number): AxialCoord {
  const q = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / size;
  const r = ((2 / 3) * p.y) / size;
  return cubeRoundToAxial(q, r);
}

function cubeRoundToAxial(qf: number, rf: number): AxialCoord {
  const x = qf;
  const z = rf;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export const NEIGHBOR_DIRS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(hex: AxialCoord): string {
  return `${hex.q},${hex.r}`;
}

export function hexNeighbors(hex: AxialCoord): AxialCoord[] {
  return NEIGHBOR_DIRS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

/** All hexes exactly `radius` steps from `center` (radius 0 = just the
 *  centre itself), in ring order — standard Red Blob Games hex-ring walk:
 *  start `radius` steps out in one fixed direction, then walk `radius` steps
 *  along each of the 6 sides in turn. */
export function hexRing(center: AxialCoord, radius: number): AxialCoord[] {
  if (radius <= 0) return [center];
  const results: AxialCoord[] = [];
  let hex: AxialCoord = { q: center.q + NEIGHBOR_DIRS[4].q * radius, r: center.r + NEIGHBOR_DIRS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(hex);
      hex = { q: hex.q + NEIGHBOR_DIRS[side].q, r: hex.r + NEIGHBOR_DIRS[side].r };
    }
  }
  return results;
}

/** The `count` hexes nearest `center` (centre first, then ring 1, ring 2, …),
 *  truncating the last ring at exactly `count` in a fixed deterministic
 *  order — used to stamp a compact, roughly-circular cluster of N hexes for
 *  one brush dab (docs/ROUTE_INTELLIGENCE.md §35 painting brush). Not a
 *  perfect circle (a hex ring is a hexagon, not a circle) but close enough
 *  that a user painting "100 hexes" sees a recognisably round patch, and
 *  deterministic so the same click always produces the same stamp. */
export function hexSpiral(center: AxialCoord, count: number): AxialCoord[] {
  const out: AxialCoord[] = [];
  let radius = 0;
  while (out.length < count) {
    for (const hex of hexRing(center, radius)) {
      if (out.length >= count) break;
      out.push(hex);
    }
    radius++;
  }
  return out;
}

/** Hex-step distance between two axial coords (cube-coordinate formula) —
 *  `hexLine`'s own step count, and a small general utility in its own right. */
export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const aq = a.q, ar = a.r, as = -a.q - a.r;
  const bq = b.q, br = b.r, bs = -b.q - b.r;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

/** The straight line of hexes from `a` to `b`, inclusive of both ends, in
 *  order — OCOKA 6 (docs/ROUTE_INTELLIGENCE.md §47, master_plan.md
 *  "Next up"), `terrain/viewshed.ts`'s line-of-sight trace: the ordered
 *  sequence of intermediate cells a sightline from an observer to a target
 *  passes through. Standard cube-coordinate line draw (Red Blob Games hex
 *  grid reference, same source this file's own header credits for the rest
 *  of its hex math): lerp the cube coordinates of `a` and `b` at
 *  `hexDistance(a, b) + 1` evenly-spaced steps, cube-rounding each back to
 *  the nearest hex. A tiny epsilon nudge on one endpoint (the reference
 *  implementation's own fix) breaks exact ties when the line runs straight
 *  along a hex edge, so it doesn't ambiguously alias between two adjacent
 *  hexes at that step. */
export function hexLine(a: AxialCoord, b: AxialCoord): AxialCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const aq = a.q + 1e-6, ar = a.r + 2e-6;
  const bq = b.q + 1e-6, br = b.r + 2e-6;
  const out: AxialCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRoundToAxial(aq + (bq - aq) * t, ar + (br - ar) * t));
  }
  out[0] = a;
  out[n] = b;
  return out;
}

/** Regular-hexagon area factor: area = factor × circumradius². Exported so
 *  callers outside this module (e.g. paintedArea.ts's brush sizing) derive
 *  hex area from the SAME formula `chooseHexSize` uses, rather than a second,
 *  independently-transcribed copy of the constant. */
export const HEX_AREA_FACTOR = (3 * Math.sqrt(3)) / 2;

/** 6 vertices (pointy-top) of a hex in local pixel space. */
export function hexCorners(center: LocalPoint, size: number): LocalPoint[] {
  const pts: LocalPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = DEG2RAD * (60 * i - 30);
    pts.push({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) });
  }
  return pts;
}

/** Perpendicular distance (metres, local coords) from a point to a polyline. */
export function distanceToPolylineLocal(p: LocalPoint, path: LocalPoint[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export function polylineLengthLocal(path: LocalPoint[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}

/** Choose a hex circumradius (metres) that keeps a corridor's cell count near `targetCount`. */
export function chooseHexSize(corridorLength: number, halfWidth: number, targetCount: number): number {
  const corridorArea = Math.max(1, corridorLength * 2 * halfWidth);
  return Math.sqrt(corridorArea / (HEX_AREA_FACTOR * Math.max(1, targetCount)));
}

/**
 * Generate hex centres covering a rectangular box (local coords), for the
 * area-recon scan — no guide line, just every hex whose centre falls inside
 * the box. Same axial-range-then-filter approach as `generateCorridorHexes`.
 */
export function generateBoxHexes(
  minPt: LocalPoint,
  maxPt: LocalPoint,
  size: number
): { hex: AxialCoord; center: LocalPoint }[] {
  const corners = [
    localToAxial({ x: minPt.x, y: minPt.y }, size),
    localToAxial({ x: maxPt.x, y: minPt.y }, size),
    localToAxial({ x: minPt.x, y: maxPt.y }, size),
    localToAxial({ x: maxPt.x, y: maxPt.y }, size),
  ];
  const qMin = Math.min(...corners.map(c => c.q)) - 2;
  const qMax = Math.max(...corners.map(c => c.q)) + 2;
  const rMin = Math.min(...corners.map(c => c.r)) - 2;
  const rMax = Math.max(...corners.map(c => c.r)) + 2;

  const out: { hex: AxialCoord; center: LocalPoint }[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const center = axialToLocal({ q, r }, size);
      if (center.x < minPt.x || center.x > maxPt.x || center.y < minPt.y || center.y > maxPt.y) continue;
      out.push({ hex: { q, r }, center });
    }
  }
  return out;
}

/**
 * Generate hex centres covering a corridor of `halfWidth` metres either side
 * of `pathLocal`, at the given hex size. Unbounded by design — callers that
 * need a hard cap should adjust `size` and regenerate (see routeOptimizer's
 * retry loop) rather than truncate mid-scan, which would bias the resulting
 * corridor toward whichever axial range happens to be iterated first.
 */
export function generateCorridorHexes(
  pathLocal: LocalPoint[],
  halfWidth: number,
  size: number
): { hex: AxialCoord; center: LocalPoint }[] {
  if (pathLocal.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pathLocal) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const margin = halfWidth + size * 2;
  minX -= margin; maxX += margin; minY -= margin; maxY += margin;

  const corners = [
    localToAxial({ x: minX, y: minY }, size),
    localToAxial({ x: maxX, y: minY }, size),
    localToAxial({ x: minX, y: maxY }, size),
    localToAxial({ x: maxX, y: maxY }, size),
  ];
  const qMin = Math.min(...corners.map(c => c.q)) - 2;
  const qMax = Math.max(...corners.map(c => c.q)) + 2;
  const rMin = Math.min(...corners.map(c => c.r)) - 2;
  const rMax = Math.max(...corners.map(c => c.r)) + 2;

  const out: { hex: AxialCoord; center: LocalPoint }[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const center = axialToLocal({ q, r }, size);
      if (center.x < minX || center.x > maxX || center.y < minY || center.y > maxY) continue;
      if (distanceToPolylineLocal(center, pathLocal) > halfWidth) continue;
      out.push({ hex: { q, r }, center });
    }
  }
  return out;
}
