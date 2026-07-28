/**
 * Road-speed override panel — Terrain Mobility Slice A config UI
 * (docs/ROUTE_INTELLIGENCE.md §35, owner: "find a real citation, and make it
 * configurable for fine-grained adjustments"). Editable table for the four
 * OSRM-sourced tables (highway/surface/tracktype/smoothness) `roadSpeedModel.ts`
 * ships as defaults. Editing a row flips that class from `published` to
 * `user-override` confidence (roadSpeedModel.ts's own `RoadClassConfidence`)
 * — surfaced here as a simple per-row highlight and an overridden-count badge
 * on the section header, matching the honesty discipline the rest of this app
 * applies to estimated/fallback data.
 *
 * ONLY AFFECTS VEHICLE-GRADIENT PROFILES: `roadClassCeiling` is never
 * consulted for foot profiles (roadSpeedModel.ts's own header explains why —
 * OSRM's tables encode vehicle speeds, not walking speed). This panel says so
 * rather than implying an edit here does anything for a foot profile.
 */

import React, { useState } from 'react';
import {
  HIGHWAY_SPEED_KMH, SURFACE_SPEED_CAP_KMH, TRACKTYPE_SPEED_CAP_KMH, SMOOTHNESS_SPEED_CAP_KMH,
  RoadSpeedOverrides,
} from '../terrain/roadSpeedModel';

export interface RoadSpeedOverridePanelProps {
  overrides: RoadSpeedOverrides;
  onOverridesChange: (overrides: RoadSpeedOverrides) => void;
}

type TableKey = 'highway' | 'surface' | 'tracktype' | 'smoothness';

const TABLES: { key: TableKey; label: string; defaults: Readonly<Record<string, number>> }[] = [
  { key: 'highway', label: 'Highway class', defaults: HIGHWAY_SPEED_KMH },
  { key: 'surface', label: 'Surface cap', defaults: SURFACE_SPEED_CAP_KMH },
  { key: 'tracktype', label: 'Tracktype cap', defaults: TRACKTYPE_SPEED_CAP_KMH },
  { key: 'smoothness', label: 'Smoothness cap', defaults: SMOOTHNESS_SPEED_CAP_KMH },
];

function countOverrides(overrides: RoadSpeedOverrides): number {
  return TABLES.reduce((n, t) => n + Object.keys(overrides[t.key] ?? {}).length, 0);
}

export const RoadSpeedOverridePanel: React.FC<RoadSpeedOverridePanelProps> = ({ overrides, onOverridesChange }) => {
  const [open, setOpen] = useState(false);
  const overrideCount = countOverrides(overrides);

  const setValue = (table: TableKey, tag: string, value: number | undefined) => {
    const nextTable = { ...overrides[table] };
    if (value === undefined || Number.isNaN(value)) {
      delete nextTable[tag];
    } else {
      nextTable[tag] = value;
    }
    onOverridesChange({ ...overrides, [table]: nextTable });
  };

  return (
    <div className="tac-panel mobility-section road-speed-overrides">
      <button
        type="button"
        className="tac-label road-speed-overrides-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        ROAD-CLASS SPEEDS{overrideCount > 0 ? ` — ${overrideCount} OVERRIDDEN` : ''} {open ? '▾' : '▸'}
      </button>
      {open && (
        <>
          <div className="tac-hint">
            Sourced from the OSRM car routing profile — published, CIVILIAN driving speeds, not
            a military-mobility figure. Affects VEHICLE profiles only: composed as a ceiling with
            the vehicle's own road speed (the slower of the two wins), never a substitute for it.
            Has no effect on foot profiles. Edit any value to override the sourced default for
            this device/browser; an edited row carries a "user-override" flag through the run log.
          </div>
          {TABLES.map(table => (
            <div key={table.key} className="road-speed-table">
              <div className="road-speed-table-label tac-mono">{table.label} (km/h)</div>
              <table className="road-speed-table-grid">
                <tbody>
                  {Object.entries(table.defaults).map(([tag, defaultValue]) => {
                    const overridden = overrides[table.key]?.[tag];
                    const value = overridden ?? defaultValue;
                    return (
                      <tr key={tag} className={overridden !== undefined ? 'is-overridden' : undefined}>
                        <td className="tac-mono road-speed-tag">{tag}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="tac-mono road-speed-input"
                            value={value}
                            onChange={e => setValue(table.key, tag, e.target.value === '' ? undefined : Number(e.target.value))}
                          />
                        </td>
                        <td>
                          {overridden !== undefined && (
                            <button
                              type="button"
                              className="road-speed-reset"
                              onClick={() => setValue(table.key, tag, undefined)}
                              title={`Reset to sourced default (${defaultValue} km/h)`}
                            >
                              ↺
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          {overrideCount > 0 && (
            <button type="button" className="tac-button road-speed-reset-all" onClick={() => onOverridesChange({})}>
              Reset all to sourced defaults
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default RoadSpeedOverridePanel;
