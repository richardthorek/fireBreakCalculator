// Saved fire-break plan domain model and Azure Table Storage mapping helpers.
//
// A saved plan is the same compact, versioned payload the shareable-URL
// feature produces (webapp `utils/planSharing.ts` `encodePlan()` — a
// URL-safe-base64 JSON envelope of coords + break width + vegetation +
// access lines). The API stores it as an opaque string: the webapp already
// hardens decoding against malformed payloads (`decodePlan()`), so the
// server validates shape/size, never content.
//
// Partitioning: PartitionKey = Station Manager user id, RowKey = plan id —
// plans are per-user in v1 (org/brigade-shared plans are a documented
// follow-up in master_plan.md).

export interface SavedPlan {
  id: string; // RowKey
  userId: string; // PartitionKey (SM user id)
  name: string;
  /** URL-safe-base64 plan payload as produced by the webapp's encodePlan(). */
  data: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SavedPlanTableEntity {
  partitionKey: string; // userId
  rowKey: string; // plan id
  name: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_PLAN_NAME_LENGTH = 120;
/** Generous ceiling for the encoded payload — a long multi-line plan with
 * access lines is a few KB; anything near this limit is not a plan. */
export const MAX_PLAN_DATA_LENGTH = 100_000;
/** Per-user plan cap: keeps a single partition (and the list response) small. */
export const MAX_PLANS_PER_USER = 100;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SavedPlanInput {
  name: string;
  data: string;
}

/** Validate an incoming save/update body. Returns an error message or null. */
export function validateSavedPlanInput(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object';
  const { name, data } = body as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) return 'name is required';
  if (name.trim().length > MAX_PLAN_NAME_LENGTH) {
    return `name must be at most ${MAX_PLAN_NAME_LENGTH} characters`;
  }
  if (typeof data !== 'string' || data.length === 0) return 'data is required';
  if (data.length > MAX_PLAN_DATA_LENGTH) return 'data exceeds the maximum plan size';
  if (!BASE64URL_PATTERN.test(data)) return 'data must be a URL-safe base64 plan payload';
  return null;
}

export function toTableEntity(plan: SavedPlan): SavedPlanTableEntity {
  return {
    partitionKey: plan.userId,
    rowKey: plan.id,
    name: plan.name,
    data: plan.data,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function fromTableEntity(entity: {
  partitionKey: string;
  rowKey: string;
  name?: unknown;
  data?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}): SavedPlan {
  return {
    id: entity.rowKey,
    userId: entity.partitionKey,
    name: typeof entity.name === 'string' ? entity.name : '',
    data: typeof entity.data === 'string' ? entity.data : '',
    createdAt: typeof entity.createdAt === 'string' ? entity.createdAt : '',
    updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : '',
  };
}
