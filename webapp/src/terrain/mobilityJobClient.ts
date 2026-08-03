/**
 * Polling client for a submitted tier-2 mobility job (OCOKA 5,
 * docs/ROUTE_INTELLIGENCE.md §47.3). Deliberately does NOT rely on
 * Durable's own default polling cadence (30s — three times slower than the
 * ~10s update contract §47.5 sets) — this drives its own interval and its
 * own resumability: it tracks the highest artefact `seq` already delivered
 * and only fetches artefacts newer than that, so a dropped connection
 * resumes from where it left off rather than re-fetching everything or
 * losing progress (mirrors the client Worker's own session-retention
 * pattern, §35).
 */

import {
  MobilityJobRequest, MobilityJobStatusResponse, MobilityJobArtefact, submitMobilityJob, fetchMobilityJobStatus,
} from '../utils/mobilityJobApi';

const DEFAULT_POLL_INTERVAL_MS = 3000;
/** Consecutive failed polls (network error, non-2xx) tolerated before the
 *  session gives up and reports an error — a single blip must not abort a
 *  multi-minute job. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export interface MobilityJobSessionCallbacks {
  /** Called once per NEW artefact, in seq order, as it's discovered — never
   *  re-called for an artefact already delivered this session. */
  onArtefact: (artefact: MobilityJobArtefact) => void;
  /** Called on every status response, including ones with no new artefact —
   *  drives a progress/phase indicator. */
  onStatus?: (status: MobilityJobStatusResponse) => void;
  onComplete?: (status: MobilityJobStatusResponse) => void;
  onError?: (message: string) => void;
}

export interface MobilityJobSession {
  jobId: string;
  /** Stops polling. Safe to call more than once. */
  cancel: () => void;
}

/**
 * Submits a job and starts polling it. Resolves once the job is SUBMITTED
 * (not once it completes) — completion/artefacts arrive via the callbacks.
 * Throws if submission itself fails (see `submitMobilityJob`'s own doc
 * comment on why that path doesn't degrade gracefully).
 */
export async function startMobilityJobSession(
  request: MobilityJobRequest,
  callbacks: MobilityJobSessionCallbacks,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<MobilityJobSession> {
  const { jobId, statusUrl } = await submitMobilityJob(request);

  let cancelled = false;
  let highestSeqDelivered = -1;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll() {
    if (cancelled) return;
    const status = await fetchMobilityJobStatus(statusUrl);
    if (!status) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        callbacks.onError?.('Lost contact with the backend job — giving up after repeated failed polls.');
        return;
      }
      timer = setTimeout(poll, pollIntervalMs);
      return;
    }
    consecutiveFailures = 0;
    callbacks.onStatus?.(status);

    for (const artefact of status.artefacts) {
      if (artefact.seq <= highestSeqDelivered) continue;
      callbacks.onArtefact(artefact);
      highestSeqDelivered = Math.max(highestSeqDelivered, artefact.seq);
    }

    if (status.phase === 'complete') {
      callbacks.onComplete?.(status);
      return;
    }
    if (status.phase === 'failed') {
      callbacks.onError?.(status.error ?? 'Backend job failed');
      return;
    }
    if (!cancelled) timer = setTimeout(poll, pollIntervalMs);
  }

  timer = setTimeout(poll, pollIntervalMs);

  return {
    jobId,
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Fetches one artefact's JSON body directly from its (already SAS'd) blob
 *  URL — never through this app's own API, matching §47.3's "read direct
 *  from Blob" design. */
export async function fetchArtefactBody<T>(artefact: MobilityJobArtefact): Promise<T | null> {
  try {
    const resp = await fetch(artefact.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
