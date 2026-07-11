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
import { STANDARD_EQUIPMENT } from '../config/standardEquipment';

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

// Fallback catalogue: the built-in standard equipment (mirrors the backend
// catalogue the API seeds). Used when the backend is unavailable or returns an
// empty list, so the UI is never blank and estimates can always be produced.
const mockEquipment: EquipmentApi[] = STANDARD_EQUIPMENT;

// Development mode fallback helper
const isDevelopment = import.meta.env.DEV;
async function withFallback<T>(apiCall: () => Promise<T>, fallback: T): Promise<T> {
  if (!isDevelopment) {
    return apiCall();
  }

  try {
    return await apiCall();
  } catch (error: any) {
    // In development, use fallback for any API error
    // This ensures the app works even when backend is completely unavailable
    console.warn('API call failed in development, using fallback data:', error.message);
    return fallback;
  }
}

export async function listEquipment(): Promise<EquipmentApi[]> {
  return withFallback(
    async () => {
      const res = await fetch(`${baseUrl}/equipment`);
      const data = await handle<EquipmentApi[]>(res);

      // If the backend returns an empty list, fall back to the built-in standard
      // catalogue so the equipment lists and estimates are never blank. The
      // backend also seeds these on first use, so the two converge on refresh.
      if (!data || data.length === 0) {
        console.warn('Backend returned empty equipment list, using standard catalogue');
        return STANDARD_EQUIPMENT;
      }

      return data;
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
