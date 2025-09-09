/**
 * Equipment API Utility Functions
 * 
 * Provides CRUD operations for fire break equipment including machinery, aircraft, and hand crews.
 * Handles communication with the Azure Functions backend API for equipment catalogue management.
 * 
 * @module equipmentApi
 * @version 1.0.0
 */

import { CreateEquipmentInput, EquipmentApi, EquipmentCoreType, UpdateEquipmentInput } from '../types/equipmentApi';

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
const mockEquipment: EquipmentApi[] = [
  {
    id: '1',
    type: 'Machinery',
    name: 'Bulldozer D8T',
    clearingRate: 150,
    costPerHour: 400,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    active: true,
    version: 1
  } as any,
  {
    id: '2',
    type: 'Machinery', 
    name: 'Track Loader',
    clearingRate: 80,
    costPerHour: 200,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub'],
    active: true,
    version: 1
  } as any,
  {
    id: '3',
    type: 'Aircraft',
    name: 'Helicopter Bell 214',
    dropLength: 500,
    turnaroundMinutes: 15,
    costPerHour: 3000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    active: true,
    version: 1
  } as any,
  {
    id: '4',
    type: 'HandCrew',
  name: 'Strike Team',
    crewSize: 6,
    clearingRatePerPerson: 15,
    costPerHour: 120,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    active: true,
    version: 1
  } as any
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

export async function listEquipment(): Promise<EquipmentApi[]> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/equipment`);
      return handle<EquipmentApi[]>(res);
    },
    mockEquipment
  );
}

export async function createEquipment(input: any /* CreateEquipmentInput */): Promise<EquipmentApi> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      return handle<EquipmentApi>(res);
    },
    {
      ...input,
      id: Math.random().toString(36).substr(2, 9),
      version: 1,
      active: true
    } as EquipmentApi
  );
}

export async function updateEquipment(id: string, type: EquipmentCoreType, payload: Partial<EquipmentApi> & { version: number }): Promise<EquipmentApi> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/equipment/${type}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return handle<EquipmentApi>(res);
    },
    {
      ...payload,
      id,
      type,
      version: payload.version + 1
    } as EquipmentApi
  );
}

// Convenience wrapper: accept an EquipmentApi item and forward to updateEquipment
export async function updateEquipmentItem(item: EquipmentApi): Promise<EquipmentApi> {
  const { id, type, version, ...rest } = item as any;
  const payload = { ...rest, version } as any;
  return updateEquipment(id, type, payload);
}

export async function deleteEquipment(type: EquipmentCoreType, id: string): Promise<void> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/equipment/${type}/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        let detail: any = null; try { detail = await res.json(); } catch {}
        throw new Error(detail?.error || res.statusText);
      }
    },
    undefined as void
  );
}
