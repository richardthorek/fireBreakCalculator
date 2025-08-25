import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';

async function equipmentDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const type = req.params.type;
  const id = req.params.id;
  if (!type || !id) return { status: 400, jsonBody: { error: 'type and id required' } };
  try {
    const client = getEquipmentTableClient();
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
