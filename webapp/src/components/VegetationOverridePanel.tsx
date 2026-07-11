/**
 * UI component for managing vegetation overrides.
 * Allows users to override detected vegetation types based on local knowledge.
 */

import React, { useState } from 'react';
import { VegetationType } from '../config/classification';
import {
  VegetationOverridesConfig,
  SegmentVegetationOverride,
  mergeSegmentOverrides,
  removeSegmentOverride,
  getTotalOverriddenDistance,
} from '../types/vegetationOverrides';
import './VegetationOverridePanel.css';

const VEGETATION_OPTIONS: { value: VegetationType; label: string; color: string }[] = [
  { value: 'grassland', label: 'Grassland', color: '#FFD700' },
  { value: 'lightshrub', label: 'Light Shrub', color: '#90EE90' },
  { value: 'mediumscrub', label: 'Medium Scrub', color: '#FF8C00' },
  { value: 'heavyforest', label: 'Heavy Forest', color: '#228B22' },
];

interface VegetationOverridePanelProps {
  /** Total route distance in meters */
  totalDistance: number;
  /** Current vegetation analysis segments */
  segments?: Array<{ vegetationType: VegetationType; distance: number }>;
  /** Current override configuration */
  overrides: VegetationOverridesConfig;
  /** Called when overrides change */
  onOverridesChange: (overrides: VegetationOverridesConfig) => void;
}

export const VegetationOverridePanel: React.FC<VegetationOverridePanelProps> = ({
  totalDistance,
  segments = [],
  overrides,
  onOverridesChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newSegmentStart, setNewSegmentStart] = useState<number | ''>('');
  const [newSegmentEnd, setNewSegmentEnd] = useState<number | ''>('');
  const [newSegmentVeg, setNewSegmentVeg] = useState<VegetationType>('grassland');
  const [newSegmentNote, setNewSegmentNote] = useState('');

  const handleRouteOverrideChange = (veg: VegetationType | '') => {
    const newOverrides = { ...overrides };
    if (veg === '') {
      delete newOverrides.routeOverride;
      delete newOverrides.routeOverrideNote;
    } else {
      newOverrides.routeOverride = veg;
    }
    onOverridesChange(newOverrides);
  };

  const handleAddSegmentOverride = () => {
    if (newSegmentStart === '' || newSegmentEnd === '' || newSegmentStart >= newSegmentEnd) {
      alert('Invalid segment range. Start must be less than end.');
      return;
    }

    const newOverride: SegmentVegetationOverride = {
      startDistance: Number(newSegmentStart),
      endDistance: Number(newSegmentEnd),
      vegetation: newSegmentVeg,
      note: newSegmentNote || undefined,
      createdAt: new Date().toISOString(),
    };

    const updated = mergeSegmentOverrides(
      newOverride,
      overrides.segmentOverrides || [],
      'replace'
    );

    onOverridesChange({
      ...overrides,
      segmentOverrides: updated,
    });

    // Reset form
    setNewSegmentStart('');
    setNewSegmentEnd('');
    setNewSegmentVeg('grassland');
    setNewSegmentNote('');
  };

  const handleRemoveSegmentOverride = (index: number) => {
    const updated = removeSegmentOverride(index, overrides.segmentOverrides);
    onOverridesChange({
      ...overrides,
      segmentOverrides: updated,
    });
  };

  const handleToggleEnabled = () => {
    onOverridesChange({
      ...overrides,
      isEnabled: !overrides.isEnabled,
    });
  };

  const totalOverriddenDistance = getTotalOverriddenDistance(overrides.segmentOverrides);
  const overriddenPercent = totalDistance > 0 ? ((totalOverriddenDistance / totalDistance) * 100).toFixed(1) : '0';

  return (
    <div className="vegetation-override-panel">
      <div className="override-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h3>
          <input
            type="checkbox"
            checked={overrides.isEnabled ?? false}
            onChange={handleToggleEnabled}
            title="Enable/disable vegetation overrides"
          />
          {' '}
          Vegetation Overrides
          <span className="toggle-arrow">{isExpanded ? '▼' : '▶'}</span>
        </h3>
        {(overrides.routeOverride || overrides.segmentOverrides?.length) && (
          <span className="override-badge">
            {overrides.routeOverride && 'Route'} {overrides.segmentOverrides?.length ? `+ ${overrides.segmentOverrides.length} segments` : ''}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="override-content">
          {/* Route-level override */}
          <div className="override-section">
            <h4>Route-level Override</h4>
            <p className="help-text">Apply a single vegetation type to the entire route</p>
            <div className="control-group">
              <select
                value={overrides.routeOverride || ''}
                onChange={(e) => handleRouteOverrideChange(e.target.value as VegetationType | '')}
                disabled={!overrides.isEnabled}
              >
                <option value="">Auto-detected (no override)</option>
                {VEGETATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {overrides.routeOverride && (
                <input
                  type="text"
                  placeholder="Reason/notes (optional)"
                  value={overrides.routeOverrideNote || ''}
                  onChange={(e) =>
                    onOverridesChange({
                      ...overrides,
                      routeOverrideNote: e.target.value,
                    })
                  }
                  disabled={!overrides.isEnabled}
                  className="note-input"
                />
              )}
            </div>
          </div>

          {/* Segment-level overrides */}
          <div className="override-section">
            <h4>Segment-level Overrides</h4>
            <p className="help-text">Override vegetation type for specific segments</p>

            {overrides.segmentOverrides && overrides.segmentOverrides.length > 0 && (
              <div className="override-list">
                {overrides.segmentOverrides.map((seg, idx) => (
                  <div key={idx} className="override-item">
                    <div className="override-info">
                      <span className="veg-badge" style={{ backgroundColor: VEGETATION_OPTIONS.find((o) => o.value === seg.vegetation)?.color }}>
                        {VEGETATION_OPTIONS.find((o) => o.value === seg.vegetation)?.label}
                      </span>
                      <span className="distance-range">
                        {seg.startDistance}m – {seg.endDistance}m ({seg.endDistance - seg.startDistance}m)
                      </span>
                      {seg.note && <span className="note">{seg.note}</span>}
                    </div>
                    <button
                      onClick={() => handleRemoveSegmentOverride(idx)}
                      disabled={!overrides.isEnabled}
                      className="remove-btn"
                      title="Remove this override"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="summary">
                  {overriddenPercent}% of route overridden ({totalOverriddenDistance}m of {totalDistance}m)
                </div>
              </div>
            )}

            {/* Add new segment override */}
            <div className="add-segment">
              <h5>Add New Segment Override</h5>
              <div className="input-row">
                <div className="input-group">
                  <label htmlFor="seg-start">Start (meters)</label>
                  <input
                    id="seg-start"
                    type="number"
                    min="0"
                    max={totalDistance}
                    value={newSegmentStart}
                    onChange={(e) => setNewSegmentStart(e.target.value === '' ? '' : Number(e.target.value))}
                    disabled={!overrides.isEnabled}
                    placeholder="0"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="seg-end">End (meters)</label>
                  <input
                    id="seg-end"
                    type="number"
                    min="0"
                    max={totalDistance}
                    value={newSegmentEnd}
                    onChange={(e) => setNewSegmentEnd(e.target.value === '' ? '' : Number(e.target.value))}
                    disabled={!overrides.isEnabled}
                    placeholder={String(totalDistance)}
                  />
                </div>
              </div>

              <div className="input-row">
                <div className="input-group">
                  <label htmlFor="seg-veg">Vegetation Type</label>
                  <select
                    id="seg-veg"
                    value={newSegmentVeg}
                    onChange={(e) => setNewSegmentVeg(e.target.value as VegetationType)}
                    disabled={!overrides.isEnabled}
                  >
                    {VEGETATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="input-row">
                <div className="input-group full-width">
                  <label htmlFor="seg-note">Note (optional)</label>
                  <input
                    id="seg-note"
                    type="text"
                    placeholder="e.g., Local knowledge: recent fire regrowth"
                    value={newSegmentNote}
                    onChange={(e) => setNewSegmentNote(e.target.value)}
                    disabled={!overrides.isEnabled}
                    className="note-input"
                  />
                </div>
              </div>

              <button
                onClick={handleAddSegmentOverride}
                disabled={!overrides.isEnabled || newSegmentStart === '' || newSegmentEnd === ''}
                className="add-btn"
              >
                Add Override
              </button>
            </div>
          </div>

          {overrides.isEnabled && (overrides.routeOverride || overrides.segmentOverrides?.length) && (
            <div className="override-info-box">
              ℹ️ Vegetation overrides are active and will be used in all analyses. Segment-level overrides take precedence over route-level.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
