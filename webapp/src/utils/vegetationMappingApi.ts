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

// List all vegetation formation mappings
export async function listVegetationMappings(): Promise<VegetationFormationMappingApi[]> {
  const res = await fetch(`${baseUrl}/vegetation-mapping`);
  return handle<VegetationFormationMappingApi[]>(res);
}

// Create a new vegetation formation mapping
export async function createVegetationMapping(input: CreateVegetationMappingInput): Promise<VegetationFormationMappingApi> {
  const res = await fetch(`${baseUrl}/vegetation-mapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return handle<VegetationFormationMappingApi>(res);
}

// Update an existing vegetation formation mapping
export async function updateVegetationMapping(
  id: string, 
  payload: Partial<VegetationFormationMappingApi> & { version: number }
): Promise<VegetationFormationMappingApi> {
  const res = await fetch(`${baseUrl}/vegetation-mapping/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handle<VegetationFormationMappingApi>(res);
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
  const res = await fetch(`${baseUrl}/vegetation-mapping/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    let detail: any = null; try { detail = await res.json(); } catch {}
    throw new Error(detail?.error || res.statusText);
  }
}
