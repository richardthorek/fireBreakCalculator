/**
 * Equipment overrides API client.
 *
 * Cloud persistence for a signed-in user's tuning of the built-in standard
 * equipment catalogue (cost, rate, slope limits, etc.) — available to Station
 * Manager subscribers whose plan grants `fireBreakEnabled`, mirroring
 * `savedPlansApi.ts`. Anonymous customisation stays entirely client-side
 * (`equipmentOverrides.ts`'s sessionStorage store) and never calls this API.
 */

import { EquipmentApi, EquipmentCoreType } from '../types/equipmentApi';

const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

export interface EquipmentOverrideApi {
  userId: string;
  equipmentId: string;
  equipmentType: EquipmentCoreType;
  fields: Partial<EquipmentApi>;
  updatedAt: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: { error?: string } | null = null;
    try {
      detail = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new Error(detail?.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function listEquipmentOverrides(token: string): Promise<EquipmentOverrideApi[]> {
  const res = await fetch(`${baseUrl}/equipment/overrides`, { headers: authHeaders(token) });
  return handle<EquipmentOverrideApi[]>(res);
}

export async function setEquipmentOverride(
  token: string,
  equipmentId: string,
  equipmentType: EquipmentCoreType,
  fields: Partial<EquipmentApi>
): Promise<EquipmentOverrideApi> {
  const res = await fetch(`${baseUrl}/equipment/overrides/${encodeURIComponent(equipmentId)}`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ equipmentType, fields }),
  });
  return handle<EquipmentOverrideApi>(res);
}

export async function deleteEquipmentOverride(token: string, equipmentId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/equipment/overrides/${encodeURIComponent(equipmentId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) {
    let detail: { error?: string } | null = null;
    try {
      detail = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new Error(detail?.error || res.statusText);
  }
}
