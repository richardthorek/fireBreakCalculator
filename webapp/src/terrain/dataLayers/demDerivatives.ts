/**
 * DEM derivatives — docs/ROUTE_INTELLIGENCE.md §10.3(a), §10.7 M3a: "free
 * fidelity" computed entirely from the ~10 m elevation grid the app already
 * samples, no new network source, no licensing. Pure, synchronous, no
 * network calls — operates on an elevation grid already in hand (a
 * `MobilityGridCell[]`-compatible array; see `DemDerivativeCell` below).
 *
 * Four outputs per cell:
 *  - `crossSlopeDeg` / `roughness` — docs groups these as one proxy ("standard
 *    deviation of elevation residuals across a cell's neighbours ... a genuine
 *    proxy for rock/dissection"). Both come from ONE local least-squares plane
 *    fit per cell (through the cell's own elevation plus its present hex
 *    neighbours — the hex-topology analogue of the 3×3-window plane fit
 *    raster GIS tools use for slope, e.g. Horn's method): `crossSlopeDeg` is
 *    the fitted plane's gradient magnitude (a direction-agnostic "steepest
 *    local slope in some direction" proxy — see the caveat in its own comment
 *    below), and `roughness` is the standard deviation of each neighbour's
 *    ACTUAL elevation from what that same fitted plane predicts there — the
 *    part of the local relief the smooth trend does NOT explain, which is
 *    exactly the "rock/dissection, not just slope" signal docs asks for.
 *  - `topographicPosition` — a Topographic Position Index (Weiss 2001)
 *    evaluated at hex-neighbour resolution rather than a fixed-radius raster
 *    window: cell elevation vs mean neighbour elevation, scaled by local
 *    relief so the ridge/valley call adapts to whatever elevation range is
 *    actually present in this corridor rather than a fixed metres threshold.
 *  - `twi` — Topographic Wetness Index, `ln(upslope contributing area /
 *    tan(slope))`. This is a REAL (if simplified) multiple-flow-direction
 *    (MFD) accumulation over the finite grid in hand, not the cheap
 *    "count neighbours with higher elevation" proxy the task brief offered as
 *    a fallback — see the TWI section below for why the full pass is cheap
 *    enough to just do properly at these grid sizes (≤ ~1500 cells/corridor
 *    per docs §8).
 */

import { AxialCoord, hexNeighbors, hexKey, makeProjection, toLocal } from '../../utils/hexGrid';

export interface DemDerivativeCell {
  key: string;
  hex: AxialCoord;
  center: { lat: number; lng: number };
  elevation: number;
}

export interface DemDerivatives {
  /** Direction-agnostic local terrain gradient magnitude, degrees — the
   *  fitted plane's steepest slope in ANY direction, not a specific travel
   *  bearing's perpendicular slope. A true per-EDGE cross-slope (docs §3's
   *  "cross-slope of the cell" relative to a direction of travel) needs a
   *  travel heading this cell-level module doesn't have; callers with a
   *  specific directed edge (e.g. `mobilityCost.ts`'s `crossSlopeDeg` option)
   *  should treat this as an upper-bound proxy for "how exposed is this cell
   *  to roll-over risk in its worst direction", not a substitute. */
  crossSlopeDeg: number;
  /** Standard deviation of neighbour elevations from the local fitted-plane
   *  prediction at each neighbour's position, metres — the residual relief
   *  the smooth trend doesn't explain (rock, dissection, deadfall-scale
   *  bumpiness), independent of the overall slope direction/magnitude. */
  roughness: number;
  /** Topographic Position Index classification (Weiss 2001), hex-neighbour
   *  scale: cell elevation vs mean neighbour elevation, relative to local
   *  relief. 'ridge' = clearly above its neighbourhood, 'valley' = clearly
   *  below it, 'midslope' = neither (including flat ground and cells with no
   *  present neighbours to compare against). */
  topographicPosition: 'ridge' | 'midslope' | 'valley';
  /** Topographic Wetness Index, ln(upslope contributing area / tan(slope)).
   *  Contributing area is in HEX-CELL-COUNT units (see TWI section) — TWI
   *  here is a relative/comparative index for ridge-vs-drainage-line
   *  identification within one scan, not an absolute hydrological figure. */
  twi: number;
}

// ---------------------------------------------------------------------------
// Local least-squares plane fit — no external dependency, small closed-form
// 3x3 solve (Cramer's rule), same "plain, self-contained" style as
// accumulatedCost.ts's MinHeap.
// ---------------------------------------------------------------------------

interface LocalPlanePoint {
  x: number;
  y: number;
  z: number;
}

interface FittedPlane {
  /** Intercept — the plane's own fitted elevation at (0,0), which is close to
   *  but not necessarily exactly the cell's own elevation once more than 3
   *  points pull an over-determined least-squares fit slightly off it. */
  a: number;
  /** dz/dx */
  b: number;
  /** dz/dy */
  c: number;
}

function det3(m: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** Least-squares fit of z = a + b·x + c·y over ≥3 points via the normal
 *  equations, solved with Cramer's rule (3×3 — trivial to do directly rather
 *  than pull in a linear-algebra dependency for one closed-form solve). Null
 *  when fewer than 3 points are given, or the points are (near-)collinear —
 *  callers fall back to a coarser per-neighbour estimate in that case rather
 *  than divide by a near-zero determinant. */
function fitLocalPlane(points: LocalPlanePoint[]): FittedPlane | null {
  if (points.length < 3) return null;
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (const p of points) {
    n++;
    sx += p.x; sy += p.y; sz += p.z;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * p.z; syz += p.y * p.z;
  }
  const A: [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const D = det3(A);
  // Near-exact-zero guard for degenerate (collinear, or <3 distinct) point
  // configurations — a well-formed hex neighbourhood is many orders of
  // magnitude above this, so this only trips on genuine degeneracy.
  if (Math.abs(D) < 1e-6) return null;

  const bVec: [number, number, number] = [sz, sxz, syz];
  const Aa: [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
    [bVec[0], A[0][1], A[0][2]],
    [bVec[1], A[1][1], A[1][2]],
    [bVec[2], A[2][1], A[2][2]],
  ];
  const Ab: [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
    [A[0][0], bVec[0], A[0][2]],
    [A[1][0], bVec[1], A[1][2]],
    [A[2][0], bVec[2], A[2][2]],
  ];
  const Ac: [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] = [
    [A[0][0], A[0][1], bVec[0]],
    [A[1][0], A[1][1], bVec[1]],
    [A[2][0], A[2][1], bVec[2]],
  ];
  return { a: det3(Aa) / D, b: det3(Ab) / D, c: det3(Ac) / D };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeDemDerivatives(cells: DemDerivativeCell[]): Map<string, DemDerivatives> {
  const byKey = new Map<string, DemDerivativeCell>();
  for (const c of cells) byKey.set(c.key, c);

  const results = new Map<string, DemDerivatives>();
  const tanSlopeByKey = new Map<string, number>();

  for (const cell of cells) {
    const neighbors: DemDerivativeCell[] = [];
    for (const h of hexNeighbors(cell.hex)) {
      const n = byKey.get(hexKey(h));
      if (n) neighbors.push(n);
    }

    // Local tangent-plane projection centred on THIS cell — reused from
    // hexGrid.ts (the same projection style the rest of the mode already
    // relies on) purely to get signed (x, y) metre offsets for the plane fit;
    // at hex-cell separations (tens–hundreds of metres) this is equivalent to
    // a geodesic distance for our purposes.
    const proj = makeProjection(cell.center);
    const neighborLocal = neighbors.map((n) => {
      const p = toLocal(proj, n.center);
      return { key: n.key, x: p.x, y: p.y, z: n.elevation };
    });

    const plane = fitLocalPlane([{ x: 0, y: 0, z: cell.elevation }, ...neighborLocal]);

    let crossSlopeDeg = 0;
    let roughness = 0;
    let tanSlope = 0;

    if (plane) {
      tanSlope = Math.hypot(plane.b, plane.c);
      crossSlopeDeg = Math.atan(tanSlope) * (180 / Math.PI);
      if (neighborLocal.length > 0) {
        const residuals = neighborLocal.map((p) => p.z - (plane.a + plane.b * p.x + plane.c * p.y));
        const meanRes = residuals.reduce((s, r) => s + r, 0) / residuals.length;
        const variance = residuals.reduce((s, r) => s + (r - meanRes) ** 2, 0) / residuals.length;
        roughness = Math.sqrt(variance);
      }
    } else if (neighborLocal.length > 0) {
      // Degenerate fit (< 3 usable points, or a collinear boundary
      // configuration) — fall back to the steepest single-neighbour slope as
      // a coarser crossSlopeDeg proxy. Roughness needs ≥3 points to mean
      // anything (a residual against a single neighbour is just the raw
      // slope, not an independent "bumpiness" signal) so it is left at 0
      // rather than manufactured from too little data.
      for (const p of neighborLocal) {
        const dist = Math.hypot(p.x, p.y);
        if (dist <= 0) continue;
        const s = Math.abs(p.z - cell.elevation) / dist;
        if (s > tanSlope) tanSlope = s;
      }
      crossSlopeDeg = Math.atan(tanSlope) * (180 / Math.PI);
    }
    tanSlopeByKey.set(cell.key, tanSlope);

    // Topographic Position Index (Weiss 2001), hex-neighbour scale: cell
    // elevation vs mean neighbour elevation, scaled by the neighbourhood's
    // own local relief so the ridge/valley call is relative to whatever
    // elevation range this corridor actually has, not a fixed metres cutoff
    // that would suit a floodplain and a mountain corridor differently.
    let topographicPosition: 'ridge' | 'midslope' | 'valley' = 'midslope';
    if (neighbors.length > 0) {
      const meanNeighborElev = neighbors.reduce((s, n) => s + n.elevation, 0) / neighbors.length;
      const relief = neighbors.reduce((s, n) => s + Math.abs(n.elevation - cell.elevation), 0) / neighbors.length;
      if (relief > 0) {
        const tpi = cell.elevation - meanNeighborElev;
        if (tpi > 0.5 * relief) topographicPosition = 'ridge';
        else if (tpi < -0.5 * relief) topographicPosition = 'valley';
      }
    }

    results.set(cell.key, { crossSlopeDeg, roughness, topographicPosition, twi: 0 });
  }

  // -------------------------------------------------------------------------
  // TWI: real multiple-flow-direction (MFD) accumulation, not the "count
  // higher neighbours" shortcut.
  //
  // WHY THE FULL PASS INSTEAD OF THE CHEAP PROXY: the task brief offered
  // "count of neighbouring cells with higher elevation" as an acceptable
  // cheap stand-in. A genuine accumulation is only one sort (O(N log N)) plus
  // one O(N·6) routing pass over a grid docs §8 already caps at ~1500 cells
  // per corridor — negligible cost for a materially more meaningful number
  // (a real upslope-contributing-area estimate, not a same-cell neighbour
  // count), so there is no real reason to take the coarser shortcut here.
  //
  // METHOD: process cells in DESCENDING elevation order (highest first, i.e.
  // in the order water would leave each cell); each cell distributes its
  // currently-accumulated value to every STRICTLY LOWER present neighbour,
  // weighted by slope (drop / distance) to that neighbour — a standard MFD
  // weighting (steeper, closer downslope neighbours get more of the flow)
  // that avoids the single-direction (D8) grid-alignment artefacts a
  // steepest-descent-only routing would introduce. Routing only to STRICTLY
  // lower cells and processing in descending order makes this provably
  // cycle-free: by the time a cell is processed, every cell that could have
  // routed flow INTO it (all strictly higher cells) has already been
  // processed and has already deposited its share, so `accumulated.get(cell)`
  // is final at the moment it's read. A cell with no lower neighbour (a
  // local sink/pit) simply stops accumulating further — the same closure
  // real hydrological flow has at a real depression.
  //
  // UNITS: contributing area is expressed in HEX-CELL-COUNT units (each cell
  // starts at 1 "unit" of its own area), not m², because this module receives
  // no hex circumradius — only cell centres and elevations. TWI's absolute
  // value depends on the area unit chosen, but every use of TWI in this app
  // is relative (comparing cells within one scan to flag drainage lines vs
  // ridges), which is invariant to a constant unit choice up to an additive
  // ln(constant) — an honestly-stated simplification, not a fudge.
  // -------------------------------------------------------------------------

  const accumulated = new Map<string, number>();
  for (const c of cells) accumulated.set(c.key, 1);

  const byElevDesc = [...cells].sort((a, b) => b.elevation - a.elevation);
  for (const cell of byElevDesc) {
    const current = accumulated.get(cell.key) ?? 1;
    const proj = makeProjection(cell.center);
    const downslope: { key: string; weight: number }[] = [];
    for (const h of hexNeighbors(cell.hex)) {
      const n = byKey.get(hexKey(h));
      if (!n || n.elevation >= cell.elevation) continue; // strictly lower only — cycle safety, see above
      const p = toLocal(proj, n.center);
      const dist = Math.hypot(p.x, p.y);
      if (dist <= 0) continue;
      const drop = cell.elevation - n.elevation;
      downslope.push({ key: n.key, weight: drop / dist });
    }
    if (downslope.length === 0) continue; // local sink — accumulation terminates here
    const weightSum = downslope.reduce((s, d) => s + d.weight, 0);
    if (weightSum <= 0) continue;
    for (const d of downslope) {
      const share = current * (d.weight / weightSum);
      accumulated.set(d.key, (accumulated.get(d.key) ?? 1) + share);
    }
  }

  // Standard hydrology-modelling convention: floor near-zero slopes so a
  // flat cell doesn't divide by ~0 and blow TWI up to +Infinity.
  const TAN_SLOPE_EPSILON = 0.01; // ≈ 0.57°

  for (const cell of cells) {
    const r = results.get(cell.key);
    if (!r) continue;
    const area = accumulated.get(cell.key) ?? 1;
    const tanSlope = Math.max(TAN_SLOPE_EPSILON, tanSlopeByKey.get(cell.key) ?? 0);
    r.twi = Math.log(area / tanSlope);
  }

  return results;
}
