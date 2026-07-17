/**
 * Map rendering for the live context feeds (hotspots, fire boundaries,
 * incidents). Owns the Mapbox sources/layers/icons/popups so MapboxMapView
 * stays a thin orchestrator.
 *
 * Incident markers follow the Australian Warning System design language:
 * sharp-cornered triangles in yellow (Advice), orange (Watch and Act) and
 * red (Emergency Warning), with a neutral round marker for incidents that
 * carry no warning. Icons are drawn on-canvas so the app stays
 * self-contained and offline-friendly; the official AFAC/AIDR icon set can
 * be swapped in via map images without touching layer logic.
 *
 * Popup content is built with textContent (never innerHTML) — feed strings
 * are untrusted.
 */

import type { HotspotsResult, BoundariesResult } from './liveFeedsService';
import { logger } from './logger';

export interface LiveFeedMapData {
  hotspots: HotspotsResult | null;
  boundaries: BoundariesResult | null;
  incidents: GeoJSON.FeatureCollection | null;
}

// Australian Warning System palette (per the national style guidance).
const AWS_COLORS: Record<string, string> = {
  'aws-emergency-warning': '#d8232a',
  'aws-watch-and-act': '#f5821f',
  'aws-advice': '#ffd200'
};

const SRC = {
  hotspots: 'livefeed-hotspots',
  boundaries: 'livefeed-boundaries',
  incidents: 'livefeed-incidents'
} as const;

/** Draw a sharp-cornered AWS warning triangle (with ! glyph) as ImageData. */
const drawTriangleIcon = (color: string, size = 44): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 2, size - 4);
  ctx.lineTo(2, size - 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#1a1a1a';
  ctx.stroke();
  // Exclamation glyph
  ctx.fillStyle = '#1a1a1a';
  const cx = size / 2;
  ctx.fillRect(cx - 2, size * 0.32, 4, size * 0.32);
  ctx.beginPath();
  ctx.arc(cx, size * 0.78, 2.6, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
};

/** Neutral marker for incidents without an attached warning. */
const drawIncidentIcon = (size = 30): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = '#3d6b9e';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
};

const ensureIcons = (map: any) => {
  for (const [name, color] of Object.entries(AWS_COLORS)) {
    if (!map.hasImage(name)) map.addImage(name, drawTriangleIcon(color));
  }
  if (!map.hasImage('aws-incident')) map.addImage('aws-incident', drawIncidentIcon());
};

/** Append a "label: value" line to a popup element (text-only, XSS-safe). */
const popupLine = (parent: HTMLElement, label: string, value: string | null | undefined) => {
  if (!value) return;
  const div = document.createElement('div');
  const b = document.createElement('strong');
  b.textContent = `${label}: `;
  div.appendChild(b);
  div.appendChild(document.createTextNode(value));
  parent.appendChild(div);
};

const popupTitle = (parent: HTMLElement, text: string) => {
  const h = document.createElement('div');
  h.style.cssText = 'font-weight:700;margin-bottom:4px;';
  h.textContent = text;
  parent.appendChild(h);
};

const showPopup = (map: any, mapboxgl: any, lngLat: any, build: (el: HTMLElement) => void) => {
  const el = document.createElement('div');
  el.className = 'livefeed-popup';
  build(el);
  new mapboxgl.Popup({ closeButton: true, maxWidth: '320px' })
    .setLngLat(lngLat)
    .setDOMContent(el)
    .addTo(map);
};

const upsertGeojsonSource = (map: any, id: string, data: GeoJSON.FeatureCollection | null) => {
  const existing = map.getSource(id);
  if (data) {
    if (existing) {
      existing.setData(data);
      return false; // layers already exist
    }
    map.addSource(id, { type: 'geojson', data });
    return true; // caller must add layers
  }
  if (existing) {
    for (const layer of (map.getStyle()?.layers ?? [])) {
      if (layer.source === id) map.removeLayer(layer.id);
    }
    map.removeSource(id);
  }
  return false;
};

const AWS_LEVEL_LABELS: Record<string, string> = {
  'emergency-warning': 'Emergency Warning',
  'watch-and-act': 'Watch and Act',
  'advice': 'Advice',
  'incident': 'Incident'
};

/**
 * Sync the live-feed sources/layers with the given data. Passing null for a
 * feed removes its layers. Safe to call repeatedly.
 */
export function applyLiveFeedLayers(map: any, mapboxgl: any, data: LiveFeedMapData): void {
  try {
    ensureIcons(map);

    // --- Fire boundaries (polygons; below the point layers) ---------------
    if (upsertGeojsonSource(map, SRC.boundaries, data.boundaries?.geojson ?? null)) {
      map.addLayer({
        id: `${SRC.boundaries}-fill`, type: 'fill', source: SRC.boundaries,
        paint: {
          'fill-color': ['match', ['get', 'fire_type'], 'Prescribed Burn', '#7b4fa3', '#c0392b'],
          'fill-opacity': 0.22
        }
      });
      map.addLayer({
        id: `${SRC.boundaries}-line`, type: 'line', source: SRC.boundaries,
        paint: {
          'line-color': ['match', ['get', 'fire_type'], 'Prescribed Burn', '#5b3579', '#8e2620'],
          'line-width': 1.8
        }
      });
      map.on('click', `${SRC.boundaries}-fill`, (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        showPopup(map, mapboxgl, e.lngLat, el => {
          popupTitle(el, p.fire_name || 'Fire area');
          popupLine(el, 'Type', p.fire_type);
          popupLine(el, 'Area', p.area_ha ? `${Number(p.area_ha).toLocaleString()} ha` : null);
          popupLine(el, 'State', p.state);
          popupLine(el, 'Agency', p.agency);
          popupLine(el, 'Boundary captured', p.capt_date_iso ? new Date(p.capt_date_iso).toLocaleString() : null);
          popupLine(el, 'Source', 'Digital Atlas of Australia / Geoscience Australia (CC BY 4.0) — not for safety-of-life decisions');
        });
      });
    }

    // --- Hotspots (points, colour-ramped by age) ---------------------------
    if (upsertGeojsonSource(map, SRC.hotspots, data.hotspots?.geojson ?? null)) {
      map.addLayer({
        id: SRC.hotspots, type: 'circle', source: SRC.hotspots,
        paint: {
          'circle-color': [
            'step', ['coalesce', ['get', 'hours_since_hotspot'], 999],
            '#e63946', 6, '#f77f00', 24, '#b08d57'
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 6, 14, 9],
          'circle-opacity': 0.85,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.8
        }
      });
      map.on('click', SRC.hotspots, (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        showPopup(map, mapboxgl, e.lngLat, el => {
          popupTitle(el, 'Satellite hotspot');
          popupLine(el, 'Detected', p.datetime ? new Date(p.datetime).toLocaleString() : null);
          popupLine(el, 'Satellite', [p.satellite, p.sensor].filter(Boolean).join(' / '));
          popupLine(el, 'Location accuracy', p.accuracy);
          popupLine(el, 'Temperature', p.temp_kelvin ? `${p.temp_kelvin} K` : null);
          // power -1 is the feed's no-value sentinel — omit rather than show a fake reading.
          popupLine(el, 'Fire power', typeof p.power === 'number' && p.power >= 0 ? `${p.power} MW` : null);
          popupLine(el, 'Note', 'A hotspot is a thermal detection, not a confirmed fire.');
          popupLine(el, 'Source', 'DEA Hotspots, Geoscience Australia (CC BY 4.0)');
        });
      });
    }

    // --- Incidents (AWS-symbolised points, on top) --------------------------
    if (upsertGeojsonSource(map, SRC.incidents, data.incidents)) {
      map.addLayer({
        id: SRC.incidents, type: 'symbol', source: SRC.incidents,
        layout: {
          'icon-image': ['concat', 'aws-', ['get', 'level']],
          'icon-size': ['match', ['get', 'level'], 'incident', 0.55, 0.5],
          'icon-allow-overlap': true,
          'symbol-sort-key': ['-', 3, ['get', 'levelRank']]
        }
      });
      map.on('click', SRC.incidents, (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        showPopup(map, mapboxgl, e.lngLat, el => {
          popupTitle(el, p.title || 'Incident');
          popupLine(el, 'Warning level', AWS_LEVEL_LABELS[p.level] ?? p.level);
          popupLine(el, 'Type', p.category);
          popupLine(el, 'Status', p.status);
          popupLine(el, 'Size', p.sizeFmt);
          popupLine(el, 'Updated', p.updatedRaw);
          popupLine(el, 'Source', p.source);
        });
      });
      for (const layerId of [SRC.incidents, SRC.hotspots, `${SRC.boundaries}-fill`]) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }
    }

    // Keep points above polygons whenever all layers exist.
    if (map.getLayer(SRC.hotspots) && map.getLayer(`${SRC.boundaries}-line`)) map.moveLayer(SRC.hotspots);
    if (map.getLayer(SRC.incidents)) map.moveLayer(SRC.incidents);
  } catch (e) {
    logger.warn('Failed to apply live feed layers', e);
  }
}
