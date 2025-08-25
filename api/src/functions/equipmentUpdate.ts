import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { fromTableEntity, toTableEntity, nextVersion, timestamp } from '../models/equipment';

async function equipmentUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const type = req.params.type;
  const id = req.params.id;
  if (!type || !id) return { status: 400, jsonBody: { error: 'type and id required' } };
  try {
    const client = getEquipmentTableClient();
    const existing = await client.getEntity<any>(type, id);
    const current = fromTableEntity(existing as any);
  const patch: any = await req.json();
  if (patch && patch.version != null && patch.version !== current.version) {
      return { status: 409, jsonBody: { error: 'Version mismatch', currentVersion: current.version } };
    }
  const updated: any = { ...current, ...(patch || {}), version: nextVersion(current.version), updatedAt: timestamp() };
    const entity = toTableEntity(updated as any);
    await client.updateEntity(entity, 'Replace');
    return { status: 200, jsonBody: updated };
  } catch (err: any) {
    ctx.error('Update failed', err);
    if (err.statusCode === 404) return { status: 404, jsonBody: { error: 'Not found' } };
    return { status: 500, jsonBody: { error: 'Failed to update', details: err.message } };
  }
}

app.http('equipmentUpdate', {
  methods: ['PUT','PATCH'],
  authLevel: 'anonymous',
  route: 'equipment/{type}/{id}',
  handler: equipmentUpdate
});
