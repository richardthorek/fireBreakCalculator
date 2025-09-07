/**
 * UTM Grid Reference utilities for six-digit grid reference search
 * 
 * Handles parsing and finding possible locations for six-digit grid references
 * within a 100km x 100km operational area.
 * 
 * @module gridReference
 * @version 1.0.0
 */

export interface GridReference {
  easting: string;
  northing: string;
  zone: string;
  hemisphere: 'N' | 'S';
}

export interface GridMatch {
  latitude: number;
  longitude: number;
  fullGrid: string;
  confidence: number;
  distance?: number; // Distance from user location if available
}

/**
 * Parse a six-digit grid reference
 * Format: 2nd,3rd,4th digits for Easting + 3rd,4th,5th digits for Northing
 * Example: "234567" -> Easting: 234, Northing: 567
 * 
 * @param input - Six-digit grid reference
 * @returns Parsed grid reference components
 */
export function parseSixDigitGrid(input: string): { easting: string; northing: string } | null {
  const cleaned = input.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  
  if (cleaned.length !== 6) {
    return null;
  }

  const easting = cleaned.substring(0, 3);
  const northing = cleaned.substring(3, 6);

  return { easting, northing };
}

/**
 * Generate all possible full grid references for a six-digit reference
 * within the Australian context (focusing on common UTM zones)
 * 
 * @param sixDigitRef - Parsed six-digit reference
 * @param userLocation - Optional user location for prioritization
 * @returns Array of possible grid matches sorted by likelihood
 */
export function findPossibleGridLocations(
  sixDigitRef: { easting: string; northing: string },
  userLocation?: { lat: number; lng: number }
): GridMatch[] {
  const matches: GridMatch[] = [];
  
  // Common Australian UTM zones (49-56 cover most of Australia)
  const australianZones = [49, 50, 51, 52, 53, 54, 55, 56];
  
  // For six-digit grid, we need to enumerate possible 100km squares
  // Easting: X23,000 where X can be 0-9 (represents hundreds of thousands)
  // Northing: Y67,000 where Y can be 0-9 (represents hundreds of thousands)
  
  for (const zone of australianZones) {
    for (let eastingPrefix = 0; eastingPrefix <= 9; eastingPrefix++) {
      for (let northingPrefix = 0; northingPrefix <= 9; northingPrefix++) {
        // Construct full 6-digit grid reference
        const fullEasting = `${eastingPrefix}${sixDigitRef.easting}000`;
        const fullNorthing = `${northingPrefix}${sixDigitRef.northing}000`;
        
        // Convert UTM to lat/lng
        const coords = utmToLatLng(
          parseInt(fullEasting),
          parseInt(fullNorthing),
          zone,
          'S' // Australia is in Southern hemisphere
        );
        
        if (coords && isWithinAustralia(coords.latitude, coords.longitude)) {
          const confidence = calculateConfidence(
            coords,
            zone,
            userLocation
          );
          
          const distance = userLocation 
            ? calculateDistance(
                userLocation.lat, userLocation.lng,
                coords.latitude, coords.longitude
              )
            : undefined;

          matches.push({
            latitude: coords.latitude,
            longitude: coords.longitude,
            fullGrid: `${zone}${getZoneLetter(coords.latitude)} ${fullEasting} ${fullNorthing}`,
            confidence,
            distance
          });
        }
      }
    }
  }

  // Sort by confidence (higher first), then by distance if available
  return matches.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.1) return confDiff;
    
    if (a.distance !== undefined && b.distance !== undefined) {
      return a.distance - b.distance;
    }
    
    return confDiff;
  });
}

/**
 * Convert UTM coordinates to latitude/longitude
 * Simplified conversion suitable for the operational area
 * 
 * @param easting - UTM easting
 * @param northing - UTM northing  
 * @param zone - UTM zone number
 * @param hemisphere - Hemisphere ('N' or 'S')
 * @returns Latitude/longitude coordinates
 */
function utmToLatLng(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S'
): { latitude: number; longitude: number } | null {
  // Simplified UTM to lat/lng conversion
  // This is a basic implementation - for production use, consider a library like proj4js
  
  const a = 6378137; // WGS84 equatorial radius
  const e = 0.0818191908426; // WGS84 eccentricity
  const k0 = 0.9996; // UTM scale factor
  
  const falseEasting = 500000;
  const falseNorthing = hemisphere === 'S' ? 10000000 : 0;
  
  const x = easting - falseEasting;
  const y = northing - falseNorthing;
  
  const centralMeridian = (zone - 1) * 6 - 180 + 3; // Central meridian for the zone
  
  // Basic conversion (simplified for Australian context)
  const M = y / k0;
  const mu = M / (a * (1 - e * e / 4 - 3 * e * e * e * e / 64));
  
  const lat1 = mu + (3 * e / 2 - 27 * e * e * e / 32) * Math.sin(2 * mu);
  const latitude = lat1 * 180 / Math.PI;
  
  const longitude = centralMeridian + (x / (k0 * a)) * 180 / Math.PI;
  
  if (hemisphere === 'S') {
    return { latitude: -Math.abs(latitude), longitude };
  }
  
  return { latitude, longitude };
}

/**
 * Get UTM zone letter for latitude
 * @param latitude - Latitude value
 * @returns Zone letter
 */
function getZoneLetter(latitude: number): string {
  // Simplified for Australian context
  const letters = 'CDEFGHJKLMNPQRSTUVWX';
  const index = Math.floor((latitude + 80) / 8);
  return letters[Math.max(0, Math.min(index, letters.length - 1))];
}

/**
 * Check if coordinates are within Australia's approximate bounds
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns True if within Australia
 */
function isWithinAustralia(lat: number, lng: number): boolean {
  return (
    lat >= -44 && lat <= -10 &&  // Australia's latitude range
    lng >= 113 && lng <= 154     // Australia's longitude range
  );
}

/**
 * Calculate confidence score for a grid match
 * Higher confidence for locations closer to user and in more common zones
 * 
 * @param coords - Coordinates to evaluate
 * @param zone - UTM zone
 * @param userLocation - User's current location
 * @returns Confidence score (0-1)
 */
function calculateConfidence(
  coords: { latitude: number; longitude: number },
  zone: number,
  userLocation?: { lat: number; lng: number }
): number {
  let confidence = 0.5; // Base confidence
  
  // Higher confidence for more commonly used zones in populated areas
  const popularZones = [55, 56]; // Sydney/Melbourne area
  if (popularZones.includes(zone)) {
    confidence += 0.2;
  }
  
  // Higher confidence for coordinates in populated regions
  if (coords.latitude > -37 && coords.latitude < -25 && 
      coords.longitude > 140 && coords.longitude < 155) {
    confidence += 0.2; // Eastern Australia
  }
  
  // Distance-based confidence if user location is available
  if (userLocation) {
    const distance = calculateDistance(
      userLocation.lat, userLocation.lng,
      coords.latitude, coords.longitude
    );
    
    // Higher confidence for closer locations (within 500km gets max bonus)
    const proximityBonus = Math.max(0, (500 - distance) / 500) * 0.3;
    confidence += proximityBonus;
  }
  
  return Math.min(1, confidence);
}

/**
 * Calculate distance between two points using Haversine formula
 * @param lat1 - First point latitude
 * @param lng1 - First point longitude
 * @param lat2 - Second point latitude
 * @param lng2 - Second point longitude
 * @returns Distance in kilometers
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}