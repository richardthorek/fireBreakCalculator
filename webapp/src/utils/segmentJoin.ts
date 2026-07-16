/**
 * Joined slope × vegetation segments on a common chainage.
 *
 * Shared by the segment-breakdown table and the GIS exporters so that what the
 * user sees in the panel is exactly what lands in exported files — same
 * slices, same values, same estimated-data flags.
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { classifySlope, VegetationType } from '../config/classification';

export interface JoinedSegment {
  startM: number;
  endM: number;
  /** Distance-weighted mean slope for the slice, degrees. */
  slope: number;
  slopeCategory: string;
  vegetation: VegetationType | null;
  vegLabel?: string;
  confidence?: number;
  /** True when the vegetation class came from mock/fallback data. */
  estimated: boolean;
  /** True for NVIS classes 24/25/26/27/28/99 — modified or low-fidelity land; local verification advised. */
  isModifiedOrLowFidelity?: boolean;
}

/** Join the two analyses into uniform chainage slices, merging identical neighbours. */
export function buildJoinedSegments(track: TrackAnalysis, veg: VegetationAnalysis | null): JoinedSegment[] {
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
  const vegIvs: { start: number; end: number; type: VegetationType; label?: string; confidence: number; estimated: boolean; isModifiedOrLowFidelity?: boolean }[] = [];
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
        isModifiedOrLowFidelity: s.isModifiedOrLowFidelity,
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
      isModifiedOrLowFidelity: vIv?.isModifiedOrLowFidelity,
    });
  }

  // Merge identical neighbours to keep the output readable.
  const merged: JoinedSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.slopeCategory === seg.slopeCategory && last.vegetation === seg.vegetation && last.estimated === seg.estimated && last.isModifiedOrLowFidelity === seg.isModifiedOrLowFidelity) {
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
