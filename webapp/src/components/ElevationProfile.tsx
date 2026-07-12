/**
 * Interactive elevation profile for the drawn line.
 *
 * Renders an SVG chart of elevation vs chainage, colored by local slope
 * category, with a vegetation band along the bottom axis. Hovering the chart
 * reports the chainage back to the parent so the map can show a synced marker,
 * making "what is this bump?" a one-glance question.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { classifySlope } from '../config/classification';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { getVegetationTypeDisplayName } from '../utils/formatters';
import { formatChainage } from '../utils/chainage';

interface ElevationProfileProps {
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis | null;
  /** Fires with the hovered chainage (m from start), or null when the pointer leaves. */
  onHoverChainage?: (chainageM: number | null) => void;
}

const CHART_W = 640;
const CHART_H = 180;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 12;
const VEG_BAND_H = 10;
const PAD_B = 34 + VEG_BAND_H;

const slopeColor = (slope: number): string =>
  SLOPE_CATEGORIES.find(c => c.key === classifySlope(slope))?.color ?? '#888888';

const vegColor = (type: string): string =>
  VEGETATION_CATEGORIES.find(c => c.key === type)?.color ?? '#888888';

export const ElevationProfile: React.FC<ElevationProfileProps> = ({
  trackAnalysis,
  vegetationAnalysis,
  onHoverChainage,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ x: number; chainage: number; elevation: number; slope: number; veg?: string } | null>(null);

  const profile = trackAnalysis.elevationProfile ?? [];
  const total = trackAnalysis.totalDistance || (profile.length ? profile[profile.length - 1].distanceM : 0);

  const { minElev, maxElev } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of profile) {
      if (p.elevation < lo) lo = p.elevation;
      if (p.elevation > hi) hi = p.elevation;
    }
    if (!isFinite(lo)) return { minElev: 0, maxElev: 100 };
    const span = Math.max(10, hi - lo);
    return { minElev: lo - span * 0.08, maxElev: hi + span * 0.08 };
  }, [profile]);

  const xFor = useCallback(
    (m: number) => PAD_L + (total > 0 ? (m / total) * (CHART_W - PAD_L - PAD_R) : 0),
    [total]
  );
  const yFor = useCallback(
    (elev: number) => PAD_T + (1 - (elev - minElev) / (maxElev - minElev)) * (CHART_H - PAD_T - PAD_B),
    [minElev, maxElev]
  );

  // Vegetation band intervals along chainage.
  const vegIntervals = useMemo(() => {
    if (!vegetationAnalysis) return [];
    const out: { startM: number; endM: number; type: string }[] = [];
    let cursor = 0;
    const scale = vegetationAnalysis.totalDistance > 0 ? total / vegetationAnalysis.totalDistance : 1;
    for (const seg of vegetationAnalysis.segments) {
      const len = seg.distance * scale;
      out.push({ startM: cursor, endM: cursor + len, type: seg.vegetationType });
      cursor += len;
    }
    return out;
  }, [vegetationAnalysis, total]);

  // Colored polyline segments (consecutive profile points share a stroke per local slope).
  const strokes = useMemo(() => {
    const out: { d: string; color: string }[] = [];
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1];
      const b = profile[i];
      out.push({
        d: `M ${xFor(a.distanceM).toFixed(1)} ${yFor(a.elevation).toFixed(1)} L ${xFor(b.distanceM).toFixed(1)} ${yFor(b.elevation).toFixed(1)}`,
        color: slopeColor(b.slope),
      });
    }
    return out;
  }, [profile, xFor, yFor]);

  // Filled area under the line for depth.
  const areaPath = useMemo(() => {
    if (profile.length < 2) return '';
    const pts = profile.map(p => `${xFor(p.distanceM).toFixed(1)},${yFor(p.elevation).toFixed(1)}`).join(' L ');
    const baseline = CHART_H - PAD_B + VEG_BAND_H;
    return `M ${xFor(profile[0].distanceM).toFixed(1)},${baseline} L ${pts} L ${xFor(profile[profile.length - 1].distanceM).toFixed(1)},${baseline} Z`;
  }, [profile, xFor, yFor]);

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || profile.length === 0 || total <= 0) return;
    const rect = svg.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const m = Math.max(0, Math.min(total, ((fx - PAD_L) / (CHART_W - PAD_L - PAD_R)) * total));
    // Nearest profile sample.
    let best = profile[0];
    for (const p of profile) {
      if (Math.abs(p.distanceM - m) < Math.abs(best.distanceM - m)) best = p;
    }
    const veg = vegIntervals.find(v => m >= v.startM && m <= v.endM)?.type;
    setHover({ x: xFor(m), chainage: m, elevation: best.elevation, slope: best.slope, veg });
    onHoverChainage?.(m);
  };

  const handleLeave = () => {
    setHover(null);
    onHoverChainage?.(null);
  };

  if (profile.length < 2) {
    return <div className="elevation-profile-empty">Elevation profile unavailable for this line.</div>;
  }

  // Axis ticks
  const xTicks = 5;
  const yTicks = 4;

  return (
    <div className="elevation-profile">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`Elevation profile: ${Math.round(minElev)} to ${Math.round(maxElev)} metres over ${formatChainage(total)}`}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
      >
        {/* Gridlines + y labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const elev = minElev + ((maxElev - minElev) * i) / yTicks;
          const y = yFor(elev);
          return (
            <g key={`y${i}`}>
              <line x1={PAD_L} x2={CHART_W - PAD_R} y1={y} y2={y} className="ep-grid" />
              <text x={PAD_L - 6} y={y + 3} className="ep-axis-label" textAnchor="end">
                {Math.round(elev)}
              </text>
            </g>
          );
        })}
        {/* x labels */}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const m = (total * i) / xTicks;
          return (
            <text key={`x${i}`} x={xFor(m)} y={CHART_H - 4} className="ep-axis-label" textAnchor="middle">
              {formatChainage(m)}
            </text>
          );
        })}
        {/* Area fill */}
        <path d={areaPath} className="ep-area" />
        {/* Slope-colored line */}
        {strokes.map((s, i) => (
          <path key={i} d={s.d} stroke={s.color} className="ep-line" />
        ))}
        {/* Vegetation band */}
        {vegIntervals.map((v, i) => (
          <rect
            key={i}
            x={xFor(v.startM)}
            y={CHART_H - PAD_B + 4}
            width={Math.max(0.5, xFor(v.endM) - xFor(v.startM))}
            height={VEG_BAND_H}
            fill={vegColor(v.type)}
            rx={1}
          >
            <title>{getVegetationTypeDisplayName(v.type as any)}</title>
          </rect>
        ))}
        {/* Hover crosshair */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD_T} y2={CHART_H - PAD_B + VEG_BAND_H + 4} className="ep-crosshair" />
            <circle cx={hover.x} cy={yFor(hover.elevation)} r={3.5} className="ep-crosshair-dot" />
          </g>
        )}
      </svg>
      <div className="ep-readout" aria-live="polite">
        {hover ? (
          <>
            <span className="ep-readout-item"><strong>{formatChainage(hover.chainage)}</strong></span>
            <span className="ep-readout-item">{Math.round(hover.elevation)} m elev</span>
            <span className="ep-readout-item">{hover.slope.toFixed(1)}° slope</span>
            {hover.veg && <span className="ep-readout-item">{getVegetationTypeDisplayName(hover.veg as any)}</span>}
          </>
        ) : (
          <span className="ep-readout-hint">Hover the profile to inspect any point — the map marker follows.</span>
        )}
      </div>
    </div>
  );
};

export default ElevationProfile;
