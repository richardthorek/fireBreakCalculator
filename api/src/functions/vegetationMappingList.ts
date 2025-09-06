import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getVegetationTableClient } from '../data/tableClient';
import { fromTableEntity } from '../models/vegetationMapping';

async function vegetationMappingList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const client = getVegetationTableClient();
    // List all vegetation mapping entities
    const entities = client.listEntities<any>({ 
      queryOptions: { filter: `PartitionKey eq 'VegetationMapping'` } 
    });
    
    const results: any[] = [];
    for await (const ent of entities) {
      results.push(fromTableEntity({ ...(ent as any), partitionKey: ent.partitionKey, rowKey: ent.rowKey }));
    }
    return { status: 200, jsonBody: results };
  } catch (err: any) {
    ctx.error('List failed', err);
    return { status: 500, jsonBody: { error: 'Failed to list vegetation mappings', details: err.message } };
  }
}

app.http('vegetationMappingList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vegetation-mapping',
  handler: vegetationMappingList
});
