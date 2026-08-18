import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { fromTableEntity } from '../models/equipment';

async function equipmentDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const type = req.params.type;
  const id = req.params.id;
  if (!type || !id) return { status: 400, jsonBody: { error: 'type and id required' } };
  try {
    const client = getEquipmentTableClient();
    // Standard catalogue rows are shared platform defaults — deleting one
    // would remove it for every user. It can be hidden per-user via an
    // override's `active: false`, but never removed from the table directly.
    const existing = await client.getEntity<any>(type, id);
    if (fromTableEntity(existing as any).standard) {
      return {
        status: 409,
        jsonBody: {
          error: 'This is a built-in standard catalogue item and cannot be deleted. Set it inactive via an equipment override instead.',
          standard: true,
        },
      };
    }
    await client.deleteEntity(type, id);
    return { status: 204 };
  } catch (err: any) {
    ctx.error('Delete failed', err);
    if (err.statusCode === 404) return { status: 404, jsonBody: { error: 'Not found' } };
    return { status: 500, jsonBody: { error: 'Failed to delete', details: err.message } };
  }
}

app.http('equipmentDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'equipment/{type}/{id}',
  handler: equipmentDelete
});
