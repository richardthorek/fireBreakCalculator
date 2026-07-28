/**
 * Fire-and-forget scale/performance telemetry for Terrain Mobility runs —
 * cell counts, terrain/veg difficulty mix, elapsed time by phase, device
 * hints. Deliberately carries NO location and no user identity: the only
 * question this exists to answer is "how big/hard was this run and how long
 * did it take on this device", to build the evidence base for the
 * cloud-offload threshold decision (docs/ROUTE_INTELLIGENCE.md "Cloud offload
 * for large-area analysis"). A fixed cell-count cutoff can't account for the
 * device spread that motivated this in the first place — a high-end laptop
 * and a mid-range one differ by more than any plausible single threshold —
 * so this collects real runs across real devices instead of guessing.
 *
 * Best-effort by construction: every failure mode (network down, endpoint
 * missing, malformed data) is swallowed here. This must never affect the
 * actual analysis run it's reporting on.
 */

import { MobilityAppreciationResult, MobilityStage } from './mobilityAppreciation';

const SESSION_KEY = 'mobilityTelemetrySessionId';

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (private mode, etc.) — a per-call id is fine,
    // this only affects grouping runs from the same session, not correctness.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** One entry per `onStage` firing, in order — `atMs` is elapsed time since
 *  the run started, matching the clock `handleRunMobilityAppreciation` owns. */
export interface MobilityStageTimestamp {
  key: MobilityStage['key'];
  atMs: number;
}

function stageDurations(stamps: MobilityStageTimestamp[]): Record<string, number> {
  const out: Record<string, number> = {};
  let prevAt = 0;
  for (const s of stamps) {
    out[s.key] = Math.max(0, s.atMs - prevAt);
    prevAt = s.atMs;
  }
  return out;
}

export function recordMobilityRunTelemetry(
  result: MobilityAppreciationResult,
  elapsedMs: number,
  stageTimestamps: MobilityStageTimestamp[],
  distanceM: number | null
): void {
  try {
    const vegetationHistogram: Record<string, number> = {};
    for (const cell of result.cells) {
      vegetationHistogram[cell.vegetation] = (vegetationHistogram[cell.vegetation] ?? 0) + 1;
    }
    const goCount = Math.max(0, result.cellCount - result.noGoCount - result.slowGoCount);

    const nav = navigator as Navigator & { deviceMemory?: number };
    const payload = {
      sessionId: sessionId(),
      timestamp: new Date().toISOString(),
      profileId: result.profile.id,
      fidelity: result.fidelity,
      cellCount: result.cellCount,
      targetCellCount: result.targetCellCount,
      reachableCount: result.reachableCount,
      noGoCount: result.noGoCount,
      slowGoCount: result.slowGoCount,
      goCount,
      distanceM,
      searchAttempts: result.searchAttempts,
      usedExpandedSearch: result.usedExpandedSearch,
      routeFound: result.path !== null,
      elapsedMs,
      stageDurationsMs: stageDurations(stageTimestamps),
      vegetationHistogram,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: nav.deviceMemory ?? null,
    };

    // keepalive lets this survive a navigation immediately after the run;
    // never awaited, never surfaced — see module comment.
    fetch('/api/mobility-telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* best-effort — see module comment */ });
  } catch {
    // best-effort — see module comment
  }
}
