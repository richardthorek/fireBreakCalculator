// Persistence for per-user equipment overrides (Azure Table Storage).
// Mirrors savedPlansStore.ts's shape — thin wrapper over the shared table
// client so the HTTP functions stay small.

import { TableClient, RestError } from '@azure/data-tables';
import { getEquipmentOverrideTableClient } from '../data/tableClient';
import { EquipmentOverride, fromTableEntity, toTableEntity } from '../models/equipmentOverride';

let tableEnsured = false;

async function client(): Promise<TableClient> {
  const c = getEquipmentOverrideTableClient();
  if (!tableEnsured) {
    try {
      await c.createTable();
    } catch (err) {
      if (!(err instanceof RestError && err.statusCode === 409)) {
        // fall through — the subsequent operation will report a real failure
      }
    }
    tableEnsured = true;
  }
  return c;
}

export async function listOverridesForUser(userId: string): Promise<EquipmentOverride[]> {
  const c = await client();
  const entities = c.listEntities<Record<string, unknown>>({
    queryOptions: { filter: `PartitionKey eq '${userId.replace(/'/g, "''")}'` },
  });
  const overrides: EquipmentOverride[] = [];
  for await (const ent of entities) {
    overrides.push(fromTableEntity(ent as unknown as Parameters<typeof fromTableEntity>[0]));
  }
  return overrides;
}

export async function upsertOverride(override: EquipmentOverride): Promise<void> {
  const c = await client();
  await c.upsertEntity(toTableEntity(override), 'Replace');
}

/** Delete an override — reverting that item to the platform default. Returns
 * false (not an error) if there was no override to revert. */
export async function deleteOverride(userId: string, equipmentId: string): Promise<boolean> {
  const c = await client();
  try {
    await c.deleteEntity(userId, equipmentId);
    return true;
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return false;
    throw err;
  }
}
