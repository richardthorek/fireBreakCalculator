// Persistence for saved fire-break plans (Azure Table Storage).
// Thin wrapper over the shared table client so the HTTP functions stay small.

import { TableClient, RestError } from '@azure/data-tables';
import { getSavedPlansTableClient } from '../data/tableClient';
import { SavedPlan, fromTableEntity, toTableEntity } from '../models/savedPlan';

let tableEnsured = false;

async function client(): Promise<TableClient> {
  const c = getSavedPlansTableClient();
  if (!tableEnsured) {
    try {
      await c.createTable();
    } catch (err) {
      // 409 = already exists; anything else surfaces on the first operation.
      if (!(err instanceof RestError && err.statusCode === 409)) {
        // fall through — the subsequent operation will report a real failure
      }
    }
    tableEnsured = true;
  }
  return c;
}

export async function listPlansForUser(userId: string): Promise<SavedPlan[]> {
  const c = await client();
  const entities = c.listEntities<Record<string, unknown>>({
    queryOptions: { filter: `PartitionKey eq '${userId.replace(/'/g, "''")}'` },
  });
  const plans: SavedPlan[] = [];
  for await (const ent of entities) {
    plans.push(
      fromTableEntity(ent as unknown as Parameters<typeof fromTableEntity>[0])
    );
  }
  // Most recently updated first.
  plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return plans;
}

export async function getPlan(userId: string, planId: string): Promise<SavedPlan | null> {
  const c = await client();
  try {
    const ent = await c.getEntity<Record<string, unknown>>(userId, planId);
    return fromTableEntity(ent as unknown as Parameters<typeof fromTableEntity>[0]);
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return null;
    throw err;
  }
}

export async function createPlan(plan: SavedPlan): Promise<void> {
  const c = await client();
  await c.createEntity(toTableEntity(plan));
}

export async function updatePlan(plan: SavedPlan): Promise<void> {
  const c = await client();
  await c.updateEntity(toTableEntity(plan), 'Replace');
}

export async function deletePlan(userId: string, planId: string): Promise<boolean> {
  const c = await client();
  try {
    await c.deleteEntity(userId, planId);
    return true;
  } catch (err) {
    if (err instanceof RestError && err.statusCode === 404) return false;
    throw err;
  }
}
