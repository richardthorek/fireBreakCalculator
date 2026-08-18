/**
 * Machinery-defaults customisation store.
 *
 * The built-in standard equipment catalogue (`config/standardEquipment.ts`,
 * seeded server-side from `api/src/data/standardEquipment.ts`) is the
 * platform default every user sees. Any user can tune an item's cost/rate/
 * limits for their own use, but that change is scoped so it never mutates
 * the shared default:
 *
 * - **Not signed in:** the change lives only in `sessionStorage` — gone when
 *   the tab closes, never sent to the backend. This is the incentive to sign
 *   up: customisation that survives a reload/return visit requires an
 *   account.
 * - **Signed in (Station Manager, `fireBreakEnabled`):** the change is
 *   persisted per-account via `equipmentOverridesApi.ts` and restored on
 *   every visit, on any device.
 *
 * `OVERRIDABLE_FIELDS` is a must-match pair with
 * `api/src/models/equipmentOverride.ts`'s `OVERRIDABLE_EQUIPMENT_FIELDS` —
 * keep both in lock-step.
 */

import { EquipmentApi } from '../types/equipmentApi';

export const OVERRIDABLE_FIELDS = [
  'name',
  'description',
  'allowedTerrain',
  'allowedVegetation',
  'clearingRate',
  'cutWidthMeters',
  'maxSlope',
  'dropLength',
  'turnaroundMinutes',
  'capacityLitres',
  'costPerDrop',
  'crewSize',
  'clearingRatePerPerson',
  'equipmentList',
  'costPerHour',
  'active',
] as const;
type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export type EquipmentOverrideFields = Partial<Pick<EquipmentApi, OverridableField & keyof EquipmentApi>>;
export type EquipmentOverrideMap = Record<string, EquipmentOverrideFields>;

const SESSION_KEY = 'firebreak_equipment_overrides_session';

/** Strip anything outside the whitelist — mirrors the backend's own guard,
 * so a session-only patch can never carry identity fields (id/type/standard). */
export function sanitizeOverrideFields(input: Record<string, unknown>): EquipmentOverrideFields {
  const out: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_FIELDS) {
    if (key in input) out[key] = input[key];
  }
  return out as EquipmentOverrideFields;
}

/** Diff an edited item against its known base (platform default) value,
 * returning only the fields that actually changed. Used so "Save" on a
 * standard item stores a minimal override patch, not a full clone. */
export function diffFromBase(base: EquipmentApi, edited: EquipmentApi): EquipmentOverrideFields {
  const patch: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_FIELDS) {
    const baseVal = (base as any)[key];
    const editedVal = (edited as any)[key];
    if (JSON.stringify(baseVal) !== JSON.stringify(editedVal)) {
      patch[key] = editedVal;
    }
  }
  return patch as EquipmentOverrideFields;
}

export function applyOverrides(base: EquipmentApi[], overrides: EquipmentOverrideMap): EquipmentApi[] {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return base.map((item) => {
    const patch = overrides[item.id];
    return patch ? ({ ...item, ...patch } as EquipmentApi) : item;
  });
}

function readSessionStore(): EquipmentOverrideMap {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionStore(map: EquipmentOverrideMap): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode) — the edit still applies for this
    // render, it just won't survive a reload within the same tab either.
  }
}

export function getSessionOverrides(): EquipmentOverrideMap {
  return readSessionStore();
}

export function setSessionOverride(equipmentId: string, fields: EquipmentOverrideFields): EquipmentOverrideMap {
  const map = readSessionStore();
  map[equipmentId] = { ...map[equipmentId], ...sanitizeOverrideFields(fields as Record<string, unknown>) };
  writeSessionStore(map);
  return map;
}

export function clearSessionOverride(equipmentId: string): EquipmentOverrideMap {
  const map = readSessionStore();
  delete map[equipmentId];
  writeSessionStore(map);
  return map;
}

/** Clear every session override — called after a successful migration to a
 * signed-in account so a stale local copy can't shadow the persisted one. */
export function clearAllSessionOverrides(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
