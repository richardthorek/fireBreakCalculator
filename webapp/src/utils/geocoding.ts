/**
 * Geocoding utilities for address search using Mapbox Geocoding API
 * 
 * @module geocoding
 * @version 1.0.0
 */

import { MAPBOX_TOKEN } from '../config/mapboxToken';

export interface GeocodingResult {
  id: string;
  place_name: string;
  center: [number, number]; // [longitude, latitude]
  place_type: string[];
  relevance: number;
  properties?: Record<string, any>;
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>;
}

export interface GeocodingResponse {
  type: 'FeatureCollection';
  query: string[];
  features: GeocodingResult[];
  attribution: string;
}

/**
 * Search for addresses using Mapbox Geocoding API with autocomplete support
 * @param query - The search query
 * @param options - Search options
 * @returns Promise resolving to geocoding results
 */
export async function searchAddresses(
  query: string,
  options: {
    limit?: number;
    proximity?: [number, number]; // [longitude, latitude] for biasing results
    bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
    country?: string; // ISO 3166 alpha 2 country code (e.g., 'au' for Australia)
    autocomplete?: boolean;
  } = {}
): Promise<GeocodingResult[]> {
  if (!MAPBOX_TOKEN) {
    throw new Error('Mapbox token is required for geocoding');
  }

  if (!query.trim()) {
    return [];
  }

  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    limit: (options.limit || 5).toString(),
    autocomplete: (options.autocomplete !== false).toString()
  });

  if (options.proximity) {
    params.append('proximity', options.proximity.join(','));
  }

  if (options.bbox) {
    params.append('bbox', options.bbox.join(','));
  }

  if (options.country) {
    params.append('country', options.country);
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?${params}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status} ${response.statusText}`);
    }

    const data: GeocodingResponse = await response.json();
    return data.features || [];
  } catch (error) {
    console.error('Geocoding search failed:', error);
    throw error;
  }
}

/**
 * Reverse geocode coordinates to get address
 * @param longitude - Longitude coordinate
 * @param latitude - Latitude coordinate
 * @returns Promise resolving to geocoding results
 */
export async function reverseGeocode(
  longitude: number,
  latitude: number
): Promise<GeocodingResult[]> {
  if (!MAPBOX_TOKEN) {
    throw new Error('Mapbox token is required for reverse geocoding');
  }

  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    limit: '1'
  });

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?${params}`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Reverse geocoding API error: ${response.status} ${response.statusText}`);
    }

    const data: GeocodingResponse = await response.json();
    return data.features || [];
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    throw error;
  }
}

/**
 * Create a debounced version of a function
 * @param func - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}