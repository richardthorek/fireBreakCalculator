/**
 * Coordinate parsing utilities for various coordinate formats
 * 
 * @module coordinateParser
 * @version 1.0.0
 */

export interface ParsedCoordinates {
  latitude: number;
  longitude: number;
  format: 'decimal' | 'dms' | 'dm';
}

/**
 * Parse various coordinate formats
 * Supports:
 * - Decimal degrees: -33.8688, 151.2093
 * - Degrees, minutes, seconds: 33°52'8"S, 151°12'33"E
 * - Degrees, decimal minutes: 33°52.133'S, 151°12.558'E
 * 
 * @param input - Coordinate string to parse
 * @returns Parsed coordinates or null if invalid
 */
export function parseCoordinates(input: string): ParsedCoordinates | null {
  if (!input?.trim()) {
    return null;
  }

  const trimmed = input.trim();

  // Try decimal degrees first (most common)
  const decimalMatch = tryParseDecimalDegrees(trimmed);
  if (decimalMatch) {
    return decimalMatch;
  }

  // Try degrees, minutes, seconds
  const dmsMatch = tryParseDMS(trimmed);
  if (dmsMatch) {
    return dmsMatch;
  }

  // Try degrees, decimal minutes
  const dmMatch = tryParseDM(trimmed);
  if (dmMatch) {
    return dmMatch;
  }

  return null;
}

/**
 * Parse decimal degrees format
 * Examples: "-33.8688, 151.2093", "33.8688S 151.2093E", "-33.8688 151.2093"
 */
function tryParseDecimalDegrees(input: string): ParsedCoordinates | null {
  // Remove common separators and normalize
  const normalized = input
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Pattern for decimal degrees with optional hemisphere indicators
  const pattern = /^(-?\d+\.?\d*)\s*([NSns])?\s*[,\s]\s*(-?\d+\.?\d*)\s*([EWew])?$/;
  const match = normalized.match(pattern);

  if (match) {
    let lat = parseFloat(match[1]);
    const latHem = match[2]?.toUpperCase();
    let lng = parseFloat(match[3]);
    const lngHem = match[4]?.toUpperCase();

    // Apply hemisphere
    if (latHem === 'S') lat = -Math.abs(lat);
    else if (latHem === 'N') lat = Math.abs(lat);

    if (lngHem === 'W') lng = -Math.abs(lng);
    else if (lngHem === 'E') lng = Math.abs(lng);

    if (isValidCoordinate(lat, lng)) {
      return { latitude: lat, longitude: lng, format: 'decimal' };
    }
  }

  // Try simple decimal format without hemisphere indicators
  const simplePattern = /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/;
  const simpleMatch = normalized.match(simplePattern);

  if (simpleMatch) {
    const lat = parseFloat(simpleMatch[1]);
    const lng = parseFloat(simpleMatch[2]);

    if (isValidCoordinate(lat, lng)) {
      return { latitude: lat, longitude: lng, format: 'decimal' };
    }
  }

  return null;
}

/**
 * Parse degrees, minutes, seconds format
 * Examples: "33°52'8\"S, 151°12'33\"E", "33d52m8sS 151d12m33sE"
 */
function tryParseDMS(input: string): ParsedCoordinates | null {
  // Normalize degree symbols and quotes
  const normalized = input
    .replace(/[°º]/g, 'd')
    .replace(/['′]/g, 'm')
    .replace(/[\"″]/g, 's')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const pattern = /(\d+)d(\d+)m(\d+(?:\.\d+)?)s([NSns])\s+(\d+)d(\d+)m(\d+(?:\.\d+)?)s([EWew])/;
  const match = normalized.match(pattern);

  if (match) {
    const latDeg = parseInt(match[1]);
    const latMin = parseInt(match[2]);
    const latSec = parseFloat(match[3]);
    const latHem = match[4].toUpperCase();

    const lngDeg = parseInt(match[5]);
    const lngMin = parseInt(match[6]);
    const lngSec = parseFloat(match[7]);
    const lngHem = match[8].toUpperCase();

    let lat = latDeg + latMin / 60 + latSec / 3600;
    let lng = lngDeg + lngMin / 60 + lngSec / 3600;

    if (latHem === 'S') lat = -lat;
    if (lngHem === 'W') lng = -lng;

    if (isValidCoordinate(lat, lng)) {
      return { latitude: lat, longitude: lng, format: 'dms' };
    }
  }

  return null;
}

/**
 * Parse degrees, decimal minutes format
 * Examples: "33°52.133'S, 151°12.558'E"
 */
function tryParseDM(input: string): ParsedCoordinates | null {
  const normalized = input
    .replace(/[°º]/g, 'd')
    .replace(/['′]/g, 'm')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const pattern = /(\d+)d(\d+(?:\.\d+)?)m([NSns])\s+(\d+)d(\d+(?:\.\d+)?)m([EWew])/;
  const match = normalized.match(pattern);

  if (match) {
    const latDeg = parseInt(match[1]);
    const latMin = parseFloat(match[2]);
    const latHem = match[3].toUpperCase();

    const lngDeg = parseInt(match[4]);
    const lngMin = parseFloat(match[5]);
    const lngHem = match[6].toUpperCase();

    let lat = latDeg + latMin / 60;
    let lng = lngDeg + lngMin / 60;

    if (latHem === 'S') lat = -lat;
    if (lngHem === 'W') lng = -lng;

    if (isValidCoordinate(lat, lng)) {
      return { latitude: lat, longitude: lng, format: 'dm' };
    }
  }

  return null;
}

/**
 * Validate coordinate values
 * @param lat - Latitude value
 * @param lng - Longitude value
 * @returns True if coordinates are valid
 */
function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

/**
 * Format coordinates as decimal degrees
 * @param lat - Latitude
 * @param lng - Longitude
 * @param precision - Number of decimal places
 * @returns Formatted coordinate string
 */
export function formatDecimalDegrees(lat: number, lng: number, precision: number = 6): string {
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}

/**
 * Format coordinates as degrees, minutes, seconds
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Formatted coordinate string
 */
export function formatDMS(lat: number, lng: number): string {
  const formatDegrees = (deg: number, isLatitude: boolean): string => {
    const absdeg = Math.abs(deg);
    const d = Math.floor(absdeg);
    const m = Math.floor((absdeg - d) * 60);
    const s = ((absdeg - d) * 60 - m) * 60;
    
    const hemisphere = isLatitude 
      ? (deg >= 0 ? 'N' : 'S')
      : (deg >= 0 ? 'E' : 'W');
    
    return `${d}°${m}'${s.toFixed(1)}"${hemisphere}`;
  };

  return `${formatDegrees(lat, true)}, ${formatDegrees(lng, false)}`;
}