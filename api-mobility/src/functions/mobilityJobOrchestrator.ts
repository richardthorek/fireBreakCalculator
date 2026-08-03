/**
 * Durable orchestrator + sequential stage activities for a tier-2 mobility
 * job (OCOKA 5, docs/ROUTE_INTELLIGENCE.md §47.3/§47.4). Deliberately
 * NO FAN-OUT — that's OCOKA 8's job once tier-2 has real usage evidence
 * behind it (§38's own gate: "no automatic tier-2/tier-3 routing should
 * ship" until telemetry justifies it, and the roadmap's own OCOKA 5 row:
 * "Ships before parallelism deliberately — a wrong partial-result rule is a
 * safety bug, a slow correct run is only slow"). Every activity call below
 * is `yield`ed in sequence.
 *
 * Heavy data (the sampled grid, the corridor field) is threaded between
 * activities via BLOB POINTERS, never as the Durable activity input/output
 * itself — generalised from §47.4's viewshed row ("pass a blob URI, never
 * the cell array — Durable serialises activity inputs") to every stage
 * boundary here, since Durable round-trips every activity's input/output
 * through its Task Hub storage regardless of size.
 *
 * v1 algorithmic scope (all recorded, not silent): the optimiser's cheapest
 * route + corridors (from `optimiser-routes` evidence, not the simulated-
 * mover ensemble) + hex chokepoints/min-cut + UNSCORED key-terrain
 * candidates. Not yet ported to tier-2: the movement ensemble, the
 * restriction planner, observation/viewshed, concealment, the road-network-
 * exact min-cut, and key-terrain SCORING (which needs re-running corridor
 * comparisons per candidate — real work, deferred rather than rushed). The
 * client Worker (tier 1) remains the only path for all of those today.
 */

import * as df from 'durable-functions';
import { OrchestrationContext, OrchestrationHandler, ActivityHandler } from 'durable-functions';
// Relative import, not the `@firebreak/terrain` bare specifier — see
// mobilityGridServer.ts's identical note.
import {
  getMoverProfile, MoverProfile, MobilityGridCell, LocalProjection,
  runAccumulatedCostSearch, assembleMobilityResults, extractPath,
  buildCorridorField, DissimilarRoute, Corridor,
  computeChokepoints, ChokepointCell, computeMinCutBarrier, MinCutResult,
  generateKeyTerrainCandidates, KeyTerrainCandidate,
} from '../../../shared/terrain/src/index';
import { MobilityJobRequest, MobilityJobArtefactPointer } from '../types/mobilityJob';
import { buildServerMobilityGrid } from '../services/mobilityGridServer';
import { writeArtefact, writeInternalBlob, readInternalBlob } from '../services/mobilityJobStore';
import { recordJobFinished } from '../services/mobilityJobRateLimit';

export const MOBILITY_ORCHESTRATOR_NAME = 'mobilityJobOrchestrator';

/** All five stage keys, in run order — used to fill `incompleteStages` when
 *  a failure truncates the run partway through. */
const ALL_STAGES = ['sampling', 'routing', 'corridors', 'obstacles', 'key-terrain'] as const;

function resolveProfile(moverProfileId: string): MoverProfile {
  const profile = getMoverProfile(moverProfileId);
  if (!profile) throw new Error(`unknown moverProfileId: ${moverProfileId}`);
  return profile;
}

// ---------------------------------------------------------------------------
// Internal blob shapes (never sent to the client, never returned as a
// Durable activity input/output — only their BLOB PATH is).
// ---------------------------------------------------------------------------

interface GridBlob {
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  originKeys: string[];
  objectiveKeys: string[];
}

interface CorridorBlob {
  routes: DissimilarRoute[];
  corridors: Corridor[];
  unconstrained: boolean;
}

interface ObstaclesBlob {
  chokepoints: ChokepointCell[];
  barrier: MinCutResult | null;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

const sampleGrid: ActivityHandler = async (input: { jobId: string; request: MobilityJobRequest }) => {
  const { jobId, request } = input;
  const grid = await buildServerMobilityGrid(request.originBounds, request.objectiveBounds, request.fidelity);
  const gridBlobPath = await writeInternalBlob(jobId, 'grid', {
    cells: grid.cells, hexSize: grid.hexSize, proj: grid.proj, originKeys: grid.originKeys, objectiveKeys: grid.objectiveKeys,
  } as GridBlob);
  const artefact = await writeArtefact(jobId, 0, 'grid-summary', {
    cellCount: grid.cells.length,
    usedEstimatedData: grid.usedEstimatedData,
    infrastructureAvailable: grid.infrastructureAvailable,
  });
  return { gridBlobPath, artefact };
};

const costAndRoute: ActivityHandler = async (input: { jobId: string; gridBlobPath: string; moverProfileId: string; nightMode: boolean }) => {
  const { jobId, gridBlobPath, moverProfileId, nightMode } = input;
  const profile = resolveProfile(moverProfileId);
  const grid = await readInternalBlob<GridBlob>(gridBlobPath);
  const reach = runAccumulatedCostSearch(grid.cells, grid.originKeys, profile, nightMode);
  const results = assembleMobilityResults(grid.cells, grid.hexSize, grid.proj, reach.best, profile);
  const pathKeys = extractPath(reach, grid.objectiveKeys);
  const byKey = new Map(grid.cells.map((c) => [c.key, c]));
  const cheapestPath = pathKeys
    ? pathKeys.map((key) => {
        const cell = byKey.get(key)!;
        const arrival = reach.best.get(key);
        return { lat: cell.center.lat, lng: cell.center.lng, cumulativeSeconds: arrival ? arrival.timeSeconds : 0 };
      })
    : null;
  const artefact = await writeArtefact(jobId, 1, 'route', {
    reachableCount: results.filter((r) => Number.isFinite(r.timeSeconds)).length,
    totalCells: results.length,
    cheapestPath,
    cheapestTimeSeconds: cheapestPath ? cheapestPath[cheapestPath.length - 1].cumulativeSeconds : null,
  });
  return { artefact };
};

const corridorFieldActivity: ActivityHandler = async (input: { jobId: string; gridBlobPath: string; moverProfileId: string; nightMode: boolean }) => {
  const { jobId, gridBlobPath, moverProfileId, nightMode } = input;
  const profile = resolveProfile(moverProfileId);
  const grid = await readInternalBlob<GridBlob>(gridBlobPath);
  const field = buildCorridorField(grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj);

  const corridorBlobPath = await writeInternalBlob(jobId, 'corridors', {
    routes: field?.routes ?? [],
    corridors: field?.corridors ?? [],
    unconstrained: field?.unconstrained ?? false,
  } as CorridorBlob);

  const artefact = await writeArtefact(jobId, 2, 'corridors', {
    evidence: field?.evidence ?? 'optimiser-routes',
    corridorCount: field?.corridors.length ?? 0,
    cellCount: field?.cellCount ?? 0,
    routedCellCount: field?.routedCellCount ?? 0,
    unconstrained: field?.unconstrained ?? false,
    corridors: (field?.corridors ?? []).map((c) => ({
      rank: c.rank,
      routeCount: c.routeCount,
      medianTravelSeconds: c.medianTravelSeconds,
      bottleneckWidthM: c.bottleneckWidthM,
      bottleneckAbreast: c.bottleneckAbreast,
      frontage: c.frontage,
      unrestrictedFraction: c.unrestrictedFraction,
      easeClass: c.easeClass,
    })),
  });
  return { corridorBlobPath, artefact };
};

const chokepointsAndBarrier: ActivityHandler = async (input: { jobId: string; gridBlobPath: string; corridorBlobPath: string; moverProfileId: string; nightMode: boolean }) => {
  const { jobId, gridBlobPath, corridorBlobPath, moverProfileId, nightMode } = input;
  const profile = resolveProfile(moverProfileId);
  const grid = await readInternalBlob<GridBlob>(gridBlobPath);
  const corridorData = await readInternalBlob<CorridorBlob>(corridorBlobPath);

  const chokepoints = computeChokepoints(grid.cells, grid.hexSize, grid.proj, corridorData.routes).slice(0, 12);
  const barrier = computeMinCutBarrier(grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode);

  const obstaclesBlobPath = await writeInternalBlob(jobId, 'obstacles', { chokepoints, barrier } as ObstaclesBlob);

  const artefact = await writeArtefact(jobId, 3, 'obstacles', {
    chokepointCount: chokepoints.length,
    topChokepoints: chokepoints.map((c) => ({ key: c.key, center: c.center, passCount: c.passCount })),
    barrier: barrier ? { segmentCount: barrier.segments.length, cutValue: barrier.cutValue } : null,
  });
  return { obstaclesBlobPath, artefact };
};

const MAX_KEY_TERRAIN_CANDIDATES = 20;

const keyTerrainActivity: ActivityHandler = async (input: { jobId: string; gridBlobPath: string; corridorBlobPath: string; obstaclesBlobPath: string }) => {
  const { jobId, gridBlobPath, corridorBlobPath, obstaclesBlobPath } = input;
  const grid = await readInternalBlob<GridBlob>(gridBlobPath);
  const corridorData = await readInternalBlob<CorridorBlob>(corridorBlobPath);
  const obstacles = await readInternalBlob<ObstaclesBlob>(obstaclesBlobPath);

  // Unscored candidates only for v1 (see module header) — scoring needs a
  // corridor-comparison re-run per candidate, deferred rather than rushed.
  // `generateKeyTerrainCandidates` only ever reads `corridorField.corridors`
  // (each corridor's own id/rank/bottleneckCellKeys, preserved intact in
  // `CorridorBlob`) — the partial object below is a real, checked substitute
  // for the full `CorridorField`, not a blind cast.
  const partialCorridorField = { corridors: corridorData.corridors } as unknown as Parameters<typeof generateKeyTerrainCandidates>[4];
  const candidates: KeyTerrainCandidate[] = generateKeyTerrainCandidates(
    grid.cells, obstacles.chokepoints, obstacles.barrier, null, partialCorridorField
  ).slice(0, MAX_KEY_TERRAIN_CANDIDATES);

  const artefact = await writeArtefact(jobId, 4, 'key-terrain', {
    candidateCount: candidates.length,
    scored: false,
    candidates: candidates.map((c) => ({ id: c.id, source: c.source, cellKeys: c.cellKeys, center: c.center, provenance: c.provenance })),
  });
  return { artefact };
};

const jobFinished: ActivityHandler = async (input: { clientIp: string; jobId: string }) => {
  await recordJobFinished(input.clientIp, input.jobId);
};

df.app.activity('mobilitySampleGrid', { handler: sampleGrid });
df.app.activity('mobilityCostAndRoute', { handler: costAndRoute });
df.app.activity('mobilityCorridorField', { handler: corridorFieldActivity });
df.app.activity('mobilityChokepointsAndBarrier', { handler: chokepointsAndBarrier });
df.app.activity('mobilityKeyTerrain', { handler: keyTerrainActivity });
df.app.activity('mobilityJobFinished', { handler: jobFinished });

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface OrchestratorInput {
  clientIp: string;
  request: MobilityJobRequest;
}

const orchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  // The orchestration's OWN instance id doubles as the job id — set by
  // `mobilityJobSubmit.ts` via `startNew`'s `instanceId` option, generated
  // there (not here) so the submit response can return it immediately
  // without waiting on the orchestrator's first tick.
  const jobId = context.df.instanceId;
  const { clientIp, request } = context.df.getInput() as OrchestratorInput;
  const startedAt = new Date().toISOString();
  const artefacts: MobilityJobArtefactPointer[] = [];

  function setStatus(phase: 'running' | 'complete' | 'failed', remainingStages: readonly string[], error?: string) {
    context.df.setCustomStatus({
      phase,
      provisional: phase !== 'complete',
      artefacts,
      incompleteStages: remainingStages.length > 0 ? [...remainingStages] : undefined,
      error,
      startedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  setStatus('running', ALL_STAGES);

  let gridBlobPath: string;
  try {
    const out = yield context.df.callActivity('mobilitySampleGrid', { jobId, request });
    gridBlobPath = out.gridBlobPath;
    artefacts.push(out.artefact);
    setStatus('running', ALL_STAGES.slice(1));
  } catch (err: any) {
    setStatus('failed', ALL_STAGES, String(err?.message ?? err));
    yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
    return;
  }

  try {
    const out = yield context.df.callActivity('mobilityCostAndRoute', {
      jobId, gridBlobPath, moverProfileId: request.moverProfileId, nightMode: request.nightMode,
    });
    artefacts.push(out.artefact);
    setStatus('running', ALL_STAGES.slice(2));
  } catch (err: any) {
    setStatus('failed', ALL_STAGES.slice(1), String(err?.message ?? err));
    yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
    return;
  }

  let corridorBlobPath: string;
  try {
    const out = yield context.df.callActivity('mobilityCorridorField', {
      jobId, gridBlobPath, moverProfileId: request.moverProfileId, nightMode: request.nightMode,
    });
    corridorBlobPath = out.corridorBlobPath;
    artefacts.push(out.artefact);
    setStatus('running', ALL_STAGES.slice(3));
  } catch (err: any) {
    setStatus('failed', ALL_STAGES.slice(2), String(err?.message ?? err));
    yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
    return;
  }

  let obstaclesBlobPath: string;
  try {
    const out = yield context.df.callActivity('mobilityChokepointsAndBarrier', {
      jobId, gridBlobPath, corridorBlobPath, moverProfileId: request.moverProfileId, nightMode: request.nightMode,
    });
    obstaclesBlobPath = out.obstaclesBlobPath;
    artefacts.push(out.artefact);
    setStatus('running', ALL_STAGES.slice(4));
  } catch (err: any) {
    setStatus('failed', ALL_STAGES.slice(3), String(err?.message ?? err));
    yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
    return;
  }

  try {
    const out = yield context.df.callActivity('mobilityKeyTerrain', { jobId, gridBlobPath, corridorBlobPath, obstaclesBlobPath });
    artefacts.push(out.artefact);
  } catch (err: any) {
    setStatus('failed', ALL_STAGES.slice(4), String(err?.message ?? err));
    yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
    return;
  }

  setStatus('complete', []);
  yield context.df.callActivity('mobilityJobFinished', { jobId, clientIp });
};

df.app.orchestration(MOBILITY_ORCHESTRATOR_NAME, orchestrator);
