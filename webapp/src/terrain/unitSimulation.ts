/**
 * Unit movement simulation — "bonus feature" (owner, 2026-07-26): drop a unit
 * on the computed path and watch it move in real time (with a speed
 * multiplier), the way an RTS shows an ordered unit crossing the map. The
 * path shown is the SAME one the multi-source search already produced
 * (`extractPath` in accumulatedCost.ts) — nothing here invents a route.
 *
 * "The path may change as the unit gets more local fidelity as it moves":
 * implemented for real, not simulated — once the unit has covered
 * `replanAtFraction` of the ORIGINAL estimated travel time, this controller
 * runs a genuine second search from the unit's CURRENT position (a small AOI
 * box around it) to the same objective, and splices the result onto the
 * already-travelled prefix. The path only ever changes because a real
 * recomputation happened, mirroring the fire-break optimizer's own
 * wide→refine→polish idiom (routeOptimizer.ts) applied to this mode.
 */

import { buildMobilityGrid } from './mobilityGrid';
import { PaintedArea, singleDabArea } from './paintedArea';
import { runMobilitySearchInWorker } from './mobilityWorkerClient';
import { SimPathNode } from './mobilityWorker';
import { MoverTrajectory } from './movementSimulation';

/** Linear interpolation between the two path nodes bracketing `elapsedSeconds`.
 *  Clamps to the endpoints outside the path's time range. Returns null for an
 *  empty path. */
export function positionAtElapsed(
  path: SimPathNode[],
  elapsedSeconds: number
): { lat: number; lng: number; pathIndex: number } | null {
  if (path.length === 0) return null;
  if (path.length === 1 || elapsedSeconds <= path[0].cumulativeSeconds) {
    return { lat: path[0].lat, lng: path[0].lng, pathIndex: 0 };
  }
  const last = path[path.length - 1];
  if (elapsedSeconds >= last.cumulativeSeconds) {
    return { lat: last.lat, lng: last.lng, pathIndex: path.length - 1 };
  }
  for (let i = 1; i < path.length; i++) {
    if (path[i].cumulativeSeconds >= elapsedSeconds) {
      const a = path[i - 1];
      const b = path[i];
      const span = b.cumulativeSeconds - a.cumulativeSeconds;
      const t = span > 0 ? (elapsedSeconds - a.cumulativeSeconds) / span : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, pathIndex: i - 1 };
    }
  }
  return { lat: last.lat, lng: last.lng, pathIndex: path.length - 1 };
}

/** Half-width (metres, converted to degrees at call time) of the small AOI
 *  box built around the unit's current position for a mid-course replan. */
const REPLAN_BOX_HALF_WIDTH_M = 500;

export interface UnitSimulationCallbacks {
  /** Fired every animation frame with the unit's current interpolated position. */
  onPosition: (pos: { lat: number; lng: number }, elapsedSeconds: number) => void;
  /** Fired whenever the displayed path changes (initial set, or a replan spliced it). */
  onPathChange: (path: SimPathNode[]) => void;
  onLog?: (line: string) => void;
  onArrived?: () => void;
}

export class UnitSimulationController {
  private path: SimPathNode[];
  private readonly originalTotalSeconds: number;
  private readonly objective: PaintedArea;
  private readonly profileId: string;
  private readonly nightMode: boolean;
  private readonly replanAtFraction: number;
  private readonly callbacks: UnitSimulationCallbacks;

  private elapsedSeconds = 0;
  private speedMultiplier = 1;
  private lastFrameMs: number | null = null;
  private rafHandle: number | null = null;
  private replanTriggered = false;
  private replanInFlight = false;
  private arrivedFired = false;

  constructor(
    initialPath: SimPathNode[],
    objective: PaintedArea,
    profileId: string,
    nightMode: boolean,
    callbacks: UnitSimulationCallbacks,
    replanAtFraction = 0.5
  ) {
    this.path = initialPath;
    this.originalTotalSeconds = initialPath.length > 0 ? initialPath[initialPath.length - 1].cumulativeSeconds : 0;
    this.objective = objective;
    this.profileId = profileId;
    this.nightMode = nightMode;
    this.callbacks = callbacks;
    this.replanAtFraction = replanAtFraction;
    this.callbacks.onPathChange(this.path);
  }

  setSpeedMultiplier(x: number): void {
    this.speedMultiplier = x;
  }

  start(): void {
    this.lastFrameMs = performance.now();
    const tick = (nowMs: number) => {
      const deltaMs = this.lastFrameMs === null ? 0 : nowMs - this.lastFrameMs;
      this.lastFrameMs = nowMs;
      this.elapsedSeconds += (deltaMs / 1000) * this.speedMultiplier;

      const pos = positionAtElapsed(this.path, this.elapsedSeconds);
      if (pos) this.callbacks.onPosition({ lat: pos.lat, lng: pos.lng }, this.elapsedSeconds);

      if (
        !this.replanTriggered && !this.replanInFlight &&
        this.originalTotalSeconds > 0 &&
        this.elapsedSeconds >= this.originalTotalSeconds * this.replanAtFraction
      ) {
        this.replanTriggered = true;
        this.triggerReplan(pos);
      }

      const totalNow = this.path[this.path.length - 1]?.cumulativeSeconds ?? 0;
      if (this.elapsedSeconds >= totalNow && totalNow > 0) {
        if (!this.arrivedFired) {
          this.arrivedFired = true;
          this.callbacks.onLog?.('UNIT ARRIVED AT OBJECTIVE');
          this.callbacks.onArrived?.();
        }
        return; // stop scheduling further frames once arrived
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  private async triggerReplan(pos: { lat: number; lng: number; pathIndex: number } | null): Promise<void> {
    if (!pos) return;
    this.replanInFlight = true;
    this.callbacks.onLog?.('LOCAL FIDELITY CHECKPOINT — RESAMPLING GROUND FROM CURRENT POSITION…');
    try {
      const localOrigin: PaintedArea = singleDabArea({ lat: pos.lat, lng: pos.lng }, REPLAN_BOX_HALF_WIDTH_M);
      const grid = await buildMobilityGrid(localOrigin, this.objective);
      if (!grid) {
        this.callbacks.onLog?.('REPLAN SKIPPED — LOCAL AREA TOO SMALL, HOLDING ORIGINAL PLAN');
        return;
      }
      const { path: newPath } = await runMobilitySearchInWorker(
        grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, this.profileId, this.nightMode
      );
      if (!newPath || newPath.length === 0) {
        this.callbacks.onLog?.('REPLAN FOUND NO BETTER ROUTE — HOLDING ORIGINAL PLAN');
        return;
      }
      // Keep the already-travelled prefix of the old path (what actually
      // happened so far), then splice the freshly computed remainder,
      // offsetting its cumulative time so interpolation stays continuous.
      const prefix = this.path.filter(n => n.cumulativeSeconds <= this.elapsedSeconds);
      const spliced: SimPathNode[] = [
        ...prefix,
        ...newPath.map(n => ({ ...n, cumulativeSeconds: n.cumulativeSeconds + this.elapsedSeconds })),
      ];
      this.path = spliced;
      this.callbacks.onPathChange(this.path);
      this.callbacks.onLog?.(`PATH REFINED FROM CURRENT POSITION — ${newPath.length} NEW WAYPOINTS`);
    } catch (e) {
      this.callbacks.onLog?.('REPLAN FAILED — HOLDING ORIGINAL PLAN');
    } finally {
      this.replanInFlight = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Ensemble animation — many movers at once (owner, 2026-07-27: "the simulate
// movement draws a single line very quickly… there is a degree of probability
// that over the course of many simulations units take common paths")
// ---------------------------------------------------------------------------

export interface EnsembleMoverState {
  index: number;
  lat: number;
  lng: number;
  /** The ground this mover has actually covered so far — drawn as a fading
   *  trail so the ensemble visibly fans out and re-converges instead of
   *  appearing as a finished picture. */
  trail: { lat: number; lng: number }[];
  arrived: boolean;
  /** True once this mover has reached the end of its own trajectory, whether
   *  or not it made the objective. */
  finished: boolean;
}

export interface EnsembleAnimationCallbacks {
  onFrame: (movers: EnsembleMoverState[], elapsedSeconds: number) => void;
  onComplete?: (elapsedSeconds: number) => void;
  onLog?: (line: string) => void;
}

/**
 * Animates a whole `MoverTrajectory[]` on one clock. Every mover sets off at
 * the same simulated instant and moves at its OWN real pace, so what you watch
 * is the actual spread the ensemble computed — the leaders pulling away, the
 * unlucky ones detouring, and (where the terrain canalises movement) the
 * visible convergence onto shared ground. Nothing here recomputes or smooths a
 * route; it only interpolates trajectories `movementSimulation.ts` produced.
 */
export class EnsembleAnimationController {
  private readonly trajectories: MoverTrajectory[];
  private readonly totalSeconds: number;
  private readonly callbacks: EnsembleAnimationCallbacks;
  private elapsedSeconds = 0;
  private speedMultiplier = 1;
  private lastFrameMs: number | null = null;
  private rafHandle: number | null = null;
  private completeFired = false;

  constructor(trajectories: MoverTrajectory[], callbacks: EnsembleAnimationCallbacks) {
    this.trajectories = trajectories.filter(t => t.steps.length > 0);
    this.totalSeconds = this.trajectories.reduce(
      (max, t) => Math.max(max, t.steps[t.steps.length - 1].cumulativeSeconds), 0
    );
    this.callbacks = callbacks;
  }

  setSpeedMultiplier(x: number): void {
    this.speedMultiplier = x;
  }

  start(): void {
    if (this.trajectories.length === 0) {
      this.callbacks.onLog?.('NO TRAJECTORIES TO ANIMATE');
      return;
    }
    this.lastFrameMs = performance.now();
    const tick = (nowMs: number) => {
      const deltaMs = this.lastFrameMs === null ? 0 : nowMs - this.lastFrameMs;
      this.lastFrameMs = nowMs;
      this.elapsedSeconds += (deltaMs / 1000) * this.speedMultiplier;

      const movers: EnsembleMoverState[] = this.trajectories.map((t, index) => {
        const last = t.steps[t.steps.length - 1];
        const finished = this.elapsedSeconds >= last.cumulativeSeconds;
        const pos = positionAtElapsed(t.steps, this.elapsedSeconds)!;
        const trail = t.steps
          .filter(s => s.cumulativeSeconds <= this.elapsedSeconds)
          .map(s => ({ lat: s.lat, lng: s.lng }));
        trail.push({ lat: pos.lat, lng: pos.lng });
        return { index, lat: pos.lat, lng: pos.lng, trail, arrived: t.arrived && finished, finished };
      });
      this.callbacks.onFrame(movers, this.elapsedSeconds);

      if (this.elapsedSeconds >= this.totalSeconds) {
        if (!this.completeFired) {
          this.completeFired = true;
          this.callbacks.onComplete?.(this.elapsedSeconds);
        }
        return; // stop scheduling once the slowest mover has finished
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }
}
