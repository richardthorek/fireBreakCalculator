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

export async function listEquipment(): Promise<EquipmentApi[]> {
  const res = await fetch(`${baseUrl}/equipment`);
  return handle<EquipmentApi[]>(res);
}

export async function createEquipment(input: any /* CreateEquipmentInput */): Promise<EquipmentApi> {
  const res = await fetch(`${baseUrl}/equipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return handle<EquipmentApi>(res);
}

export async function updateEquipment(id: string, type: EquipmentCoreType, payload: Partial<EquipmentApi> & { version: number }): Promise<EquipmentApi> {
  const res = await fetch(`${baseUrl}/equipment/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return handle<EquipmentApi>(res);
}

// Convenience wrapper: accept an EquipmentApi item and forward to updateEquipment
export async function updateEquipmentItem(item: EquipmentApi): Promise<EquipmentApi> {
  const { id, type, version, ...rest } = item as any;
  const payload = { ...rest, version } as any;
  return updateEquipment(id, type, payload);
}

export async function deleteEquipment(type: EquipmentCoreType, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/equipment/${type}/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    let detail: any = null; try { detail = await res.json(); } catch {}
    throw new Error(detail?.error || res.statusText);
  }
}
