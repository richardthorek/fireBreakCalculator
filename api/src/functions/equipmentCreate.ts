import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { Equipment, newEquipmentId, timestamp, initialVersion, toTableEntity, fromTableEntity } from '../models/equipment';

async function equipmentCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
  const body: any = await req.json();
  const type = body?.type as Equipment['type'];
    if (!['Machinery','Aircraft','HandCrew'].includes(type)) {
      return { status: 400, jsonBody: { error: 'Invalid type' } };
    }
    const now = timestamp();
    const id = newEquipmentId();
    const equipment: Equipment = {
      id,
      type,
      name: body.name,
      description: body.description,
      allowedTerrain: Array.isArray(body.allowedTerrain) ? body.allowedTerrain : [],
      allowedVegetation: Array.isArray(body.allowedVegetation) ? body.allowedVegetation : [],
      clearingRate: body.clearingRate,
      costPerHour: body.costPerHour,
      active: body.active ?? true,
      version: initialVersion(),
      createdAt: now,
      updatedAt: now,
      // type specific
      ...(type === 'Machinery' ? { maxSlope: body.maxSlope, cutWidthMeters: body.cutWidthMeters } : {}),
      ...(type === 'Aircraft' ? { dropLength: body.dropLength, turnaroundMinutes: body.turnaroundMinutes, capacityLitres: body.capacityLitres, costPerDrop: body.costPerDrop } : {}),
      ...(type === 'HandCrew' ? { crewSize: body.crewSize, clearingRatePerPerson: body.clearingRatePerPerson, equipmentList: body.equipmentList } : {})
    } as Equipment;
    const entity = toTableEntity(equipment);
    const client = getEquipmentTableClient();
    await client.createEntity(entity);
    return { status: 201, jsonBody: fromTableEntity(entity as any) };
  } catch (err: any) {
    ctx.error('Create failed', err);
    return { status: 500, jsonBody: { error: 'Failed to create equipment', details: err.message } };
  }
}

app.http('equipmentCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'equipment',
  handler: equipmentCreate
});
