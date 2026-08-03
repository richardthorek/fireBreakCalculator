/**
 * `GET /api/mobility/jobs/{jobId}` — tier-2 job status (OCOKA 5,
 * docs/ROUTE_INTELLIGENCE.md §47.3). Returns POINTERS, never data (Durable
 * custom status is capped at 16 KB UTF-16) — and never Durable's own
 * `DurableOrchestrationStatus` internals (`runtimeStatus`, instance history,
 * management URLs). Every artefact pointer gets a freshly-minted, read-only,
 * single-blob SAS on THIS poll (`mobilityJobStore.ts`'s own doc comment on
 * why a single submit-time SAS isn't used here).
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';
import { MobilityJobStatusDocument, MobilityJobStatusResponse, MobilityJobArtefact } from '../types/mobilityJob';
import { generateArtefactReadUrl } from '../services/mobilityJobStore';

function isStatusDocument(v: any): v is MobilityJobStatusDocument {
  return !!(v && typeof v.phase === 'string' && typeof v.provisional === 'boolean' && Array.isArray(v.artefacts));
}

export async function mobilityJobStatus(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const jobId = req.params.jobId;
  if (!jobId) return { status: 400, jsonBody: { error: 'jobId is required' } };

  const client = df.getClient(ctx);
  const status = await client.getStatus(jobId);
  if (!status) return { status: 404, jsonBody: { error: 'No job found for this id' } };

  const now = new Date().toISOString();
  let doc: MobilityJobStatusDocument;
  if (isStatusDocument(status.customStatus)) {
    doc = status.customStatus;
  } else if (status.runtimeStatus === 'Failed' || status.runtimeStatus === 'Terminated') {
    // A crash before the orchestrator's own try/catch could set custom
    // status (extremely early failure) — still report failed, never silent.
    doc = { phase: 'failed', provisional: true, artefacts: [], error: 'Orchestration failed before reporting status', startedAt: now, updatedAt: now };
  } else if (status.runtimeStatus === 'Completed') {
    // Should not happen — the orchestrator's last action before returning is
    // always setCustomStatus({phase: 'complete', ...}). Defensive only: never
    // claim complete without the orchestrator's own confirmation.
    doc = { phase: 'failed', provisional: true, artefacts: [], error: 'Orchestration completed without a final status document', startedAt: now, updatedAt: now };
  } else {
    doc = { phase: 'running', provisional: true, artefacts: [], startedAt: now, updatedAt: now };
  }

  const artefacts: MobilityJobArtefact[] = await Promise.all(
    doc.artefacts.map(async (pointer) => ({
      ...pointer,
      url: (await generateArtefactReadUrl(pointer.blobPath)) ?? '',
    }))
  );

  const response: MobilityJobStatusResponse = { ...doc, jobId, artefacts };
  return { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: response };
}

app.http('mobilityJobStatus', {
  methods: ['GET'],
  route: 'mobility/jobs/{jobId}',
  authLevel: 'anonymous',
  extraInputs: [df.input.durableClient()],
  handler: mobilityJobStatus,
});
