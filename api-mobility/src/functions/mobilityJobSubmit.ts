/**
 * `POST /api/mobility/jobs` — starts a tier-2 mobility job (OCOKA 5,
 * docs/ROUTE_INTELLIGENCE.md §47.3). Returns `202 {jobId, statusUrl}`
 * immediately; the orchestrator runs asynchronously and the client polls
 * `mobilityJobStatus.ts` on its own interval (§47.3: "do not rely on
 * Durable's default 30s polling cadence").
 *
 * Deliberately does NOT use `client.createCheckStatusResponse` — that
 * returns Durable's OWN management URLs (`statusQueryGetUri`,
 * `terminatePostUri`, …), which would leak internal orchestration plumbing
 * to a public, anonymous caller. The only URL a client gets is this app's
 * own `/api/mobility/jobs/{jobId}` status route.
 */

import { randomUUID } from 'node:crypto';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { isMobilityJobRequest } from '../types/mobilityJob';
import { enforceMobilityJobRateLimit, recordJobStarted } from '../services/mobilityJobRateLimit';
import { MOBILITY_ORCHESTRATOR_NAME } from './mobilityJobOrchestrator';

export async function mobilityJobSubmit(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const rateResult = await enforceMobilityJobRateLimit(req, ctx);
  if (!('clientIp' in rateResult)) return rateResult;
  const { clientIp } = rateResult;

  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
  }
  if (!isMobilityJobRequest(body)) {
    return { status: 400, jsonBody: { error: 'Request body must match MobilityJobRequest' } };
  }

  const client = df.getClient(ctx);
  const jobId = randomUUID();
  await client.startNew(MOBILITY_ORCHESTRATOR_NAME, { input: { clientIp, request: body }, instanceId: jobId });
  await recordJobStarted(clientIp, jobId);

  ctx.log('Started mobility job', { jobId });
  return {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: {
      jobId,
      statusUrl: `/api/mobility/jobs/${jobId}`,
    },
  };
}

app.http('mobilityJobSubmit', {
  methods: ['POST'],
  route: 'mobility/jobs',
  authLevel: 'anonymous',
  extraInputs: [df.input.durableClient()],
  handler: mobilityJobSubmit,
});
