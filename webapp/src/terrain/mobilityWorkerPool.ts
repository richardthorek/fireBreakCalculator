/**
 * A small pool of `mobilityWorker.ts` instances (WP4, movement-analysis
 * performance work) for the one phase whose own units of work are already
 * proven independent: key-terrain candidate scoring
 * (`scoreKeyTerrainCandidates`, `keyTerrain.ts`'s own header — "each is a
 * pure function of (cells, penalties)", and docs/ROUTE_INTELLIGENCE.md
 * §47.4's parallelism table lists it as a `Yes`). This is ~70 of a standard
 * run's ~120 full-grid Dijkstra passes (profiling audit — up to
 * `MAX_CANDIDATES_EVALUATED`(10) candidates × `EVALUATION_ROUTE_COUNT`(6+1)
 * searches each), the single largest chunk of the analysis that genuinely
 * parallelises without touching the mover ensemble's own delicate seeded-RNG
 * / streaming machinery (WP4's other half, `movementSimulation.ts`).
 *
 * DELIBERATELY NOT a generic "N-worker task pool" abstraction. Reusing the
 * EXISTING `mobilityWorker.ts` request/response protocol unchanged (no new
 * request kind, no changes to `keyTerrain.ts` or `mobilityWorker.ts`) keeps
 * this additive and low-risk: every pool worker is spawned from the exact
 * same module the single shared worker already uses, and the only new
 * logic here is (a) how many workers to spawn, (b) how to split
 * `candidates` across them, and (c) how to re-merge each worker's own
 * independently-ranked chunk back into one globally-ranked result.
 *
 * WHY RE-RANKING ON THE MAIN THREAD IS REQUIRED, NOT OPTIONAL:
 * `scoreKeyTerrainCandidates` sorts by `impactScore` and assigns
 * `rank: 1..N` INTERNALLY, over whatever candidate slice it was given
 * (keyTerrain.ts). A worker scoring only its own chunk therefore produces a
 * rank that is only correct WITHIN that chunk — chunk 2's "rank 1" is not
 * globally rank 1 if chunk 1 contained a higher-impact candidate. Every
 * pool response's own `rank` is discarded here; only `comparison`/
 * `impactScore`/`decisiveCandidate` survive the merge, and rank is
 * reassigned ONCE, globally, after every chunk has returned — cheap (at
 * most `MAX_CANDIDATES_EVALUATED` items to sort), and the only way the
 * final order matches what a single non-pooled call would have produced.
 *
 * WHY PRE-SLICING TO `MAX_CANDIDATES_EVALUATED` BEFORE CHUNKING IS REQUIRED:
 * `scoreKeyTerrainCandidates` applies that same cap independently, INSIDE
 * each worker, to whatever slice it receives. Splitting the FULL candidate
 * list across N workers without pre-slicing would let each worker
 * independently evaluate up to `MAX_CANDIDATES_EVALUATED` of ITS OWN chunk
 * — up to `poolSize × MAX_CANDIDATES_EVALUATED` candidates evaluated in
 * total, silently blowing past the one bound `keyTerrain.ts`'s own header
 * justifies ("each evaluation is a real search"). Pre-slicing here keeps
 * the total evaluated count identical to a single non-pooled call.
 */

import {
  MobilityGridCell, LocalProjection, RoadSpeedOverrides, CorridorField, KeyTerrainCandidate, KeyTerrainResult,
  ScoredKeyTerrainCandidate, MAX_CANDIDATES_EVALUATED, KEY_TERRAIN_MISSION_CAVEAT, EVALUATION_ROUTE_COUNT,
} from '@firebreak/terrain';
import { MobilityWorkerRequest, MobilityWorkerResponse } from './mobilityWorker';

/** Never spawn more pool workers than there are candidates to score (a
 *  worker with an empty chunk is pure overhead), and cap well below
 *  `navigator.hardwareConcurrency` on a high-core-count machine — each
 *  worker gets its OWN structured-clone copy of the full `cells` array
 *  (tens of thousands of objects at `fine` fidelity), so pool size trades
 *  parallelism against real memory duplication, not just CPU contention. */
const MAX_POOL_WORKERS = 4;

interface PoolSlot {
  worker: Worker;
  pending: Map<number, (response: MobilityWorkerResponse) => void>;
}

let pool: PoolSlot[] = [];
let nextPoolRequestId = 1;

function ensurePoolSize(n: number): PoolSlot[] {
  while (pool.length < n) {
    const worker = new Worker(new URL('./mobilityWorker.ts', import.meta.url), { type: 'module' });
    const pending = new Map<number, (response: MobilityWorkerResponse) => void>();
    worker.onmessage = (e: MessageEvent<MobilityWorkerResponse>) => {
      // Progress messages are possible in principle (the 'keyTerrain'
      // branch doesn't emit them today, per mobilityWorker.ts's own
      // header — "No progress reporting, same simplicity call
      // 'keyTerrain' already made") but are deliberately ignored here
      // rather than assumed absent, so this pool stays correct if that
      // ever changes: only a terminal response (anything but 'progress')
      // resolves a pending request.
      if (e.data.kind === 'progress') return;
      const resolve = pending.get(e.data.requestId);
      if (!resolve) return;
      pending.delete(e.data.requestId);
      resolve(e.data);
    };
    pool.push({ worker, pending });
  }
  return pool.slice(0, n);
}

function requestFromSlot(slot: PoolSlot, request: MobilityWorkerRequest): Promise<MobilityWorkerResponse> {
  return new Promise(resolve => {
    slot.pending.set(request.requestId, resolve);
    slot.worker.postMessage(request);
  });
}

/** Split `items` into `n` contiguous, order-preserving chunks (the last
 *  chunk absorbs any remainder) — contiguous rather than round-robin
 *  because nothing downstream cares about interleaving, and contiguous
 *  chunks are trivial to reason about when re-merging. Exported for direct
 *  testing (no Worker needed) — this repo's established pattern for pure
 *  logic embedded in an otherwise Worker-coupled module, see
 *  `cellIndex.ts`/`movementSimulation.ts`'s own `buildTransitCells`. */
export function chunkCandidates<T>(items: T[], n: number): T[][] {
  if (n <= 0) return items.length > 0 ? [items] : [];
  const size = Math.ceil(items.length / n);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Merge each worker's own independently-ranked `KeyTerrainResult` chunk
 *  into ONE globally-ranked result — see this module's header for why
 *  re-ranking is required, not optional (a chunk-local rank is only
 *  correct within that chunk). Pure, Worker-free — the actual correctness
 *  surface of this module, exported for direct testing. `originalCandidateCount`
 *  is the FULL pre-cap candidate count the caller started with (not any
 *  chunk's own size, not the post-cap `evaluated.length`) — see the
 *  `candidatesConsidered` field's own doc comment on `KeyTerrainResult`. */
export function mergeKeyTerrainChunks(
  chunkResults: (KeyTerrainResult | null)[],
  originalCandidateCount: number
): KeyTerrainResult | null {
  const merged: Omit<ScoredKeyTerrainCandidate, 'rank'>[] = [];
  for (const result of chunkResults) {
    if (!result) continue;
    for (const c of result.candidates) {
      const { rank: _rank, ...withoutRank } = c;
      merged.push(withoutRank);
    }
  }
  if (merged.length === 0) return null;

  // Same two operations `scoreKeyTerrainCandidates` itself does at the end
  // of a non-pooled call (keyTerrain.ts) — this merge must track that
  // function if it ever changes its own ranking rule.
  const ranked: ScoredKeyTerrainCandidate[] = merged
    .sort((a, b) => b.impactScore - a.impactScore)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return {
    candidates: ranked,
    candidatesConsidered: originalCandidateCount,
    evaluationRouteCount: EVALUATION_ROUTE_COUNT,
    missionCaveat: KEY_TERRAIN_MISSION_CAVEAT,
  };
}

/** Pooled equivalent of `runKeyTerrainScoringInWorker` (`mobilityWorkerClient.ts`)
 *  — same inputs, same `KeyTerrainResult | null` shape, but fans candidates
 *  out across up to `MAX_POOL_WORKERS` worker instances instead of running
 *  them sequentially on the single shared worker. Falls back to a single
 *  request (no pool overhead) when there's nothing to gain from splitting —
 *  zero/one candidate, or a pool size that would resolve to 1 anyway. */
export async function runKeyTerrainScoringPooled(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  baselineField: CorridorField,
  candidates: KeyTerrainCandidate[],
  roadSpeedOverrides?: RoadSpeedOverrides
): Promise<KeyTerrainResult | null> {
  // See this module's header — the cap must be applied HERE, once, before
  // any chunking, not left for each chunk's own worker-side call to apply
  // independently.
  const evaluated = candidates.slice(0, MAX_CANDIDATES_EVALUATED);
  const poolSize = Math.max(1, Math.min(MAX_POOL_WORKERS, navigator.hardwareConcurrency || 4, evaluated.length));

  if (poolSize <= 1) {
    const slot = ensurePoolSize(1)[0];
    const requestId = nextPoolRequestId++;
    const response = await requestFromSlot(slot, {
      kind: 'keyTerrain', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      baselineField, candidates: evaluated, roadSpeedOverrides,
    });
    return response.kind === 'keyTerrain' ? response.result : null;
  }

  const slots = ensurePoolSize(poolSize);
  const chunks = chunkCandidates(evaluated, poolSize).filter(c => c.length > 0);
  const responses = await Promise.all(chunks.map((candidateChunk, i) => {
    const requestId = nextPoolRequestId++;
    return requestFromSlot(slots[i], {
      kind: 'keyTerrain', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      baselineField, candidates: candidateChunk, roadSpeedOverrides,
    });
  }));

  return mergeKeyTerrainChunks(
    responses.map(r => (r.kind === 'keyTerrain' ? r.result : null)),
    candidates.length
  );
}
