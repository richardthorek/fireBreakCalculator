import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getEquipmentTableClient } from '../data/tableClient';
import { fromTableEntity, Equipment, Machinery, Aircraft, HandCrew } from '../models/equipment';
import { EquipmentAnalysisService, AnalysisRequest, EquipmentSpec } from '../services/equipmentAnalysis';
import { TerrainLevel, VegetationType } from '../types/common';

// Type validation helpers
function isValidTerrainLevel(value: string): value is TerrainLevel {
  return ['easy', 'moderate', 'difficult', 'extreme'].includes(value);
}

function isValidVegetationType(value: string): value is VegetationType {
  return ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'].includes(value);
}

function safeParseTerrainArray(value: string[]): TerrainLevel[] {
  return value.filter(isValidTerrainLevel);
}

function safeParseVegetationArray(value: string[]): VegetationType[] {
  return value.filter(isValidVegetationType);
}

async function analysisCalculate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    // Parse request body
    let requestData: AnalysisRequest;
    try {
      const body = await req.text();
      requestData = JSON.parse(body);
    } catch (parseError) {
      ctx.error('Failed to parse request body', parseError);
      return {
        status: 400,
        jsonBody: { error: 'Invalid request body - must be valid JSON' }
      };
    }

    // Validate required fields
    if (!requestData.distance || requestData.distance <= 0) {
      return {
        status: 400,
        jsonBody: { error: 'Distance must be a positive number' }
      };
    }

    if (!requestData.trackAnalysis) {
      return {
        status: 400,
        jsonBody: { error: 'Track analysis is required' }
      };
    }

    if (!requestData.vegetationAnalysis) {
      return {
        status: 400,
        jsonBody: { error: 'Vegetation analysis is required' }
      };
    }

    ctx.log('Starting equipment analysis calculation', {
      distance: requestData.distance,
      maxSlope: requestData.trackAnalysis.maxSlope,
      vegetation: requestData.vegetationAnalysis.predominantVegetation
    });

    // Load equipment from storage
    const client = getEquipmentTableClient();
    const entities = client.listEntities<any>();
    const equipmentList: EquipmentSpec[] = [];

    for await (const entity of entities) {
      try {
        const equipment = fromTableEntity({ 
          ...entity, 
          partitionKey: entity.partitionKey, 
          rowKey: entity.rowKey 
        });

        // Convert to analysis format with proper type safety
        const allowedTerrain = safeParseTerrainArray(equipment.allowedTerrain);
        const allowedVegetation = safeParseVegetationArray(equipment.allowedVegetation);

        const spec: EquipmentSpec = {
          id: equipment.id,
          name: equipment.name,
          type: equipment.type,
          allowedTerrain,
          allowedVegetation,
          clearingRate: equipment.clearingRate,
          costPerHour: equipment.costPerHour,
          description: equipment.description
        };

        // Add type-specific properties
        if (equipment.type === 'Machinery') {
          const machinery = equipment as Machinery;
          spec.maxSlope = machinery.maxSlope;
        } else if (equipment.type === 'Aircraft') {
          const aircraft = equipment as Aircraft;
          spec.dropLength = aircraft.dropLength;
          spec.turnaroundMinutes = aircraft.turnaroundMinutes;
        } else if (equipment.type === 'HandCrew') {
          const handCrew = equipment as HandCrew;
          spec.crewSize = handCrew.crewSize;
          spec.clearingRatePerPerson = handCrew.clearingRatePerPerson;
        }

        equipmentList.push(spec);
      } catch (equipmentError) {
        ctx.warn('Failed to process equipment entity', { 
          entity: entity.rowKey, 
          error: equipmentError 
        });
      }
    }

    ctx.log(`Loaded ${equipmentList.length} equipment items for analysis`);

    // Perform analysis
    const analysisService = new EquipmentAnalysisService();
    const result = await analysisService.analyzeEquipment(requestData, equipmentList);

    ctx.log('Analysis completed', {
      calculationsCount: result.calculations.length,
      compatibleCount: result.calculations.filter(c => c.compatible).length,
      validationErrors: result.metadata.validationErrors.length
    });

    return {
      status: 200,
      jsonBody: result,
      headers: {
        'Content-Type': 'application/json'
      }
    };

  } catch (error: any) {
    ctx.error('Analysis calculation failed', error);
    return {
      status: 500,
      jsonBody: {
        error: 'Failed to calculate equipment analysis',
        details: error.message
      }
    };
  }
}

app.http('analysisCalculate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'analysis/calculate',
  handler: analysisCalculate
});
