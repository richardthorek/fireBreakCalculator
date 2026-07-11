/**
 * Per-segment breakdown of the drawn line.
 *
 * Joins the slope and vegetation analyses onto a common chainage and lists each
 * uniform slice: where it is (chainage), how steep, what fuel, how confident
 * the detection is, and whether any of it is estimated. Each row can be
 * located on the map so "segment 4" is never abstract.
 */

import React, { useMemo } from 'react';
import { Crosshair } from 'lucide-react';
import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { getVegetationTypeDisplayName } from '../utils/formatters';
import { formatChainage } from '../utils/chainage';
import { buildJoinedSegments } from '../utils/segmentJoin';

interface SegmentBreakdownProps {
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis | null;
  /** Ask the map to highlight this chainage range. */
  onLocate?: (startM: number, endM: number) => void;
  /** Currently highlighted range (to mark the active row). */
  activeRange?: { startM: number; endM: number } | null;
}

const slopeColor = (category: string) => SLOPE_CATEGORIES.find(c => c.key === category)?.color ?? '#888';
const vegSwatchColor = (type: string | null) =>
  (type && VEGETATION_CATEGORIES.find(c => c.key === type)?.color) || '#555';

export const SegmentBreakdown: React.FC<SegmentBreakdownProps> = ({
  trackAnalysis,
  vegetationAnalysis,
  onLocate,
  activeRange,
}) => {
  const segments = useMemo(
    () => buildJoinedSegments(trackAnalysis, vegetationAnalysis),
    [trackAnalysis, vegetationAnalysis]
  );

  if (segments.length === 0) {
    return <div className="segment-breakdown-empty">No segment data yet.</div>;
  }

  return (
    <div className="segment-breakdown">
      <div className="segment-table" role="table" aria-label="Per-segment breakdown">
        <div className="segment-table-header" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Chainage</span>
          <span role="columnheader">Length</span>
          <span role="columnheader">Grade</span>
          <span role="columnheader">Fuel</span>
          <span role="columnheader" className="segment-locate-col" aria-label="Locate on map"></span>
        </div>
        {segments.map((seg, i) => {
          const isActive =
            activeRange &&
            Math.abs(activeRange.startM - seg.startM) < 1 &&
            Math.abs(activeRange.endM - seg.endM) < 1;
          return (
            <div
              key={i}
              role="row"
              className={`segment-table-row${isActive ? ' active' : ''}${seg.estimated ? ' estimated' : ''}`}
            >
              <span role="cell" className="segment-index">{i + 1}</span>
              <span role="cell" className="segment-chainage">
                {formatChainage(seg.startM)} → {formatChainage(seg.endM)}
              </span>
              <span role="cell">{formatChainage(seg.endM - seg.startM)}</span>
              <span role="cell" className="segment-grade">
                <span className="segment-swatch" style={{ background: slopeColor(seg.slopeCategory) }} aria-hidden />
                {Math.round(seg.slope)}°
              </span>
              <span role="cell" className="segment-fuel" title={seg.vegLabel || undefined}>
                <span className="segment-swatch" style={{ background: vegSwatchColor(seg.vegetation) }} aria-hidden />
                {seg.vegetation ? getVegetationTypeDisplayName(seg.vegetation) : '—'}
                {seg.estimated && <span className="segment-estimated-flag" title="Estimated/fallback data">≈</span>}
                {seg.confidence !== undefined && !seg.estimated && (
                  <span className="segment-confidence">{Math.round(seg.confidence * 100)}%</span>
                )}
              </span>
              <span role="cell" className="segment-locate-col">
                {onLocate && (
                  <button
                    type="button"
                    className="segment-locate-btn"
                    title="Highlight this segment on the map"
                    aria-label={`Highlight segment ${i + 1} on the map`}
                    onClick={() => onLocate(seg.startM, seg.endM)}
                  >
                    <Crosshair size={14} strokeWidth={2} aria-hidden />
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="segment-breakdown-hint">
        Segments merge stretches with uniform grade and fuel. “≈” marks estimated (non-authoritative) data.
      </div>
    </div>
  );
};

export default SegmentBreakdown;
