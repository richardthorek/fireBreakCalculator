/**
 * Backend Analysis API Client
 * 
 * Utility functions for calling the backend equipment analysis service.
 * This provides an alternative to the frontend-based calculations.
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

// Temporary diagnostic flag to enable stack-trace logging when backend calls are made.
// Set to true only when troubleshooting; keep false in normal dev runs.
const DIAGNOSTIC_STACK_TRACES = false;

export interface BackendAnalysisRequest {
  distance: number;
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis;
  parameters?: {
    terrainFactors?: Record<string, number>;
    vegetationFactors?: Record<string, number>;
  };
}

export interface BackendCalculationResult {
  id: string;
  name: string;
  type: 'Machinery' | 'Aircraft' | 'HandCrew';
  time: number;
  cost: number;
  compatible: boolean;
  compatibilityLevel: 'full' | 'partial' | 'incompatible';
  unit: string;
  description?: string;
  slopeCompatible?: boolean;
  maxSlopeExceeded?: number;
  drops?: number;
  overLimitPercent?: number;
  note?: string;
  validationErrors?: string[];
}

export interface BackendAnalysisResponse {
  calculations: BackendCalculationResult[];
  metadata: {
    timestamp: string;
    equipmentCount: number;
    validationErrors: string[];
    analysisParameters: {
      effectiveTerrain: string;
      effectiveVegetation: string;
      terrainFactor: number;
      vegetationFactor: number;
    };
  };
}

/**
 * Call the backend analysis service
 */
export async function calculateEquipmentAnalysis(
  request: BackendAnalysisRequest
): Promise<BackendAnalysisResponse> {
  console.log('🔄 Calling backend analysis service', {
    distance: request.distance,
    maxSlope: request.trackAnalysis?.maxSlope,
    vegetation: request.vegetationAnalysis?.predominantVegetation
  });

  if (DIAGNOSTIC_STACK_TRACES) {
    // Capture a short stack so we can see who invoked the backend call
    const stack = new Error('stack').stack?.split('\n').slice(1, 6).map(s => s.trim());
    console.debug('Diagnostic: backendAnalysis.call stack (truncated)', stack);
  }

  const response = await fetch(`${baseUrl}/analysis/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('❌ Backend analysis failed', {
      status: response.status,
      statusText: response.statusText,
      error: errorData
    });
    throw new Error(errorData.error || `Analysis request failed: ${response.statusText}`);
  }

  const result = await response.json();
  
  console.log('✅ Backend analysis completed', {
    calculationsCount: result.calculations?.length || 0,
    compatibleCount: result.calculations?.filter((c: BackendCalculationResult) => c.compatible)?.length || 0,
    validationErrors: result.metadata?.validationErrors?.length || 0,
    analysisParameters: result.metadata?.analysisParameters
  });

  return result;
}

/**
 * Test if the backend analysis service is available
 */
export async function testBackendAnalysis(): Promise<boolean> {
  try {
    // Simple test request with minimal data
    const testRequest: BackendAnalysisRequest = {
      distance: 1000,
      trackAnalysis: {
        totalDistance: 1000,
        maxSlope: 15,
        averageSlope: 8,
        segments: [],
        slopeDistribution: { flat: 800, medium: 200, steep: 0, very_steep: 0 }
      },
      vegetationAnalysis: {
        totalDistance: 1000,
        predominantVegetation: 'grassland',
        segments: [],
        vegetationDistribution: { grassland: 1000, lightshrub: 0, mediumscrub: 0, heavyforest: 0 },
        overallConfidence: 0.95
      }
    };

    if (DIAGNOSTIC_STACK_TRACES) {
      const stack = new Error('stack').stack?.split('\n').slice(1, 6).map(s => s.trim());
      console.debug('Diagnostic: testBackendAnalysis invoking calculateEquipmentAnalysis stack (truncated)', stack);
    }
    await calculateEquipmentAnalysis(testRequest);
    console.log('✅ Backend analysis service is available');
    return true;
  } catch (error) {
    console.warn('⚠️ Backend analysis service is not available:', error);
    return false;
  }
}

/**
 * Convert frontend calculation result to match backend format
 * This helps maintain compatibility while migrating
 */
export interface FrontendCalculationResult {
  id: string;
  name: string;
  type: string;
  time: number;
  cost: number;
  compatible: boolean;
  compatibilityLevel?: string;
  unit?: string;
  description?: string;
  slopeCompatible?: boolean;
  maxSlopeExceeded?: boolean;
  drops?: number;
  overLimitPercent?: number;
  note?: string;
}

export function convertToBackendFormat(
  frontendResult: FrontendCalculationResult
): BackendCalculationResult {
  // Normalize type to backend expected literals
  const t = (frontendResult.type || '').toString().toLowerCase();
  let mappedType: BackendCalculationResult['type'] = 'Machinery';
  if (t === 'aircraft' || t === 'air plane' || t === 'plane') mappedType = 'Aircraft';
  else if (t === 'handcrew' || t === 'hand_crew' || t === 'hand crew' || t === 'handcrew' ) mappedType = 'HandCrew';

  // Normalize compatibility level
  const cl = (frontendResult.compatibilityLevel || '').toString().toLowerCase();
  let mappedCompatibility: BackendCalculationResult['compatibilityLevel'] = frontendResult.compatible ? 'full' : 'incompatible';
  if (cl === 'full' || cl === 'partial' || cl === 'incompatible') mappedCompatibility = cl as BackendCalculationResult['compatibilityLevel'];

  // Ensure maxSlopeExceeded is a number when provided (frontend may supply boolean)
  const maxSlopeExceededNum = typeof frontendResult.maxSlopeExceeded === 'number'
    ? frontendResult.maxSlopeExceeded
    : undefined;

  return {
    id: frontendResult.id,
    name: frontendResult.name,
    type: mappedType,
    time: frontendResult.time,
    cost: frontendResult.cost,
    compatible: frontendResult.compatible,
    compatibilityLevel: mappedCompatibility,
    unit: frontendResult.unit || 'hours',
    description: frontendResult.description,
    slopeCompatible: frontendResult.slopeCompatible,
    maxSlopeExceeded: maxSlopeExceededNum,
    drops: frontendResult.drops,
    overLimitPercent: frontendResult.overLimitPercent,
    note: frontendResult.note
  };
}
