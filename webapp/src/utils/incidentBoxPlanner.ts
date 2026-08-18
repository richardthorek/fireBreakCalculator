/**
 * Incident box planner — the owner's own framing: "rate of spread plus
 * construction time equals minimum distance."
 *
 * Given a rough drawn/imported fire perimeter, a wind reading, and a
 * MANUALLY-ENTERED rate of spread per sector (never predicted by this
 * module — see the data-honesty rule in the root CLAUDE.md and the
 * already-blocked "real fuel-age curve" item in master_plan.md; this app
 * does not invent fire-behaviour numbers), solve the smallest standoff
 * distance per sector such that the existing production-time engine's own
 * conservative (slowest compatible resource) construction time for a break
 * at that distance does not exceed the time the fire takes to reach it.
 *
 * This is a fixed-point iteration, not a closed-form solve, because
 * construction time itself depends on the terrain/vegetation actually along
 * the offset line (which the existing engine — not this module — computes).
 * Bounded to a few rounds for cost; each round evaluates the sector's own
 * OFFSET STRAIGHT LINE (not a pathfound corridor — that would be too
 * expensive to run repeatedly). Once distances settle, the FINAL box is
 * pathfound once via the existing corridor optimizer (`routeOptimizer.ts`)
 * so the recommended line actually snaps to existing roads/trails (already
 * "constructed", per the owner) and avoids water, then the same
 * production-time engine estimates the real, buildable route.
 */

import { LatLng } from '@firebreak/terrain';
import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { analyzeTrackSlopes } from './slopeCalculation';
import { analyzeTrackVegetation } from './vegetationAnalysis';
import { buildRouteProfile } from './routeProfile';
import { calculateEquipmentAnalysis, BackendAnalysisResponse } from './backendAnalysis';
import { optimizeRoute } from './routeOptimizer';
import { calculateDistance } from '@firebreak/terrain';
import {
  BoxSector,
  SectorVertex,
  classifySectors,
  offsetBySector,
  toClosedRing,
  WindLike,
} from './incidentBoxGeometry';

const SECTORS: BoxSector[] = ['head', 'leftFlank', 'rightFlank', 'rear'];
const MAX_ITERATIONS = 3;
const CONVERGENCE_TOLERANCE_M = 15;
const MIN_STANDOFF_M = 30;
const MAX_STANDOFF_M = 5000;
const SEED_STANDOFF_M = 100;

export interface RateOfSpreadInputs {
  /** Required — head fire rate of spread, metres/hour, the user's own figure. */
  headMPerHour: number;
  /** Optional — defaults to `headMPerHour` (deliberately conservative: never
   *  assumes the flanks/rear are slower unless the user says so). */
  flankMPerHour?: number;
  rearMPerHour?: number;
}

export interface SectorPlan {
  sector: BoxSector;
  rosMPerHour: number;
  distanceM: number;
  buildTimeHours: number;
  /** False when the iteration hit MAX_ITERATIONS without settling — treat
   *  `distanceM` as a lower bound, not a converged answer. */
  converged: boolean;
  vertexCount: number;
}

export interface IncidentBoxPlan {
  ring: [number, number][];
  vertexSectors: SectorVertex[];
  sectors: SectorPlan[];
  /** The pathfound, buildable route (existing corridor optimizer output). */
  routeCoords: LatLng[];
  /** True when the corridor optimizer couldn't run and `routeCoords` is just the raw box ring. */
  usedFallbackRoute: boolean;
  distance: number;
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis;
  /** True if any sector's iteration didn't converge — the estimate is a
   *  conservative lower bound on standoff distance, not a settled answer. */
  anySectorUnconverged: boolean;
  /** Full equipment comparison for the final buildable route (same shape AnalysisPanel uses). */
  finalAnalysis: BackendAnalysisResponse;
  /** Conservative (max compatible, never min) construction time for the final route, hours. */
  conservativeHours: number;
}

function rosForSector(sector: BoxSector, inputs: RateOfSpreadInputs): number {
  if (sector === 'head') return inputs.headMPerHour;
  if (sector === 'rear') return inputs.rearMPerHour ?? inputs.headMPerHour;
  return inputs.flankMPerHour ?? inputs.headMPerHour;
}

/** Conservative (max compatible, never min) construction time, hours, for a straight line. */
async function estimateBuildTimeHours(coords: LatLng[]): Promise<number> {
  if (coords.length < 2) return NaN;
  const distance = calculateDistance(coords);
  if (distance < 1) return 0;
  const [trackAnalysis, vegetationAnalysis] = await Promise.all([
    analyzeTrackSlopes(coords),
    analyzeTrackVegetation(coords),
  ]);
  if (!trackAnalysis || !vegetationAnalysis) return NaN;
  const segments = buildRouteProfile(distance, trackAnalysis, vegetationAnalysis);
  let response: BackendAnalysisResponse;
  try {
    response = await calculateEquipmentAnalysis({ distance, trackAnalysis, vegetationAnalysis, segments });
  } catch {
    return NaN;
  }
  const compatible = response.calculations.filter(c => c.compatible);
  const pool = compatible.length > 0 ? compatible : response.calculations;
  if (pool.length === 0) return NaN;
  return Math.max(...pool.map(c => c.time));
}

/** Solve one sector's standoff distance by fixed-point iteration. Never throws. */
async function solveSector(
  sector: BoxSector,
  sectorVertices: SectorVertex[],
  rosMPerHour: number,
  neighbourPoint: LatLng | null
): Promise<SectorPlan> {
  let distanceM = SEED_STANDOFF_M;
  let buildTimeHours = 0;
  let converged = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const offset = offsetBySector(sectorVertices, {
      head: distanceM, leftFlank: distanceM, rightFlank: distanceM, rear: distanceM,
    } as Record<BoxSector, number>).map(o => o.point);
    // A lone-vertex sector needs a 2nd point to form a line — borrow the
    // nearest adjacent sector's vertex (same offset scale) as a stand-in.
    const evalLine = offset.length >= 2 ? offset : (neighbourPoint ? [...offset, neighbourPoint] : offset);
    const t = await estimateBuildTimeHours(evalLine);
    if (!Number.isFinite(t)) {
      // Can't evaluate (e.g. offline/backend down) — keep the seed distance,
      // flagged unconverged so the UI treats it as an honest lower bound.
      buildTimeHours = NaN;
      break;
    }
    buildTimeHours = t;
    const requiredM = Math.min(MAX_STANDOFF_M, Math.max(MIN_STANDOFF_M, rosMPerHour * t));
    if (Math.abs(requiredM - distanceM) <= CONVERGENCE_TOLERANCE_M) {
      distanceM = requiredM;
      converged = true;
      break;
    }
    distanceM = requiredM;
  }

  return { sector, rosMPerHour, distanceM, buildTimeHours, converged, vertexCount: sectorVertices.length };
}

export interface PlanIncidentBoxOptions {
  signal?: AbortSignal;
}

/**
 * Run the full plan: classify sectors, solve each sector's standoff distance,
 * build the box, pathfind it, and produce the final buildable-route estimate
 * inputs (same shape the manual line-draw flow already uses, so the existing
 * `AnalysisPanel`/cost engine need no changes).
 */
export async function planIncidentBox(
  perimeter: LatLng[],
  wind: WindLike,
  ros: RateOfSpreadInputs,
  options: PlanIncidentBoxOptions = {}
): Promise<IncidentBoxPlan> {
  if (perimeter.length < 3) throw new Error('planIncidentBox requires at least 3 perimeter vertices');

  const vertexSectors = classifySectors(perimeter, wind);
  const bySector = new Map<BoxSector, SectorVertex[]>();
  for (const v of vertexSectors) {
    const list = bySector.get(v.sector) ?? [];
    list.push(v);
    bySector.set(v.sector, list);
  }

  const sectorPlans: SectorPlan[] = [];
  for (const sector of SECTORS) {
    const vertices = bySector.get(sector);
    if (!vertices || vertices.length === 0) continue;
    const neighbourSector = SECTORS.find(s => s !== sector && bySector.get(s)?.length);
    const neighbourVertex = neighbourSector ? bySector.get(neighbourSector)?.[0] : undefined;
    const plan = await solveSector(
      sector,
      vertices,
      rosForSector(sector, ros),
      neighbourVertex ? neighbourVertex.sourcePoint : null
    );
    sectorPlans.push(plan);
  }

  const distanceBySector: Record<BoxSector, number> = { head: SEED_STANDOFF_M, leftFlank: SEED_STANDOFF_M, rightFlank: SEED_STANDOFF_M, rear: SEED_STANDOFF_M };
  for (const p of sectorPlans) distanceBySector[p.sector] = p.distanceM;

  const offsetVertices = offsetBySector(vertexSectors, distanceBySector);
  const boxPoints = offsetVertices.map(o => o.point);
  const ring = toClosedRing(boxPoints);

  // Pathfind the final box once — snaps to existing roads/trails (already
  // built, per the owner) and avoids water, the "specific corridors" step.
  let routeCoords: LatLng[] = boxPoints;
  let usedFallbackRoute = true;
  try {
    const closedLoop = [...boxPoints, boxPoints[0]];
    const result = await optimizeRoute(closedLoop, { maxOffsetM: 200, signal: options.signal });
    if (result && result.coords.length >= 2) {
      routeCoords = result.coords;
      usedFallbackRoute = false;
    }
  } catch {
    // Fall back to the raw box ring — flagged via usedFallbackRoute.
  }

  const distance = calculateDistance(routeCoords);
  const [trackAnalysis, vegetationAnalysis] = await Promise.all([
    analyzeTrackSlopes(routeCoords),
    analyzeTrackVegetation(routeCoords),
  ]);
  const segments = buildRouteProfile(distance, trackAnalysis, vegetationAnalysis);
  const finalAnalysis = await calculateEquipmentAnalysis({ distance, trackAnalysis, vegetationAnalysis, segments });
  const compatible = finalAnalysis.calculations.filter(c => c.compatible);
  const pool = compatible.length > 0 ? compatible : finalAnalysis.calculations;
  const conservativeHours = pool.length > 0 ? Math.max(...pool.map(c => c.time)) : NaN;

  return {
    ring,
    vertexSectors,
    sectors: sectorPlans,
    routeCoords,
    usedFallbackRoute,
    distance,
    trackAnalysis,
    vegetationAnalysis,
    anySectorUnconverged: sectorPlans.some(p => !p.converged),
    finalAnalysis,
    conservativeHours,
  };
}
