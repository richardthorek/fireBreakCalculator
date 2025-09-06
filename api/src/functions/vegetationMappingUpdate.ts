import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getVegetationTableClient } from '../data/tableClient';
import { VegetationFormationMapping, fromTableEntity, toTableEntity } from '../models/vegetationMapping';
import { VegetationType } from '../models/equipment';

// Type for incoming update request body
interface VegetationMappingUpdateRequest {
  formationName?: string;
  className?: string;
  typeName?: string;
  vegetationType?: VegetationType;
  description?: string;
  isOverride?: boolean;
  active?: boolean;
  version: number;
}

async function vegetationMappingUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const id = req.params.id;
  if (!id) {
    return { status: 400, jsonBody: { error: 'Missing required parameter: id' } };
  }

  try {
    const requestBody = await req.json() as VegetationMappingUpdateRequest;
    
    // Version is required for optimistic concurrency
    if (requestBody.version === undefined) {
      return { status: 400, jsonBody: { error: 'Missing required field: version' } };
    }

    // Get the existing entity
    const client = getVegetationTableClient();
    const existingResult = await client.getEntity('VegetationMapping', id);
    const existingMapping = fromTableEntity({ ...(existingResult as any), partitionKey: existingResult.partitionKey, rowKey: existingResult.rowKey });

    // Apply updates
    const updatedMapping: VegetationFormationMapping = {
      ...existingMapping,
      formationName: requestBody.formationName ?? existingMapping.formationName,
      className: requestBody.className ?? existingMapping.className,
      typeName: requestBody.typeName ?? existingMapping.typeName,
      vegetationType: requestBody.vegetationType ?? existingMapping.vegetationType,
      description: requestBody.description ?? existingMapping.description,
      isOverride: requestBody.isOverride ?? existingMapping.isOverride,
      active: requestBody.active ?? existingMapping.active,
      version: existingMapping.version + 1,
      updatedAt: new Date().toISOString()
    };

    // Update with optimistic concurrency
    const tableEntity = toTableEntity(updatedMapping);
    await client.updateEntity(tableEntity, "Replace", existingResult._etag);

    return { status: 200, jsonBody: updatedMapping };
  } catch (err: any) {
    ctx.error('Update failed', err);
    if (err.statusCode === 404) {
      return { status: 404, jsonBody: { error: 'Vegetation mapping not found' } };
    } else if (err.statusCode === 412) {
      return { status: 412, jsonBody: { error: 'Vegetation mapping was modified by another process' } };
    }
    return { status: 500, jsonBody: { error: 'Failed to update vegetation mapping', details: err.message } };
  }
}

app.http('vegetationMappingUpdate', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'vegetation-mapping/{id}',
  handler: vegetationMappingUpdate
});
