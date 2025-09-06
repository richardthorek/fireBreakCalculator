/**
 * Temporary stub for vegetation analysis during Mapbox GL JS migration
 * This will be properly implemented after the core migration is complete
 */

// Coordinate type compatibility for both Leaflet and Mapbox GL JS
type LatLngLike = { lat: number; lng: number } | { lat: number; lon: number };

import { VegetationType } from '../config/classification';
import { VegetationSegment, VegetationAnalysis } from '../types/config';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { fetchNSWVegetation } from './nswVegetationService';
import { logger } from './logger';

/**
 * Map Mapbox Terrain v2 landcover class to application vegetation type
 */
export const mapLandcoverToVegetation = (landcoverClass: string): { vegetation: VegetationType; confidence: number } => {
  // Simplified stub implementation
  return { vegetation: 'grassland' as VegetationType, confidence: 0.5 };
};

/**
 * Temporarily disabled during migration - returns mock data
 */
export const analyzeTrackVegetation = async (points: LatLngLike[]): Promise<VegetationAnalysis> => {
  logger.info('Vegetation analysis temporarily disabled during Mapbox GL JS migration');
  
  return {
    totalDistance: 0,
    segments: [],
    predominantVegetation: 'grassland' as VegetationType,
    overallConfidence: 0.5,
    vegetationDistribution: {
      grassland: 0,
      lightshrub: 0,
      mediumscrub: 0,
      heavyforest: 0
    }
  };
};

/**
 * Temporarily disabled during migration
 */
export const generateVegetationOverlay = async (
  points: LatLngLike[], 
  bufferDistanceKm: number = 1.0,
  gridSpacingM: number = 500
): Promise<any[]> => {
  logger.info('Vegetation overlay temporarily disabled during Mapbox GL JS migration');
  return [];
};

/**
 * Temporarily disabled during migration
 */
export const generateVegetationSamplePoints = (
  points: LatLngLike[], 
  intervalDistance: number = 200
): LatLngLike[] => {
  return points;
};