/**
 * Append-only artefact blobs for a tier-2 mobility job (OCOKA 5,
 * docs/ROUTE_INTELLIGENCE.md §47.3) — `mobilityjobs/{jobId}/{seq}-{kind}.json`
 * for client-facing artefacts, `mobilityjobs/{jobId}/internal/{name}.json`
 * for data threaded BETWEEN orchestrator activities (the full sampled grid,
 * the route, etc.) that must never round-trip through Durable's own
 * activity-input/output serialisation — see mobilityJobOrchestrator.ts's own
 * header for why ("pass a blob URI, never the cell array", generalised here
 * from §47.4's viewshed row to every stage boundary).
 *
 * SAS refinement vs the §47.3 design text: the design says one job-scoped
 * SAS is issued at submit time covering the whole job's result prefix. This
 * storage account is not HNS-enabled (no ADLS Gen2 directory-scoped SAS
 * available), so a real prefix-scoped SAS isn't possible — the only
 * container-level SAS Azure offers here would also grant read access to
 * every OTHER job's artefacts, a real cross-job leak. Instead: a fresh,
 * read-only, single-blob SAS is minted per artefact on every status poll
 * (mobilityJobStatus.ts), each scoped to exactly the blob it names. Slightly
 * more work per poll, genuinely job-scoped (tighter than the design text
 * even asked for) rather than merely job-NAMED.
 *
 * Same storage account as `/api` (additive, not a new resource) — same
 * `TABLES_CONNECTION_STRING` env var vegetationTileService.ts already uses
 * for its own blob container.
 */

import { BlobServiceClient, ContainerClient, BlobSASPermissions, StorageSharedKeyCredential } from '@azure/storage-blob';
import { MobilityJobArtefactKind, MobilityJobArtefactPointer } from '../types/mobilityJob';

const CONTAINER = process.env.MOBILITY_JOBS_CONTAINER || 'mobilityjobs';
/** How long a per-artefact read SAS stays valid — generous relative to the
 *  client's own polling interval (mobilityJobClient.ts), short relative to
 *  the 24h blob lifecycle rule. */
const SAS_TTL_MINUTES = 15;

let containerPromise: Promise<ContainerClient | null> | null = null;

function getServiceClient(): BlobServiceClient | null {
  const conn = process.env.TABLES_CONNECTION_STRING;
  if (!conn) return null;
  return BlobServiceClient.fromConnectionString(conn);
}

/** Container client from the existing storage connection string; null when
 *  storage isn't configured (local dev without Azurite) — callers then
 *  degrade rather than throw (mirrors vegetationTileService.ts). */
function getContainer(): Promise<ContainerClient | null> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const svc = getServiceClient();
      if (!svc) return null;
      try {
        const container = svc.getContainerClient(CONTAINER);
        await container.createIfNotExists();
        return container;
      } catch {
        containerPromise = null; // retry next request
        return null;
      }
    })();
  }
  return containerPromise;
}

function artefactBlobPath(jobId: string, seq: number, kind: MobilityJobArtefactKind): string {
  return `${jobId}/${seq}-${kind}.json`;
}

function internalBlobPath(jobId: string, name: string): string {
  return `${jobId}/internal/${name}.json`;
}

/** Writes a client-facing artefact chunk. Throws if storage isn't
 *  configured — unlike the vegetation tile cache, this is not an
 *  accelerator-only path: a tier-2 job with no durable artefact store has
 *  nothing to deliver, so the orchestrator should fail the job rather than
 *  silently proceed. */
export async function writeArtefact(
  jobId: string,
  seq: number,
  kind: MobilityJobArtefactKind,
  data: unknown
): Promise<MobilityJobArtefactPointer> {
  const container = await getContainer();
  if (!container) throw new Error('mobility job storage is not configured (TABLES_CONNECTION_STRING unset)');
  const blobPath = artefactBlobPath(jobId, seq, kind);
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  await container.getBlockBlobClient(blobPath).uploadData(body, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
  return { seq, kind, blobPath };
}

/** Writes internal continuation data for the NEXT activity to read — never
 *  returned to the client, no SAS ever generated for these paths. */
export async function writeInternalBlob(jobId: string, name: string, data: unknown): Promise<string> {
  const container = await getContainer();
  if (!container) throw new Error('mobility job storage is not configured (TABLES_CONNECTION_STRING unset)');
  const blobPath = internalBlobPath(jobId, name);
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  await container.getBlockBlobClient(blobPath).uploadData(body, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
  return blobPath;
}

/** Reads back internal continuation data written by a prior activity. */
export async function readInternalBlob<T>(blobPath: string): Promise<T> {
  const container = await getContainer();
  if (!container) throw new Error('mobility job storage is not configured (TABLES_CONNECTION_STRING unset)');
  const buf = await container.getBlockBlobClient(blobPath).downloadToBuffer();
  return JSON.parse(buf.toString('utf-8')) as T;
}

/**
 * Fresh, read-only, single-blob SAS for a client-facing artefact — minted
 * per poll (see module header for why). Returns null when storage isn't
 * configured or the credential isn't a shared key (e.g. a managed-identity
 * connection with no account key available), so the caller can fall back to
 * an un-signed blob path the client can't actually fetch — better an absent
 * `url` than a broken one.
 */
export async function generateArtefactReadUrl(blobPath: string): Promise<string | null> {
  const container = await getContainer();
  if (!container) return null;
  const credential = container.credential;
  if (!(credential instanceof StorageSharedKeyCredential)) return null;
  const blob = container.getBlockBlobClient(blobPath);
  try {
    return await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + SAS_TTL_MINUTES * 60_000),
    });
  } catch {
    return null;
  }
}

/** Reset memoised container (tests). @internal */
export function _resetMobilityJobStore(): void {
  containerPromise = null;
}
