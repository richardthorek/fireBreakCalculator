import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getVegetationTableClient } from '../data/tableClient';

async function vegetationMappingDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const id = req.params.id;
  if (!id) {
    return { status: 400, jsonBody: { error: 'Missing required parameter: id' } };
  }

  try {
    const client = getVegetationTableClient();
    await client.deleteEntity('VegetationMapping', id);
    
    return { status: 204 }; // No content
  } catch (err: any) {
    ctx.error('Delete failed', err);
    if (err.statusCode === 404) {
      return { status: 404, jsonBody: { error: 'Vegetation mapping not found' } };
    }
    return { status: 500, jsonBody: { error: 'Failed to delete vegetation mapping', details: err.message } };
  }
}

app.http('vegetationMappingDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'vegetation-mapping/{id}',
  handler: vegetationMappingDelete
});
