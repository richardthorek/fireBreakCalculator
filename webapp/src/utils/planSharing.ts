/**
 * Plan sharing & export.
 *
 * A "plan" is the drawn fire-break line plus the key planning settings. It can
 * be:
 *   - encoded into a shareable URL (no backend — the whole plan lives in the
 *     link, so a crew leader can text it and the recipient opens the exact plan),
 *   - exported as GPX to load into a vehicle/handheld GPS,
 *   - printed as a briefing sheet.
 */

import { VegetationType } from '../config/classification';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SharedPlan {
  /** Ordered vertices of the drawn line. */
  coords: LatLng[];
  /** Target break width (m), if set. */
  breakWidthMeters?: number;
  /** Manual vegetation override, if the user set one. */
  vegetation?: VegetationType;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5; // ~1 m precision

// URL-safe base64 (btoa/atob operate on latin1; our payload is ASCII JSON).
const toBase64Url = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
};

/** Encode a plan into a compact string suitable for a URL fragment. */
export function encodePlan(plan: SharedPlan): string {
  const payload = {
    v: 1,
    c: plan.coords.map((p) => [round(p.lat), round(p.lng)]),
    ...(plan.breakWidthMeters ? { w: plan.breakWidthMeters } : {}),
    ...(plan.vegetation ? { g: plan.vegetation } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Decode a plan string; returns null if malformed. */
export function decodePlan(encoded: string): SharedPlan | null {
  try {
    const obj = JSON.parse(fromBase64Url(encoded));
    if (!obj || !Array.isArray(obj.c) || obj.c.length < 2) return null;
    const coords: LatLng[] = obj.c
      .filter((p: unknown) => Array.isArray(p) && p.length === 2)
      .map((p: [number, number]) => ({ lat: p[0], lng: p[1] }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (coords.length < 2) return null;
    return {
      coords,
      breakWidthMeters: typeof obj.w === 'number' ? obj.w : undefined,
      vegetation: typeof obj.g === 'string' ? (obj.g as VegetationType) : undefined,
    };
  } catch {
    return null;
  }
}

/** Build a shareable absolute URL for a plan (encoded in the fragment). */
export function buildShareUrl(plan: SharedPlan): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#plan=${encodePlan(plan)}`;
}

/** Read a plan from the current URL fragment, if present. */
export function readPlanFromUrl(): SharedPlan | null {
  const hash = window.location.hash || '';
  const m = hash.match(/(?:^|[#&])plan=([^&]+)/);
  if (!m) return null;
  return decodePlan(m[1]);
}

/** Convert a line to GPX 1.1 (a single track) for GPS devices. */
export function toGPX(coords: LatLng[], name = 'Fire break plan'): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const pts = coords
    .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}"></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fire Break Calculator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Trigger a client-side file download. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface BriefingResource {
  name: string;
  type: string;
  time: number;
  cost: number;
  compatibilityLevel: string;
  note?: string;
}

export interface BriefingData {
  distanceMeters: number;
  breakWidthMeters: number;
  vegetation: string;
  meanSlope?: number;
  maxSlope?: number;
  estimatedData?: boolean;
  resources: BriefingResource[];
}

/** Open a print-friendly briefing sheet in a new window and invoke print. */
export function printBriefing(data: BriefingData): void {
  const km = (data.distanceMeters / 1000).toFixed(2);
  const fmtTime = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
  const rows = data.resources
    .map(
      (r) => `<tr>
        <td>${r.name}</td><td>${r.type}</td>
        <td>${r.compatibilityLevel}</td>
        <td style="text-align:right">${fmtTime(r.time)}</td>
        <td style="text-align:right">$${Math.round(r.cost).toLocaleString()}</td>
        <td>${r.note ? r.note.replace(/</g, '&lt;') : ''}</td>
      </tr>`
    )
    .join('');
  const warning = data.estimatedData
    ? `<p class="warn">⚠️ Some terrain/vegetation data was estimated — verify on the ground.</p>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fire Break Briefing</title>
    <style>
      body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#111}
      h1{font-size:18px;margin:0 0 4px} .sub{color:#555;margin:0 0 16px}
      table{border-collapse:collapse;width:100%;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
      th{background:#f2f2f2}
      .meta{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0;font-size:13px}
      .warn{color:#8a4b00;font-weight:600}
      @media print{button{display:none}}
    </style></head><body>
    <h1>🔥 Fire Break Plan — Briefing</h1>
    <p class="sub">Generated ${new Date().toLocaleString()}</p>
    ${warning}
    <div class="meta">
      <div><strong>Length:</strong> ${km} km</div>
      <div><strong>Target width:</strong> ${data.breakWidthMeters} m</div>
      <div><strong>Predominant fuel:</strong> ${data.vegetation}</div>
      ${data.meanSlope != null ? `<div><strong>Mean slope:</strong> ${Math.round(data.meanSlope)}°</div>` : ''}
      ${data.maxSlope != null ? `<div><strong>Max slope:</strong> ${Math.round(data.maxSlope)}°</div>` : ''}
    </div>
    <table><thead><tr>
      <th>Resource</th><th>Type</th><th>Fit</th><th>Time</th><th>Cost</th><th>Notes</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <p class="sub" style="margin-top:16px">Estimates for planning only. Confirm resourcing and safety on the ground.</p>
    <button onclick="window.print()">Print</button>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}
