import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { fromTableEntity } from '../models/equipment';
import { ensureStandardEquipmentSeeded } from '../data/seedStandardEquipment';

async function equipmentList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const type = (req.query.get('type') || '').trim();
  try {
    const client = getEquipmentTableClient();
    // Seed the built-in standard catalogue on first use so the calculator always
    // has equipment to estimate against. No-op once the table is populated.
    await ensureStandardEquipmentSeeded(client, ctx);
    // If type provided, filter by PartitionKey; otherwise list all entities
    const entities = type
      ? client.listEntities<any>({ queryOptions: { filter: `PartitionKey eq '${type}'` } })
      : client.listEntities<any>();
    const results: any[] = [];
    for await (const ent of entities) {
      results.push(fromTableEntity({ ...(ent as any), partitionKey: ent.partitionKey, rowKey: ent.rowKey }));
    }
    return { status: 200, jsonBody: results };
  } catch (err: any) {
    ctx.error('List failed', err);
    return { status: 500, jsonBody: { error: 'Failed to list equipment', details: err.message } };
  }
}

app.http('equipmentList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'equipment',
  handler: equipmentList
});
