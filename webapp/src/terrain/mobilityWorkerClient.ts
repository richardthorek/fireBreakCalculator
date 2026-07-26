/**
 * Main-thread client for mobilityWorker.ts. Spawns one worker lazily, reused
 * across runs (module-level singleton — mirrors the pattern of the module-
 * level caches elsewhere in this codebase), and exposes a Promise-based API
 * so callers don't deal with postMessage/onmessage correlation directly.
 */

import { MobilityCellResult, MobilityGridCell } from './accumulatedCost';
import { LocalProjection } from '../utils/hexGrid';
import { MobilityWorkerRequest, MobilityWorkerResponse, SimPathNode } from './mobilityWorker';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, (response: MobilityWorkerResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./mobilityWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<MobilityWorkerResponse>) => {
    const resolve = pending.get(e.data.requestId);
    if (resolve) {
      pending.delete(e.data.requestId);
      resolve(e.data);
    }
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
  nightMode: boolean
): Promise<MobilitySearchOutcome> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, response => resolve({ results: response.results, path: response.path }));
    const request: MobilityWorkerRequest = { requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode };
    w.postMessage(request);
  });
}
