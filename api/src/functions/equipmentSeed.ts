import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { fromTableEntity } from '../models/equipment';
import { ensureStandardEquipmentSeeded, forceSeedStandardEquipment } from '../data/seedStandardEquipment';

/**
 * Seed the built-in standard equipment catalogue.
 *
 * POST /api/equipment/seed            -> seed only if the table is empty (safe).
 * POST /api/equipment/seed?force=true -> overwrite existing standard rows.
 *
 * Returns the current full equipment list so callers can confirm the result.
 */
async function equipmentSeed(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const force = (req.query.get('force') || '').toLowerCase() === 'true';
  try {
    const client = getEquipmentTableClient();
    const written = force
      ? await forceSeedStandardEquipment(client, ctx)
      : await ensureStandardEquipmentSeeded(client, ctx);

    const results: any[] = [];
    for await (const ent of client.listEntities<any>()) {
      results.push(fromTableEntity({ ...(ent as any), partitionKey: ent.partitionKey, rowKey: ent.rowKey }));
    }
    return { status: 200, jsonBody: { seeded: written, force, count: results.length, equipment: results } };
  } catch (err: any) {
    ctx.error('Seed failed', err);
    return { status: 500, jsonBody: { error: 'Failed to seed standard equipment', details: err.message } };
  }
}

app.http('equipmentSeed', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'equipment/seed',
  handler: equipmentSeed,
});
