/**
 * Mobility classification vocabulary — Terrain Mobility & Counter-Mobility mode.
 *
 * ONE canonical union for "how does this ground affect movement", replacing the
 * two half-doctrinal vocabularies this engine used to carry side by side:
 * `mobilityCost.ts`'s per-edge `'GO' | 'SLOW-GO' | 'NO-GO'` (the FM 34-130,
 * 1994 vintage) and `corridorField.ts`'s per-corridor
 * `'open' | 'restricted' | 'severely-restricted'` (current). Both now resolve
 * to the union below.
 *
 * The current vocabulary is the one shown on a Modified Combined Obstacle
 * Overlay: UNRESTRICTED / RESTRICTED / SEVERELY RESTRICTED (ATP 2-01.3,
 * *Intelligence Preparation of the Operational Environment* — renamed from
 * *…of the Battlefield* in Change 2, January 2024). GO/SLOW-GO/NO-GO is the
 * superseded form and survives here only as an input alias for data written by
 * older builds.
 *
 * Values are kebab-lowercase to match `CorridorEaseClass`'s existing
 * convention, so CSS modifier strings, Mapbox `match` expressions and the
 * panel's existing `.replace('-', ' ').toUpperCase()` display path all keep
 * working mechanically.
 *
 * HONESTY NOTE — the one place this rename could mislead. Doctrinally,
 * "severely restricted" does NOT mean impassable; it means movement is
 * severely hindered without mobility enhancement. In THIS engine the
 * corresponding state is a HARD GATE: the edge is excluded from the search
 * entirely and carries a `blockedReason`. That is a stronger claim than the
 * doctrinal term implies, so anywhere this class is shown to a user —
 * legend, export, briefing — it must be qualified with
 * `SEVERELY_RESTRICTED_MEANING` below rather than left to read as doctrine.
 */

/** How ground affects movement, for a specified mover profile. */
export type MobilityClass = 'unrestricted' | 'restricted' | 'severely-restricted';

export const MOBILITY_CLASSES: readonly MobilityClass[] = [
  'unrestricted', 'restricted', 'severely-restricted',
] as const;

/** Display labels. Upper case matches the tactical UI's existing register. */
export const MOBILITY_CLASS_LABEL: Record<MobilityClass, string> = {
  'unrestricted': 'UNRESTRICTED',
  'restricted': 'RESTRICTED',
  'severely-restricted': 'SEVERELY RESTRICTED',
};

/**
 * The qualification that must travel with `'severely-restricted'` wherever it
 * is presented — see the honesty note above. Kept as one exported string so the
 * legend, the GIS export and the AI briefing template cannot drift apart on it.
 */
export const SEVERELY_RESTRICTED_MEANING =
  'Severely restricted here means this model treats the ground as impassable for THIS mover '
  + 'profile. Doctrinally the term does not imply impassability — it means movement is severely '
  + 'hindered without mobility enhancement.';

/**
 * Superseded vocabulary, accepted on the way IN only.
 *
 * Two readers need this: the GIS import path (a file exported by an older
 * build) and the assistant payload validator (a cached SPA client posting to a
 * newer API). Nothing in this codebase should EMIT these values except
 * `mobilityGisExport.ts`'s deliberate dual-emit for one release — see
 * docs/GIS_INTEROP.md.
 */
const LEGACY_ALIASES: Record<string, MobilityClass> = {
  // FM 34-130 / pre-2024 cross-country movement vocabulary
  'GO': 'unrestricted',
  'SLOW-GO': 'restricted',
  'SLOW_GO': 'restricted',
  'NO-GO': 'severely-restricted',
  'NO_GO': 'severely-restricted',
  // corridorField.ts's own pre-migration spelling of the open case
  'OPEN': 'unrestricted',
};

/** True when `value` is already a canonical `MobilityClass`. */
export function isMobilityClass(value: unknown): value is MobilityClass {
  return typeof value === 'string' && (MOBILITY_CLASSES as readonly string[]).includes(value);
}

/**
 * Parse a mobility class from either the current or the superseded vocabulary.
 * Returns `null` for anything unrecognised — callers decide whether that is a
 * validation failure or a missing value, because those are different problems
 * and this module does not get to assume which.
 */
export function fromLegacy(value: unknown): MobilityClass | null {
  if (isMobilityClass(value)) return value;
  if (typeof value !== 'string') return null;
  return LEGACY_ALIASES[value.trim().toUpperCase()] ?? null;
}

/**
 * The superseded spelling for a class, for the dual-emit window in the GIS
 * export only. Do not use this for anything a user reads.
 */
export function toLegacy(value: MobilityClass): 'GO' | 'SLOW-GO' | 'NO-GO' {
  switch (value) {
    case 'unrestricted': return 'GO';
    case 'restricted': return 'SLOW-GO';
    case 'severely-restricted': return 'NO-GO';
  }
}
