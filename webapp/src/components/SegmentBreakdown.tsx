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
import { classifySlope, VegetationType } from '../config/classification';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { getVegetationTypeDisplayName } from '../utils/formatters';
import { formatChainage } from '../utils/chainage';

interface SegmentBreakdownProps {
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis | null;
  /** Ask the map to highlight this chainage range. */
  onLocate?: (startM: number, endM: number) => void;
  /** Currently highlighted range (to mark the active row). */
  activeRange?: { startM: number; endM: number } | null;
}

interface JoinedSegment {
  startM: number;
  endM: number;
  slope: number;
  slopeCategory: string;
  vegetation: VegetationType | null;
  vegLabel?: string;
  confidence?: number;
  estimated: boolean;
}

const slopeColor = (category: string) => SLOPE_CATEGORIES.find(c => c.key === category)?.color ?? '#888';
const vegSwatchColor = (type: string | null) =>
  (type && VEGETATION_CATEGORIES.find(c => c.key === type)?.color) || '#555';

function buildJoinedSegments(track: TrackAnalysis, veg: VegetationAnalysis | null): JoinedSegment[] {
  const total = track.totalDistance;
  if (total <= 0) return [];

  // Slope intervals on chainage.
  const slopeIvs: { start: number; end: number; slope: number; category: string }[] = [];
  let cursor = 0;
  for (const s of track.segments) {
    slopeIvs.push({ start: cursor, end: cursor + s.distance, slope: s.slope, category: s.category });
    cursor += s.distance;
  }

  // Vegetation intervals scaled onto the same axis.
  const vegIvs: { start: number; end: number; type: VegetationType; label?: string; confidence: number; estimated: boolean }[] = [];
  if (veg && veg.totalDistance > 0) {
    const scale = total / veg.totalDistance;
    let vc = 0;
    for (const s of veg.segments) {
      const len = s.distance * scale;
      vegIvs.push({
        start: vc,
        end: vc + len,
        type: s.vegetationType,
        label: s.displayLabel,
        confidence: s.confidence,
        estimated: !!s.estimated,
      });
      vc += len;
    }
  }

  // Union of boundaries → joined slices.
  const bounds = new Set<number>([0, total]);
  for (const iv of slopeIvs) { bounds.add(iv.start); bounds.add(iv.end); }
  for (const iv of vegIvs) { bounds.add(iv.start); bounds.add(iv.end); }
  const pts = Array.from(bounds).filter(p => p >= 0 && p <= total).sort((a, b) => a - b);

  const raw: JoinedSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b - a < 1) continue;
    const mid = (a + b) / 2;
    const sIv = slopeIvs.find(iv => mid >= iv.start && mid <= iv.end) ?? slopeIvs[slopeIvs.length - 1];
    const vIv = vegIvs.find(iv => mid >= iv.start && mid <= iv.end);
    raw.push({
      startM: a,
      endM: b,
      slope: sIv?.slope ?? 0,
      slopeCategory: sIv?.category ?? classifySlope(sIv?.slope ?? 0),
      vegetation: vIv?.type ?? null,
      vegLabel: vIv?.label,
      confidence: vIv?.confidence,
      estimated: !!vIv?.estimated,
    });
  }

  // Merge identical neighbours to keep the table readable.
  const merged: JoinedSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.slopeCategory === seg.slopeCategory && last.vegetation === seg.vegetation && last.estimated === seg.estimated) {
      const lenA = last.endM - last.startM;
      const lenB = seg.endM - seg.startM;
      last.slope = (last.slope * lenA + seg.slope * lenB) / (lenA + lenB);
      if (last.confidence !== undefined && seg.confidence !== undefined) {
        last.confidence = (last.confidence * lenA + seg.confidence * lenB) / (lenA + lenB);
      }
      last.endM = seg.endM;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

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
