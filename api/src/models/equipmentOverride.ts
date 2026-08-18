// Per-user equipment override domain model and Azure Table Storage mapping.
//
// Signed-in users can tune the built-in standard catalogue's cost/rate/limit
// fields without mutating the shared platform defaults every other user (and
// every anonymous visitor) sees. An override is a small patch keyed by
// (userId, equipmentId); deleting it reverts that item to the platform
// default exactly, since the base row is never touched.
//
// Partitioning mirrors savedPlan.ts: PartitionKey = Station Manager user id,
// RowKey = equipmentId — overrides are per-user, never shared across a team.

import { Equipment } from './equipment';

/** Fields a user may tune. Identity/bookkeeping fields (id, type, standard,
 * version, createdAt/updatedAt) are never overridable — only the figures
 * that feed the estimate and the equipment's stated capability. */
export const OVERRIDABLE_EQUIPMENT_FIELDS = [
  'name',
  'description',
  'allowedTerrain',
  'allowedVegetation',
  'clearingRate',
  'cutWidthMeters',
  'maxSlope',
  'dropLength',
  'turnaroundMinutes',
  'capacityLitres',
  'costPerDrop',
  'crewSize',
  'clearingRatePerPerson',
  'equipmentList',
  'costPerHour',
  'active',
] as const;
export type OverridableEquipmentField = (typeof OVERRIDABLE_EQUIPMENT_FIELDS)[number];

export type EquipmentOverrideFields = Partial<Pick<Equipment, OverridableEquipmentField & keyof Equipment>>;

export interface EquipmentOverride {
  userId: string; // PartitionKey
  equipmentId: string; // RowKey
  equipmentType: Equipment['type'];
  fields: EquipmentOverrideFields;
  updatedAt: string; // ISO
}

export interface EquipmentOverrideTableEntity {
  partitionKey: string; // userId
  rowKey: string; // equipmentId
  equipmentType: string;
  fields: string; // JSON-encoded EquipmentOverrideFields
  updatedAt: string;
}

/** Strip anything outside the whitelist so a caller can't smuggle identity
 * fields (id/type/standard/version) into a "field patch". */
export function sanitizeOverrideFields(input: unknown): EquipmentOverrideFields {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_EQUIPMENT_FIELDS) {
    if (key in (input as Record<string, unknown>)) {
      out[key] = (input as Record<string, unknown>)[key];
    }
  }
  return out as EquipmentOverrideFields;
}

export function toTableEntity(o: EquipmentOverride): EquipmentOverrideTableEntity {
  return {
    partitionKey: o.userId,
    rowKey: o.equipmentId,
    equipmentType: o.equipmentType,
    fields: JSON.stringify(o.fields),
    updatedAt: o.updatedAt,
  };
}

export function fromTableEntity(entity: {
  partitionKey: string;
  rowKey: string;
  equipmentType?: unknown;
  fields?: unknown;
  updatedAt?: unknown;
}): EquipmentOverride {
  let fields: EquipmentOverrideFields = {};
  if (typeof entity.fields === 'string') {
    try {
      fields = JSON.parse(entity.fields);
    } catch {
      fields = {};
    }
  }
  return {
    userId: entity.partitionKey,
    equipmentId: entity.rowKey,
    equipmentType: (typeof entity.equipmentType === 'string' ? entity.equipmentType : 'Machinery') as Equipment['type'],
    fields,
    updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : '',
  };
}
