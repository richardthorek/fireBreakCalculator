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

/** Not a security token — only a grouping key so a device's own runs can be
 *  told apart in the collected telemetry. Still built from `crypto`, not
 *  `Math.random()`: the Web Crypto API is available everywhere this runs
 *  (browser main thread), so there's no reason to reach for the weaker
 *  generator even where it wouldn't matter. */
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (private mode, etc.) — a per-call id is fine,
    // this only affects grouping runs from the same session, not correctness.
    return randomId();
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
    // The result object's own fields are `severelyRestrictedCount`/`restrictedCount`
    // (OCOKA 1, docs/ROUTE_INTELLIGENCE.md §47) — mapped explicitly to the WIRE
    // names below, which stay `noGoCount`/`slowGoCount`/`goCount` deliberately.
    // This is an existing analytics time series in Table Storage; renaming the
    // wire shape would split the series the OCOKA 5/8 backend-routing threshold
    // depends on.
    const goCount = Math.max(0, result.cellCount - result.severelyRestrictedCount - result.restrictedCount);

    const nav = navigator as Navigator & { deviceMemory?: number };
    const payload = {
      sessionId: sessionId(),
      timestamp: new Date().toISOString(),
      profileId: result.profile.id,
      fidelity: result.fidelity,
      cellCount: result.cellCount,
      targetCellCount: result.targetCellCount,
      reachableCount: result.reachableCount,
      noGoCount: result.severelyRestrictedCount,
      slowGoCount: result.restrictedCount,
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
