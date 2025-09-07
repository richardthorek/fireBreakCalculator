/**
 * Vegetation Mapping API Utility Functions
 * 
 * Provides CRUD operations for vegetation formation mappings used in fire break analysis.
 * Handles communication with the Azure Functions backend API for vegetation mapping data.
 * 
 * @module vegetationMappingApi
 * @version 1.0.0
 */

import { CreateVegetationMappingInput, VegetationFormationMappingApi } from '../types/vegetationMappingApi';

// Use relative /api by default so Vite dev server proxy (configured in vite.config.ts)
// can forward requests to the Functions host and avoid CORS during development.
const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: any = null;
    try { detail = await res.json(); } catch {}
    throw new Error(detail?.error || res.statusText);
  }
  return res.json();
}

// Mock data for development when backend is not available
const mockVegetationMappings: VegetationFormationMappingApi[] = [
  {
    id: '1',
    formationName: 'Rainforest',
    className: 'Subtropical Rainforest',
    typeName: '',
    vegetationType: 'heavyforest',
    isOverride: false,
    confidence: 0.95,
    active: true,
    description: 'Dense tropical rainforest formations',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    formationName: 'Wet Sclerophyll Forest',
    className: '',
    typeName: '',
    vegetationType: 'heavyforest',
    isOverride: false,
    confidence: 0.9,
    active: true,
    description: 'Tall eucalyptus forests with dense understory',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
  },
  {
    id: '3',
    formationName: 'Dry Sclerophyll Forest',
    className: '',
    typeName: '',
    vegetationType: 'mediumscrub',
    isOverride: false,
    confidence: 0.85,
    active: true,
    description: 'Open eucalyptus forests with scattered understory',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
  },
  {
    id: '4',
    formationName: 'Grassland',
    className: 'Native Grassland',
    typeName: '',
    vegetationType: 'grassland',
    isOverride: false,
    confidence: 0.95,
    active: true,
    description: 'Open grassland areas',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
  },
  {
    id: '5',
    formationName: 'Heathland',
    className: '',
    typeName: '',
    vegetationType: 'lightshrub',
    isOverride: false,
    confidence: 0.9,
    active: true,
    description: 'Low shrubland with heathy vegetation',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
  }
];

// Development mode fallback helper
const isDevelopment = import.meta.env.DEV;
async function withFallback<T>(apiCall: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDevelopment) {
    return apiCall();
  }
  
  try {
    return await apiCall();
  } catch (error: any) {
    // If we get a network error or 500 error in development, use fallback
    if (error.message.includes('Internal Server Error') || error.message.includes('Failed to fetch')) {
      console.warn('API not available in development, using mock data:', error.message);
      return fallback;
    }
    throw error;
  }
}

// List all vegetation formation mappings
export async function listVegetationMappings(): Promise<VegetationFormationMappingApi[]> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/vegetation-mapping`);
      return handle<VegetationFormationMappingApi[]>(res);
    },
    mockVegetationMappings
  );
}

// Create a new vegetation formation mapping
export async function createVegetationMapping(input: CreateVegetationMappingInput): Promise<VegetationFormationMappingApi> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/vegetation-mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      return handle<VegetationFormationMappingApi>(res);
    },
    {
      ...input,
      id: Math.random().toString(36).substr(2, 9),
      version: 1,
      active: true,
  confidence: 0.8,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
    } as VegetationFormationMappingApi
  );
}

// Update an existing vegetation formation mapping
export async function updateVegetationMapping(
  id: string, 
  payload: Partial<VegetationFormationMappingApi> & { version: number }
): Promise<VegetationFormationMappingApi> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/vegetation-mapping/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return handle<VegetationFormationMappingApi>(res);
    },
    {
      ...payload,
      id,
  version: payload.version + 1,
  updatedAt: new Date().toISOString()
    } as VegetationFormationMappingApi
  );
}

// Convenience wrapper: accept a VegetationFormationMappingApi item and forward to updateVegetationMapping
export async function updateVegetationMappingItem(
  item: VegetationFormationMappingApi
): Promise<VegetationFormationMappingApi> {
  const { id, version, ...rest } = item;
  const payload = { ...rest, version } as any;
  return updateVegetationMapping(id, payload);
}

// Delete a vegetation formation mapping
export async function deleteVegetationMapping(id: string): Promise<void> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/vegetation-mapping/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        let detail: any = null; try { detail = await res.json(); } catch {}
        throw new Error(detail?.error || res.statusText);
      }
    },
    undefined as void
  );
}
