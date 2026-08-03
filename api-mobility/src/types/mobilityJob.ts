/**
 * `MobilityJobRequest`/status wire shapes for the tier-2 backend job protocol
 * (OCOKA 5, docs/ROUTE_INTELLIGENCE.md §47.3) — the THIRD webapp/api
 * must-match pair (after `MobilityAssistantPayload` and the Overpass query
 * constants/`stitchRings` reassembly — see api/CLAUDE.md). The webapp's copy
 * lives at `webapp/src/utils/mobilityJobApi.ts`; check both when touching
 * either.
 *
 * Deliberate simplification vs the client Worker's own tier-1 path: origin
 * and objective are sent as already-resolved BOUNDING BOXES, not painted
 * dab strokes. `mobilityGrid.ts`'s own `buildMobilityGrid` already falls
 * back to exactly this (nearest-cell-to-bounds-centroid) when a painted
 * area resolves to zero member cells — this job protocol simply always
 * takes that path, rather than re-implementing paint/erase polygon
 * resolution (`paintedArea.ts`, turf boolean ops) a second time server-side.
 * Recorded as a real, deliberate scope cut, not a silent one.
 */

export interface MobilityJobBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export type MobilityJobFidelity = 'quick' | 'standard' | 'fine';

export interface MobilityJobRequest {
  originBounds: MobilityJobBounds;
  objectiveBounds: MobilityJobBounds;
  moverProfileId: string;
  nightMode: boolean;
  fidelity: MobilityJobFidelity;
}

/** One artefact chunk, delivered as its own append-only blob — never the
 *  raw cell/route data itself (that stays server-side, threaded between
 *  activities as an internal blob pointer). "kind" is a stable string the
 *  client switches on to know how to parse/merge the artefact JSON. */
export type MobilityJobArtefactKind =
  | 'grid-summary'
  | 'route'
  | 'corridors'
  | 'obstacles'
  | 'key-terrain';

export interface MobilityJobArtefactPointer {
  seq: number;
  kind: MobilityJobArtefactKind;
  /** Blob path relative to the `mobilityjobs` container, e.g.
   *  `{jobId}/3-corridors.json` — NOT a fetchable URL by itself. The status
   *  endpoint attaches a fresh, short-lived, read-only SAS `url` alongside
   *  this on every poll (see mobilityJobStore.ts's own doc comment on why a
   *  single submit-time SAS isn't used). */
  blobPath: string;
}

/** Artefact pointer as delivered over the wire (status endpoint response) —
 *  `blobPath` plus the live SAS `url` generated for that poll. */
export interface MobilityJobArtefact extends MobilityJobArtefactPointer {
  url: string;
}

export type MobilityJobPhase = 'running' | 'complete' | 'failed';

/** The orchestrator's `context.df.setCustomStatus` payload — Durable caps
 *  custom status at 16 KB UTF-16 (docs §47.3), which is why artefacts are
 *  pointers, never inline data. */
export interface MobilityJobStatusDocument {
  phase: MobilityJobPhase;
  /** Export is disabled and the AI briefing refuses to narrate while this is
   *  true (docs §47.5's partial-result rule) — false only once `phase` is
   *  'complete' AND every expected stage's artefact landed. An abandoned/
   *  failed run stays permanently provisional; there is no later upgrade. */
  provisional: boolean;
  artefacts: MobilityJobArtefactPointer[];
  /** Present once `phase !== 'running'`; stage keys that never produced an
   *  artefact (a crash, or a stage this v1 orchestrator doesn't run yet —
   *  see mobilityJobOrchestrator.ts's own scope note). */
  incompleteStages?: string[];
  error?: string;
  startedAt: string;
  updatedAt: string;
}

/** The status endpoint's actual response shape — `MobilityJobStatusDocument`
 *  with pointers upgraded to fetchable SAS `url`s, plus the id. Never the
 *  raw Durable `DurableOrchestrationStatus` (runtimeStatus/history/instance
 *  internals) — see mobilityJobStatus.ts's own doc comment. */
export interface MobilityJobStatusResponse extends Omit<MobilityJobStatusDocument, 'artefacts'> {
  jobId: string;
  artefacts: MobilityJobArtefact[];
}

function isFiniteNumber(v: any): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBounds(v: any): v is MobilityJobBounds {
  return (
    !!v &&
    isFiniteNumber(v.minLat) && isFiniteNumber(v.minLng) &&
    isFiniteNumber(v.maxLat) && isFiniteNumber(v.maxLng) &&
    v.maxLat > v.minLat && v.maxLng > v.minLng
  );
}

const FIDELITIES: MobilityJobFidelity[] = ['quick', 'standard', 'fine'];

/**
 * Validates an incoming job request — this is a public, anonymous HTTP
 * endpoint (`mobilityJobSubmit.ts`), so the body is untrusted input at a
 * system boundary, same rule as `isMobilityAssistantPayload`.
 */
export function isMobilityJobRequest(v: any): v is MobilityJobRequest {
  return !!(
    v &&
    isBounds(v.originBounds) &&
    isBounds(v.objectiveBounds) &&
    typeof v.moverProfileId === 'string' && v.moverProfileId.length > 0 &&
    typeof v.nightMode === 'boolean' &&
    typeof v.fidelity === 'string' && FIDELITIES.includes(v.fidelity)
  );
}
