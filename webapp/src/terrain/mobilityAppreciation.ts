/**
 * Top-level orchestration for one "terrain appreciation" run: sample the
 * grid, run the multi-source search in a worker, bucket into isochrones.
 * Emits real, computed log lines as it goes — every line corresponds to an
 * actual number from this run, never decorative theatre (docs §13.2).
 */

import { MobilityAoi, buildMobilityGrid } from './mobilityGrid';
import { runMobilitySearchInWorker } from './mobilityWorkerClient';
import { MobilityCellResult, IsochroneBand, buildIsochroneBands, DEFAULT_ISOCHRONE_MINUTES } from './accumulatedCost';
import { getMoverProfile, MoverProfile } from './moverProfiles';
import { SimPathNode } from './mobilityWorker';

export interface MobilityAppreciationResult {
  results: MobilityCellResult[];
  bands: IsochroneBand[];
  profile: MoverProfile;
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  cellCount: number;
  reachableCount: number;
  noGoCount: number;
  slowGoCount: number;
  /** The single cheapest origin→objective path this run found — what the
   *  unit-simulation animation follows (docs "Terrain Mobility &
   *  Counter-Mobility": null only if no objective cell was reachable). */
  path: SimPathNode[] | null;
}

export interface MobilityAppreciationOptions {
  profileId: string;
  nightMode?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
}

export async function runMobilityAppreciation(
  origin: MobilityAoi,
  objective: MobilityAoi,
  options: MobilityAppreciationOptions
): Promise<MobilityAppreciationResult | null> {
  const { profileId, nightMode = false, signal, onProgress, onLog } = options;
  const profile = getMoverProfile(profileId);
  if (!profile) {
    onLog?.(`ERROR — unknown mover profile "${profileId}"`);
    return null;
  }

  onLog?.(`PROFILE ${profile.label.toUpperCase()} · ${profile.confidence.toUpperCase()} CONFIDENCE (${profile.source.slice(0, 72)}${profile.source.length > 72 ? '…' : ''})`);
  onLog?.('LAYING OUT SURVEY GRID OVER AREA OF INTEREST…');

  const grid = await buildMobilityGrid(origin, objective, {
    signal,
    onProgress: f => onProgress?.(f * 0.7),
  });
  if (!grid || signal?.aborted) {
    if (grid === null) onLog?.('AOI TOO SMALL OR DEGENERATE — ABORTED');
    return null;
  }

  onLog?.(`SAMPLING ${grid.cells.length} CELLS · ORIGIN SEED SET ${grid.originKeys.length} CELLS`);
  if (grid.usedEstimatedData) onLog?.('CAUTION — ONE OR MORE SAMPLES ARE ESTIMATED/FALLBACK DATA (TIER 0)');
  if (!grid.infrastructureAvailable) onLog?.('TRAIL DATA UNAVAILABLE FOR THIS AREA — ROUTING ON TERRAIN + FUEL ONLY');

  onProgress?.(0.72);
  onLog?.(`RUNNING MULTI-SOURCE SEARCH — ${profile.label.toUpperCase()}${nightMode ? ' · NIGHT' : ''}…`);

  const { results, path } = await runMobilitySearchInWorker(
    grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode
  );
  if (signal?.aborted) return null;
  onProgress?.(0.95);

  const bands = buildIsochroneBands(results, DEFAULT_ISOCHRONE_MINUTES);
  const reachableCount = results.filter(r => isFinite(r.timeSeconds)).length;
  const noGoCount = results.filter(r => r.trafficability === 'NO-GO').length;
  const slowGoCount = results.filter(r => r.trafficability === 'SLOW-GO').length;

  const fastestBand = bands.find(b => b.cells.length > 0);
  if (fastestBand) {
    onLog?.(`FIRST ARRIVALS WITHIN ${fastestBand.thresholdMinutes} MIN — ${fastestBand.cells.length} CELLS`);
  }
  onLog?.(`RESULT — ${reachableCount}/${grid.cells.length} CELLS REACHABLE · ${noGoCount} NO-GO · ${slowGoCount} SLOW-GO`);
  if (path) {
    const etaMin = path[path.length - 1].cumulativeSeconds / 60;
    onLog?.(`ROUTE FOUND — ${path.length} WAYPOINTS · ETA ${etaMin.toFixed(0)} MIN`);
  } else {
    onLog?.('NO ROUTE FOUND — OBJECTIVE UNREACHABLE FOR THIS PROFILE');
  }
  onProgress?.(1);

  return {
    results,
    bands,
    profile,
    usedEstimatedData: grid.usedEstimatedData,
    infrastructureAvailable: grid.infrastructureAvailable,
    cellCount: grid.cells.length,
    reachableCount,
    noGoCount,
    slowGoCount,
    path,
  };
}
