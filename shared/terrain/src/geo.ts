/**
 * Pure geodesic helpers shared by every terrain/mobility algorithm and by
 * webapp/src/utils/slopeCalculation.ts (fire-break mode). Extracted rather
 * than copied — see this package's README.
 */

// Coordinate type compatibility for both Leaflet and Mapbox GL JS
type LatLngLike = { lat: number; lng: number } | { lat: number; lon: number };

const normalizeCoord = (coord: LatLngLike): { lat: number; lng: number } => {
  if ('lng' in coord) {
    return { lat: coord.lat, lng: coord.lng };
  }
  return { lat: coord.lat, lng: (coord as { lat: number; lon: number }).lon };
};

/** Convert degrees to radians */
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Calculate distance between two lat/lng points using the Haversine formula.
 * Returns distance in metres.
 */
const calculateDistanceBetweenPoints = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Calculate total distance of a polyline, or the distance between two points.
 * Accepts either an array of coordinate objects or four raw numbers.
 */
export function calculateDistance(points: LatLngLike[]): number;
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function calculateDistance(pointsOrLat: LatLngLike[] | number, lng1?: number, lat2?: number, lng2?: number): number {
  if (Array.isArray(pointsOrLat)) {
    let totalDistance = 0;
    for (let i = 0; i < pointsOrLat.length - 1; i++) {
      const start = normalizeCoord(pointsOrLat[i]);
      const end = normalizeCoord(pointsOrLat[i + 1]);
      totalDistance += calculateDistanceBetweenPoints(start.lat, start.lng, end.lat, end.lng);
    }
    return totalDistance;
  }

  return calculateDistanceBetweenPoints(pointsOrLat, lng1!, lat2!, lng2!);
}

/** Calculate slope between two points in degrees, given a horizontal distance in metres. */
export const calculateSlope = (
  startElevation: number,
  endElevation: number,
  horizontalDistance: number
): number => {
  if (horizontalDistance === 0) return 0;
  const verticalDistance = Math.abs(endElevation - startElevation);
  const slopeRadians = Math.atan(verticalDistance / horizontalDistance);
  return slopeRadians * (180 / Math.PI);
};
