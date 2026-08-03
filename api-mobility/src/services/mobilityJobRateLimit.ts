/**
 * Table-Storage-backed rate limiting + concurrent-job cap for the mobility
 * job submit endpoint (OCOKA 5, docs/ROUTE_INTELLIGENCE.md §47.3's own
 * "Security gap to close": `/api/rateLimit.ts`'s in-memory per-instance
 * buckets under-enforce on a scaled-out plan — Flex Consumption scales this
 * app out under load in exactly the way the SWA-managed Consumption plan's
 * existing limiter was never built to survive).
 *
 * A tier-2 job is a genuinely expensive unit of work (a full Durable
 * orchestration doing real network fetches + a multi-source Dijkstra), so
 * this endpoint needs TWO independent gates, not just a per-window request
 * count:
 *  - A fixed-window submit-rate limiter, same shape as `enforceRateLimit`.
 *  - A concurrent-job cap per caller: refuses `429` outright rather than
 *    queueing (§47.3's explicit requirement) — queueing would just move the
 *    wallet-drain problem from "too many requests" to "too many jobs
 *    running at once", which costs real Flex Consumption compute-seconds
 *    either way.
 *
 * Both live in ONE table (`mobilityjobratelimit`) under distinct
 * PartitionKey prefixes, distinguished below. No atomic increment in Table
 * Storage, so this is optimistic-concurrency read-modify-write with a
 * single retry on an ETag conflict — same "best-effort, fails open on any
 * internal error" philosophy as `/api/rateLimit.ts` (a limiter bug must
 * never be the thing that takes the endpoint down).
 */

import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { RestError } from '@azure/data-tables';
import { getMobilityJobRateLimitTableClient } from '../data/tableClient';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const WINDOW_SEC = () => intFromEnv('MOBILITY_JOB_RATE_LIMIT_WINDOW_SEC', 300);
const SUBMIT_LIMIT = () => intFromEnv('MOBILITY_JOB_RATE_LIMIT_PER_WINDOW', 5);
const CONCURRENT_JOB_CAP = () => intFromEnv('MOBILITY_JOB_CONCURRENT_CAP', 1);
/** A "running" job entry older than this is treated as stale (the
 *  completion callback that should have removed it never ran — a crashed
 *  orchestration host, a missed activity) rather than counted against the
 *  cap forever. Generous relative to any real run's expected duration. */
const RUNNING_JOB_STALE_MS = 30 * 60_000;

/** Best-effort client IP for keying — duplicated from `/api/rateLimit.ts`'s
 *  identical helper (api-mobility is a standalone package until the OCOKA 5
 *  cutover merges it into `/api`, see README.md). */
export function getClientIp(req: HttpRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0].trim();
    return first.replace(/:\d+$/, '') || 'unknown';
  }
  return req.headers.get('x-client-ip')?.trim() || 'unknown';
}

interface RateWindowEntity {
  partitionKey: string;
  rowKey: string;
  count: number;
  windowEndMs: number;
  etag?: string;
}

/** Fixed-window check + increment, Table-Storage-backed. */
async function hitRateLimit(routeTag: string, clientIp: string, limit: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const table = getMobilityJobRateLimitTableClient();
  const partitionKey = `rl:${routeTag}`;
  const rowKey = clientIp;
  const now = Date.now();
  const windowMs = WINDOW_SEC() * 1000;

  for (let attempt = 0; attempt < 2; attempt++) {
    let existing: RateWindowEntity | null = null;
    try {
      existing = (await table.getEntity(partitionKey, rowKey)) as unknown as RateWindowEntity;
    } catch (err) {
      if (!(err instanceof RestError) || err.statusCode !== 404) throw err;
    }

    if (!existing || existing.windowEndMs <= now) {
      const fresh: RateWindowEntity = { partitionKey, rowKey, count: 1, windowEndMs: now + windowMs };
      await table.upsertEntity(fresh, 'Replace');
      return { allowed: true, retryAfterSec: Math.ceil(windowMs / 1000) };
    }

    const retryAfterSec = Math.max(1, Math.ceil((existing.windowEndMs - now) / 1000));
    if (existing.count >= limit) {
      return { allowed: false, retryAfterSec };
    }
    try {
      await table.updateEntity(
        { partitionKey, rowKey, count: existing.count + 1, windowEndMs: existing.windowEndMs },
        'Merge',
        { etag: existing.etag }
      );
      return { allowed: true, retryAfterSec };
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 412 && attempt === 0) continue; // concurrent writer — retry once
      throw err;
    }
  }
  return { allowed: true, retryAfterSec: 1 }; // exhausted retries — fail open
}

/** Marks a job as running against its caller's concurrency cap. Called by
 *  mobilityJobSubmit.ts right after `client.startNew`. Best-effort: a
 *  failure here must not fail the submit that already started real work. */
export async function recordJobStarted(clientIp: string, jobId: string): Promise<void> {
  try {
    const table = getMobilityJobRateLimitTableClient();
    await table.upsertEntity(
      { partitionKey: `job:${clientIp}`, rowKey: jobId, startedAtMs: Date.now() },
      'Replace'
    );
  } catch {
    // Best-effort — worst case this job doesn't count against the cap.
  }
}

/** Removes a job's concurrency-cap entry. Called from the orchestrator's
 *  final activity (both the success and failure paths) — see
 *  mobilityJobOrchestrator.ts. Best-effort for the same reason as above. */
export async function recordJobFinished(clientIp: string, jobId: string): Promise<void> {
  try {
    const table = getMobilityJobRateLimitTableClient();
    await table.deleteEntity(`job:${clientIp}`, jobId);
  } catch {
    // Already gone, or never recorded (storage misconfigured) — fine either way.
  }
}

async function countRunningJobs(clientIp: string): Promise<number> {
  const table = getMobilityJobRateLimitTableClient();
  const now = Date.now();
  let count = 0;
  const iter = table.listEntities<{ startedAtMs: number }>({
    queryOptions: { filter: `PartitionKey eq 'job:${clientIp}'` },
  });
  for await (const entity of iter) {
    if (now - (entity.startedAtMs ?? 0) < RUNNING_JOB_STALE_MS) count++;
  }
  return count;
}

/**
 * Guard for `mobilityJobSubmit.ts`. Returns a `429` response to send back
 * when either gate trips, or `{ clientIp }` to proceed (the caller needs
 * `clientIp` again for `recordJobStarted` once the orchestration exists).
 * Never throws — an internal limiter error fails OPEN, same rule as
 * `/api/rateLimit.ts`, since a limiter bug must not be able to take a
 * public endpoint down.
 */
export async function enforceMobilityJobRateLimit(
  req: HttpRequest,
  ctx: InvocationContext
): Promise<HttpResponseInit | { clientIp: string }> {
  const clientIp = getClientIp(req);
  try {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return { clientIp };

    const running = await countRunningJobs(clientIp);
    if (running >= CONCURRENT_JOB_CAP()) {
      ctx.warn('Mobility job concurrency cap reached', { clientIp, running });
      return {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          error: `Only ${CONCURRENT_JOB_CAP()} tier-2 job(s) may run at once per caller. Wait for the current job to finish before starting another.`,
        },
      };
    }

    const decision = await hitRateLimit('mobility-job-submit', clientIp, SUBMIT_LIMIT());
    if (!decision.allowed) {
      ctx.warn('Mobility job submit rate limit exceeded', { clientIp });
      return {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(decision.retryAfterSec) },
        jsonBody: { error: 'Rate limit reached for backend job submission. Wait a moment and try again.', retryAfterSec: decision.retryAfterSec },
      };
    }
    return { clientIp };
  } catch (err) {
    ctx.warn('Mobility job rate limiter error — failing open', err);
    return { clientIp };
  }
}
