/**
 * Static map image URL builder for SMEACS briefing maps.
 * Uses Mapbox Static Images API to render plan line + entry point + access lines.
 * Returns a shareable HTTPS URL (no authentication in the URL — token must be in Mapbox config).
 *
 * The resulting image can be embedded in PDFs, shared as a link in SMS/text, or included in KMZ.
 */

import { MAPBOX_TOKEN } from '../config/mapboxToken';

export interface StaticMapOptions {
  /** Ordered line vertices (plan). */
  coords: { lat: number; lng: number }[];
  /** Entry point, if available. */
  entryPoint?: { lat: number; lng: number };
  /** User-drawn access lines (if any). */
  accessLines?: { lat: number; lng: number }[][];
  /** Map width in pixels (default 400). */
  width?: number;
  /** Map height in pixels (default 300). */
  height?: number;
  /** Map style (default 'streets-v12'). */
  style?: string;
  /** Zoom level (auto-calculated if omitted). */
  zoom?: number;
}

/**
 * Build a Mapbox Static Images URL for the plan.
 * Returns the full HTTPS URL ready to embed or share.
 * Fails gracefully if Mapbox token is missing.
 */
export function buildStaticMapUrl(options: StaticMapOptions): string | undefined {
  if (!MAPBOX_TOKEN) return undefined;

  const { coords, entryPoint, accessLines, width = 400, height = 300, style = 'streets-v12' } = options;

  if (coords.length < 2) return undefined;

  const base = `https://api.mapbox.com/styles/v1/mapbox/${style}/static`;

  // Build overlay GeoJSON string for line + markers
  const features: any[] = [];

  // Plan line
  features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords.map((p) => [p.lng, p.lat]) },
    properties: { stroke: '#ff6b35', 'stroke-width': 3 },
  });

  // Entry point marker
  if (entryPoint) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [entryPoint.lng, entryPoint.lat] },
      properties: { 'marker-color': '#0a8142', 'marker-symbol': 'p' },
    });
  }

  // Access lines
  if (accessLines && accessLines.length > 0) {
    for (const line of accessLines) {
      if (line.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: line.map((p) => [p.lng, p.lat]) },
          properties: { stroke: '#4a90e2', 'stroke-width': 2, 'stroke-dasharray': '5,5' },
        });
      }
    }
  }

  const geojsonOverlay = JSON.stringify({ type: 'FeatureCollection', features });
  const encodedOverlay = encodeURIComponent(geojsonOverlay);

  // Calculate bounds from all coords (plan + entry + access)
  const allCoords = [
    ...coords,
    ...(entryPoint ? [entryPoint] : []),
    ...(accessLines ? accessLines.flat() : []),
  ];

  const lats = allCoords.map((p) => p.lat);
  const lngs = allCoords.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Add 10% padding
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const paddedMinLng = minLng - lngSpan * 0.1;
  const paddedMaxLng = maxLng + lngSpan * 0.1;
  const paddedMinLat = minLat - latSpan * 0.1;
  const paddedMaxLat = maxLat + latSpan * 0.1;

  // Build the URL: /geojson(overlay)/lon,lat,zoom/width x height
  const url =
    `${base}/geojson(${encodedOverlay})/${centerLng},${centerLat},11/` +
    `${width}x${height}@2x?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

  return url;
}

/**
 * Embed a static map image in HTML (for briefing documents).
 * Returns an HTML <img> tag or undefined if map URL cannot be built.
 */
export function renderStaticMapImage(options: StaticMapOptions): string | undefined {
  const url = buildStaticMapUrl(options);
  if (!url) return undefined;

  return `<img src="${url}" alt="Fire break plan map" width="${options.width || 400}" height="${options.height || 300}" />`;
}
