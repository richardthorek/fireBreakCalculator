/**
 * UTM Grid Reference utilities for grid reference search
 * 
 * Handles parsing and finding possible locations for grid references
 * using proper UTM coordinate conversion.
 * 
 * @module gridReference
 * @version 2.0.0
 */

// Lazy load utm-latlng library
let utm: any = null;

async function getUtmConverter() {
  if (!utm) {
    try {
      // Dynamic import for utm-latlng
      const UtmLatLng = (await import('utm-latlng')).default;
      utm = new UtmLatLng();
    } catch (error) {
      console.error('Failed to load utm-latlng library:', error);
      throw new Error('UTM conversion library not available');
    }
  }
  return utm;
}

export interface GridReference {
  easting: string;
  northing: string;
  zone?: string;
  hemisphere?: 'N' | 'S';
}

export interface GridMatch {
  latitude: number;
  longitude: number;
  fullGrid: string;
  confidence: number;
  distance?: number; // Distance from user location if available
}

/**
 * Parse grid reference input in various formats
 * Supports:
 * - "123 456" (6 digits in two groups)
 * - "1234 5678" (8 digits in two groups) 
 * - "12345678" (8 digits in one group, split in half)
 * - "234567" (6 digits in one group, split in half)
 * 
 * @param input - Grid reference input
 * @returns Parsed grid reference components
 */
export function parseGridReference(input: string): { easting: string; northing: string } | null {
  const cleaned = input.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  
  // Handle different input formats
  if (cleaned.length === 6) {
    // Split 6 digits in half: "234567" -> "234", "567"
    return {
      easting: cleaned.substring(0, 3),
      northing: cleaned.substring(3, 6)
    };
  } else if (cleaned.length === 8) {
    // Split 8 digits in half: "12345678" -> "1234", "5678"
    return {
      easting: cleaned.substring(0, 4),
      northing: cleaned.substring(4, 8)
    };
  }
  
  // Try to parse spaced input
  const parts = input.trim().split(/\s+/);
  if (parts.length === 2) {
    const eastingClean = parts[0].replace(/[^0-9]/g, '');
    const northingClean = parts[1].replace(/[^0-9]/g, '');
    
    if ((eastingClean.length === 3 && northingClean.length === 3) ||
        (eastingClean.length === 4 && northingClean.length === 4)) {
      return {
        easting: eastingClean,
        northing: northingClean
      };
    }
  }
  
  return null;
}

/**
 * Find possible grid reference locations based on user input
 * 
 * This function interprets partial grid references and finds the most likely
 * full UTM coordinates, especially when user location is available.
 * 
 * @param gridRef - Parsed grid reference
 * @param userLocation - User's current location for context
 * @returns Array of possible grid matches sorted by likelihood
 */
export async function findPossibleGridLocations(
  gridRef: { easting: string; northing: string },
  userLocation?: { lat: number; lng: number }
): Promise<GridMatch[]> {
  const matches: GridMatch[] = [];
  const MAX_RESULTS = 4; // Limit to 4 results as requested
  
  try {
    const utmConverter = await getUtmConverter();
    
    // If we have user location, get their UTM zone for context
    let userUtmInfo: any = null;
    let priorityZones: number[] = [];
    
    if (userLocation) {
      try {
        userUtmInfo = (utmConverter as any).convertLatLngToUtm(userLocation.lat, userLocation.lng, 0);
        // Prioritize user's zone and adjacent zones
        const userZone = userUtmInfo.ZoneNumber;
        priorityZones = [userZone, userZone - 1, userZone + 1].filter(z => z >= 49 && z <= 56);
      } catch (error) {
        console.warn('Failed to convert user location to UTM:', error);
      }
    }
    
    // Common Australian UTM zones, prioritizing user's location
    const australianZones = priorityZones.length > 0 
      ? [...priorityZones, ...([49, 50, 51, 52, 53, 54, 55, 56].filter(z => !priorityZones.includes(z)))]
      : [55, 56, 54, 53, 52, 51, 50, 49]; // Default priority: Sydney/Melbourne areas first
    
    for (const zone of australianZones) {
      // Early exit if we have enough high-quality results
      if (matches.length >= MAX_RESULTS && matches.some(m => m.confidence > 0.8)) {
        break;
      }
      
      // Generate possible full coordinates based on the input format
      const possibleCoords = generatePossibleCoordinates(gridRef, zone, userUtmInfo, MAX_RESULTS);
      
      for (const coord of possibleCoords) {
        // Early exit if we have enough results
        if (matches.length >= MAX_RESULTS * 2) { // Allow some buffer for sorting
          break;
        }
        
        try {
          // Convert UTM to lat/lng using the library
          const result = (utmConverter as any).convertUtmToLatLng(
            coord.easting,
            coord.northing,
            zone,
            coord.zoneLetter
          ) as { lat: number; lng: number } | null;
          
          if (result && typeof result === 'object' && 'lat' in result && 'lng' in result && isWithinAustralia(result.lat, result.lng)) {
            const confidence = calculateConfidence(
              { latitude: result.lat, longitude: result.lng },
              zone,
              userLocation,
              coord
            );
            
            const distance = userLocation 
              ? calculateDistance(
                  userLocation.lat, userLocation.lng,
                  result.lat, result.lng
                )
              : undefined;

            matches.push({
              latitude: result.lat,
              longitude: result.lng,
              fullGrid: `${zone}${coord.zoneLetter} ${coord.easting.toString().padStart(6, '0')} ${coord.northing.toString().padStart(7, '0')}`,
              confidence,
              distance
            });
          }
        } catch (error) {
          // Skip invalid coordinates
          continue;
        }
      }
    }

    // Sort by confidence (higher first), then by distance if available
    const sortedMatches = matches.sort((a, b) => {
      const confDiff = b.confidence - a.confidence;
      if (Math.abs(confDiff) > 0.1) return confDiff;
      
      if (a.distance !== undefined && b.distance !== undefined) {
        return a.distance - b.distance;
      }
      
      return confDiff;
    });

    // Return only the top 4 results
    return sortedMatches.slice(0, MAX_RESULTS);
  } catch (error) {
    console.error('Error in grid reference search:', error);
    return [];
  }
}

/**
 * Generate possible full UTM coordinates from partial grid reference
 * 
 * Based on the pattern where:
 * - 3-digit easting input represents digits 1-3 of a 6-digit easting
 * - 3-digit northing input represents digits 2-4 of a 7-digit northing
 * 
 * @param gridRef - Parsed grid reference (easting/northing digits)
 * @param zone - UTM zone number
 * @param userUtmInfo - User's UTM information for context
 * @param maxResults - Maximum number of results to generate per zone
 * @returns Array of possible coordinate combinations
 */
function generatePossibleCoordinates(
  gridRef: { easting: string; northing: string },
  zone: number,
  userUtmInfo?: any,
  maxResults: number = 4
): Array<{ easting: number; northing: number; contextMatch: boolean; zoneLetter: string }> {
  const coordinates: Array<{ easting: number; northing: number; contextMatch: boolean; zoneLetter: string }> = [];
  
  const eastingLength = gridRef.easting.length;
  const northingLength = gridRef.northing.length;
  
  if (eastingLength === 3 && northingLength === 3) {
    // 3-digit format: specific pattern based on Australian grid reference system
    // Easting: digits 1-3 of 6-digit coordinate (X___YZ format where YZ are the input)
    // Northing: digits 2-4 of 7-digit coordinate (A_BC_DE format where BCD are the input)
    
    // Optimize by prioritizing ranges based on user location or common Australian patterns
    let eastingFirstValues = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    let northingFirstValues = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];
    let eastingLastValues = [0, 50]; // Prioritize 0 and 50 (common grid points)
    let northingLastValues = [0, 50]; // Prioritize 0 and 50 (common grid points)
    
    // If we have user context, prioritize based on their location
    if (userUtmInfo && userUtmInfo.ZoneNumber === zone) {
      const userEasting = Math.floor(userUtmInfo.Easting / 100000);
      const userNorthing = Math.floor(userUtmInfo.Northing / 100000);
      
      // Prioritize values close to user's location
      eastingFirstValues = [userEasting, userEasting - 1, userEasting + 1, ...eastingFirstValues.filter(v => ![userEasting, userEasting - 1, userEasting + 1].includes(v))].filter(v => v >= 1 && v <= 9);
      northingFirstValues = [userNorthing, userNorthing - 1, userNorthing + 1, ...northingFirstValues.filter(v => ![userNorthing, userNorthing - 1, userNorthing + 1].includes(v))].filter(v => v >= 60 && v <= 70);
    }
    
    // Limit the search space to avoid generating too many combinations
    let resultCount = 0;
    
    for (const eastingFirst of eastingFirstValues.slice(0, 3)) { // Only test top 3 easting prefixes
      for (const eastingLast2 of eastingLastValues) {
        const fullEasting = eastingFirst * 100000 + parseInt(gridRef.easting) * 100 + eastingLast2;
        
        for (const northingFirst2 of northingFirstValues.slice(0, 3)) { // Only test top 3 northing prefixes
          for (const northingLast2 of northingLastValues) {
            if (resultCount >= maxResults * 3) break; // Generate a bit more than needed for filtering
            
            const fullNorthing = northingFirst2 * 100000 + parseInt(gridRef.northing) * 100 + northingLast2;
            
            // Determine zone letter based on approximate latitude
            let zoneLetter = 'H'; // Default for most of Australia
            let contextMatch = false;
            
            // Check if this matches user's approximate area if available
            if (userUtmInfo && userUtmInfo.ZoneNumber === zone) {
              const eastingDiff = Math.abs(fullEasting - userUtmInfo.Easting);
              const northingDiff = Math.abs(fullNorthing - userUtmInfo.Northing);
              
              // Consider it a context match if within reasonable range (50km)
              if (eastingDiff < 50000 && northingDiff < 50000) {
                contextMatch = true;
                zoneLetter = userUtmInfo.ZoneLetter;
              }
            }
            
            coordinates.push({
              easting: fullEasting,
              northing: fullNorthing,
              contextMatch,
              zoneLetter
            });
            
            resultCount++;
          }
          if (resultCount >= maxResults * 3) break;
        }
        if (resultCount >= maxResults * 3) break;
      }
      if (resultCount >= maxResults * 3) break;
    }
  } else if (eastingLength === 4 && northingLength === 4) {
    // 4-digit format: treat as more precise reference
    // Similar optimization but with 4 digits
    
    let eastingFirstValues = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    let northingFirstValues = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];
    
    if (userUtmInfo && userUtmInfo.ZoneNumber === zone) {
      const userEasting = Math.floor(userUtmInfo.Easting / 100000);
      const userNorthing = Math.floor(userUtmInfo.Northing / 100000);
      
      eastingFirstValues = [userEasting, userEasting - 1, userEasting + 1, ...eastingFirstValues.filter(v => ![userEasting, userEasting - 1, userEasting + 1].includes(v))].filter(v => v >= 1 && v <= 9);
      northingFirstValues = [userNorthing, userNorthing - 1, userNorthing + 1, ...northingFirstValues.filter(v => ![userNorthing, userNorthing - 1, userNorthing + 1].includes(v))].filter(v => v >= 60 && v <= 70);
    }
    
    let resultCount = 0;
    
    for (const eastingFirst of eastingFirstValues.slice(0, 2)) { // Even more restrictive for 4-digit
      for (let eastingLast = 0; eastingLast <= 9; eastingLast += 5) { // Test 0 and 5
        const fullEasting = eastingFirst * 100000 + parseInt(gridRef.easting) * 10 + eastingLast;
        
        for (const northingFirst2 of northingFirstValues.slice(0, 2)) {
          for (let northingLast = 0; northingLast <= 9; northingLast += 5) { // Test 0 and 5
            if (resultCount >= maxResults * 2) break;
            
            const fullNorthing = northingFirst2 * 100000 + parseInt(gridRef.northing) * 10 + northingLast;
            
            let zoneLetter = 'H';
            let contextMatch = false;
            
            if (userUtmInfo && userUtmInfo.ZoneNumber === zone) {
              const eastingDiff = Math.abs(fullEasting - userUtmInfo.Easting);
              const northingDiff = Math.abs(fullNorthing - userUtmInfo.Northing);
              
              if (eastingDiff < 25000 && northingDiff < 25000) {
                contextMatch = true;
                zoneLetter = userUtmInfo.ZoneLetter;
              }
            }
            
            coordinates.push({
              easting: fullEasting,
              northing: fullNorthing,
              contextMatch,
              zoneLetter
            });
            
            resultCount++;
          }
          if (resultCount >= maxResults * 2) break;
        }
        if (resultCount >= maxResults * 2) break;
      }
      if (resultCount >= maxResults * 2) break;
    }
  }
  
  // Prioritize context matches
  return coordinates.sort((a, b) => {
    if (a.contextMatch !== b.contextMatch) {
      return a.contextMatch ? -1 : 1;
    }
    return 0;
  });
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
 * @param coordInfo - Information about the coordinate generation
 * @returns Confidence score (0-1)
 */
function calculateConfidence(
  coords: { latitude: number; longitude: number },
  zone: number,
  userLocation?: { lat: number; lng: number },
  coordInfo?: { contextMatch: boolean; zoneLetter: string }
): number {
  let confidence = 0.3; // Base confidence
  
  // Much higher confidence if this matches user's area context
  if (coordInfo?.contextMatch) {
    confidence += 0.5;
  }
  
  // Higher confidence for more commonly used zones in populated areas
  const popularZones = [55, 56]; // Sydney/Melbourne area
  if (popularZones.includes(zone)) {
    confidence += 0.2;
  }
  
  // Higher confidence for coordinates in populated regions
  if (coords.latitude > -37 && coords.latitude < -25 && 
      coords.longitude > 140 && coords.longitude < 155) {
    confidence += 0.1; // Eastern Australia
  }
  
  // Distance-based confidence if user location is available
  if (userLocation) {
    const distance = calculateDistance(
      userLocation.lat, userLocation.lng,
      coords.latitude, coords.longitude
    );
    
    // Higher confidence for closer locations (within 100km gets max bonus)
    const proximityBonus = Math.max(0, (100 - distance) / 100) * 0.2;
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

// Backward compatibility - keep the old function name as an alias
export const parseSixDigitGrid = parseGridReference;