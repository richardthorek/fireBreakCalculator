/**
 * Idempotent seeding of the standard equipment catalogue into Azure Table
 * Storage.
 *
 * WHY: without any equipment in the table the calculator has nothing to
 * estimate against and returns no results. Rather than depend on an operator
 * remembering to run a seed script, the API seeds a built-in, well-sourced
 * catalogue automatically the first time the table is read (or analysis is run)
 * and it is empty. Users can then add/edit/delete their own equipment.
 */

import { TableClient } from '@azure/data-tables';
import { buildStandardEquipment } from './standardEquipment';
import { toTableEntity } from '../models/equipment';

/** Minimal logger shape (Azure InvocationContext satisfies this). */
interface SeedLogger {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/** True if the equipment table currently has at least one row. */
async function hasAnyEquipment(client: TableClient): Promise<boolean> {
  const iter = client.listEntities<Record<string, unknown>>().byPage({ maxPageSize: 1 });
  for await (const page of iter) {
    if (page.length > 0) return true;
    break; // only need the first page
  }
  return false;
}

/**
 * Write every standard catalogue item, tolerating rows that already exist so
 * repeated calls never fail or duplicate. `mode`:
 *  - 'create': skip rows that already exist (preserves any local edits).
 *  - 'upsert': overwrite existing standard rows (used by force-seed).
 */
async function writeStandards(
  client: TableClient,
  mode: 'create' | 'upsert',
  logger?: SeedLogger
): Promise<number> {
  const items = buildStandardEquipment();
  let written = 0;
  for (const item of items) {
    const entity = toTableEntity(item);
    try {
      if (mode === 'upsert') {
        await client.upsertEntity(entity, 'Replace');
      } else {
        await client.createEntity(entity);
      }
      written++;
    } catch (err: any) {
      // 409 Conflict => row already exists in 'create' mode: expected, skip.
      if (mode === 'create' && (err?.statusCode === 409 || err?.statusCode === 412)) {
        continue;
      }
      logger?.warn?.('Failed to seed standard equipment item', item.id, err?.message ?? err);
    }
  }
  return written;
}

/**
 * Ensure the standard catalogue exists. Seeds only when the table is empty, so
 * it never resurrects equipment a user has intentionally deleted once they have
 * their own catalogue. Best-effort: seeding errors are logged, not thrown, so a
 * transient storage issue never breaks the list/analysis request that triggered
 * it. Returns the number of rows written (0 if already populated).
 */
export async function ensureStandardEquipmentSeeded(
  client: TableClient,
  logger?: SeedLogger
): Promise<number> {
  try {
    if (await hasAnyEquipment(client)) return 0;
    const written = await writeStandards(client, 'create', logger);
    if (written > 0) logger?.log?.(`Seeded ${written} standard equipment items`);
    return written;
  } catch (err: any) {
    logger?.warn?.('ensureStandardEquipmentSeeded failed', err?.message ?? err);
    return 0;
  }
}

/**
 * Force (re)seed the full standard catalogue, overwriting existing standard
 * rows. Used by the explicit seed endpoint for ops/recovery.
 */
export async function forceSeedStandardEquipment(
  client: TableClient,
  logger?: SeedLogger
): Promise<number> {
  return writeStandards(client, 'upsert', logger);
}
