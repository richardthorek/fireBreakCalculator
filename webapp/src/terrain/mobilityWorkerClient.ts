/**
 * Main-thread client for mobilityWorker.ts. Spawns one worker lazily, reused
 * across runs (module-level singleton — mirrors the pattern of the module-
 * level caches elsewhere in this codebase), and exposes a Promise-based API
 * so callers don't deal with postMessage/onmessage correlation directly.
 *
 * Progress messages are routed to a per-request callback rather than resolving
 * the promise, so a long run (the movement ensemble) can drive a progress bar
 * without the caller subscribing to the worker itself.
 */

import { MobilityCellResult, MobilityGridCell } from './accumulatedCost';
import { LocalProjection } from '../utils/hexGrid';
import {
  MobilityWorkerRequest, MobilityWorkerResponse, SimPathNode,
} from './mobilityWorker';
import { MovementEnsembleResult } from './movementSimulation';
import { RestrictionPlan } from './restrictionPlanner';
import { RoadSpeedOverrides } from './roadSpeedModel';

let worker: Worker | null = null;
let nextRequestId = 1;

interface PendingEntry {
  resolve: (response: MobilityWorkerResponse) => void;
  onProgress?: (fraction: number, phase: 'ensemble' | 'restrictions' | 'rerun', log?: string) => void;
}
const pending = new Map<number, PendingEntry>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./mobilityWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<MobilityWorkerResponse>) => {
    const entry = pending.get(e.data.requestId);
    if (!entry) return;
    if (e.data.kind === 'progress') {
      entry.onProgress?.(e.data.fraction, e.data.phase, e.data.log);
      return;
    }
    pending.delete(e.data.requestId);
    entry.resolve(e.data);
  };
  return worker;
}

export interface MobilitySearchOutcome {
  results: MobilityCellResult[];
  path: SimPathNode[] | null;
}

export function runMobilitySearchInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  roadSpeedOverrides?: RoadSpeedOverrides
): Promise<MobilitySearchOutcome> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => {
        if (response.kind !== 'search') { resolve({ results: [], path: null }); return; }
        resolve({ results: response.results, path: response.path });
      },
    });
    const request: MobilityWorkerRequest = {
      kind: 'search', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      roadSpeedOverrides,
    };
    w.postMessage(request);
  });
}

export interface MovementEnsembleRequestOptions {
  moverCount: number;
  spreadId: string;
  seed: number;
  /** Also derive and evaluate the recommended restriction set. */
  planRestrictions: boolean;
  maxRestrictions?: number;
  roadSpeedOverrides?: RoadSpeedOverrides;
  onProgress?: (fraction: number, phase: 'ensemble' | 'restrictions' | 'rerun') => void;
  onLog?: (line: string) => void;
}

export interface MovementEnsembleOutcome {
  ensemble: MovementEnsembleResult | null;
  plan: RestrictionPlan | null;
}

/** Run the probabilistic movement ensemble (movementSimulation.ts) — and,
 *  optionally, the restriction planner built on it — in the worker, over cells
 *  the caller has ALREADY sampled. This never resamples. */
export function runMovementEnsembleInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  options: MovementEnsembleRequestOptions
): Promise<MovementEnsembleOutcome> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => resolve(
        response.kind === 'movement'
          ? { ensemble: response.ensemble, plan: response.plan }
          : { ensemble: null, plan: null }
      ),
      onProgress: (fraction, phase, log) => {
        if (log) options.onLog?.(log);
        else options.onProgress?.(fraction, phase);
      },
    });
    const request: MobilityWorkerRequest = {
      kind: 'movement', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      moverCount: options.moverCount, spreadId: options.spreadId, seed: options.seed,
      planRestrictions: options.planRestrictions, maxRestrictions: options.maxRestrictions,
      roadSpeedOverrides: options.roadSpeedOverrides,
    };
    w.postMessage(request);
  });
}
