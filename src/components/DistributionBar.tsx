import React from 'react';
import { CategoryDef } from '../config/categories';

export interface DistributionDatum {
  key: string;
  value: number; // raw measure (meters)
}

interface DistributionBarProps {
  categories: CategoryDef[];
  data: Record<string, number>; // map key -> value
  total?: number; // optional explicit total (else sum of values)
  compact?: boolean; // smaller height variant
  showLabels?: boolean; // show legend below
  valueUnit?: string; // e.g. 'm'
  ariaLabel?: string;
  internalSegmentLabels?: boolean; // show labels inside segments when wide enough
}

export const DistributionBar: React.FC<DistributionBarProps> = ({
  categories,
  data,
  total,
  compact = false,
  showLabels = true,
  valueUnit = 'm',
  ariaLabel,
  internalSegmentLabels = true
}) => {
  const computedTotal = (total ?? categories.reduce((acc, c) => acc + (data[c.key] || 0), 0)) || 1;
  const heightClass = compact ? 'dist-bar-compact' : 'dist-bar';
  return (
    <div className="dist-wrapper">
      <div className={`${heightClass}`} role="img" aria-label={ariaLabel}>
        {categories.map(c => {
          const raw = data[c.key] || 0;
          const pct = Math.max(0, Math.round((raw / computedTotal) * 100));
          const showInner = internalSegmentLabels && pct >= 8; // threshold
          return (
            <div
              key={c.key}
              className={`dist-seg dist-pct-${pct}`}
              data-color={c.color}
              title={`${c.label}: ${pct}% (${Math.round(raw)} ${valueUnit})`}
            >
              {showInner && <span className="dist-inner-label" aria-hidden="true">{pct}%</span>}
            </div>
          );
        })}
      </div>
      {showLabels && (
        <div className="dist-legend">
          {categories.map(c => {
            const raw = data[c.key] || 0;
            const pct = Math.max(0, Math.round((raw / computedTotal) * 100));
            return (
              <div key={c.key} className="dist-legend-item">
                <span className="dist-swatch" data-color={c.color} />
                <span className="dist-legend-label">{c.label}{c.range ? ` (${c.range})` : ''}</span>
                <span className="dist-legend-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
