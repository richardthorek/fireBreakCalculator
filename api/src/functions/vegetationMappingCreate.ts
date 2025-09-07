import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getVegetationTableClient } from '../data/tableClient';
import { VegetationFormationMapping, toTableEntity } from '../models/vegetationMapping';
import { VegetationType } from '../models/equipment';

// Type for incoming request body
interface VegetationMappingRequest {
  id?: string;
  formationName: string;
  className?: string;
  typeName?: string;
  vegetationType: VegetationType;
  description?: string;
  isOverride?: boolean;
}

async function vegetationMappingCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const requestBody = await req.json() as VegetationMappingRequest;
    
    // Validate required fields
    if (!requestBody.formationName || !requestBody.vegetationType) {
      return { status: 400, jsonBody: { error: 'Missing required fields: formationName and vegetationType are required' } };
    }

    const now = new Date().toISOString();
    // Generate a more unique ID based on the hierarchy
    const idBase = requestBody.formationName.replace(/\s+/g, '-').toLowerCase();
    const classNamePart = requestBody.className ? `-${requestBody.className.replace(/\s+/g, '-').toLowerCase()}` : '';
    const typeNamePart = requestBody.typeName ? `-${requestBody.typeName.replace(/\s+/g, '-').toLowerCase()}` : '';
    const id = requestBody.id || `${idBase}${classNamePart}${typeNamePart}`;
    
    const newMapping: VegetationFormationMapping = {
      id,
      formationName: requestBody.formationName,
      className: requestBody.className || undefined,
      typeName: requestBody.typeName || undefined,
      vegetationType: requestBody.vegetationType,
      description: requestBody.description || undefined,
      isOverride: requestBody.isOverride || false,
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    const client = getVegetationTableClient();
    const tableEntity = toTableEntity(newMapping);
    await client.createEntity(tableEntity);
    
    return { status: 201, jsonBody: newMapping };
  } catch (err: any) {
    ctx.error('Create failed', err);
    if (err.message && err.message.includes('EntityAlreadyExists')) {
      return { status: 409, jsonBody: { error: 'A vegetation mapping with this ID already exists' } };
    }
    return { status: 500, jsonBody: { error: 'Failed to create vegetation mapping', details: err.message } };
  }
}

app.http('vegetationMappingCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'vegetation-mapping',
  handler: vegetationMappingCreate
});
