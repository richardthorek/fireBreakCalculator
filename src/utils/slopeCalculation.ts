/**
 * Slope calculation utilities for fire break analysis
 * Calculates slope along track segments with elevation data
 */

import { LatLng } from 'leaflet';
import { SlopeSegment, SlopeCategory, TrackAnalysis } from '../types/config';

/** 
 * Calculate distance between two lat/lng points using Haversine formula 
 * Returns distance in meters
 */
export const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/** Convert degrees to radians */
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Calculate slope between two points in degrees
 */
export const calculateSlope = (
  startElevation: number, 
  endElevation: number, 
  horizontalDistance: number
): number => {
  if (horizontalDistance === 0) return 0;
  const verticalDistance = Math.abs(endElevation - startElevation);
  const slopeRadians = Math.atan(verticalDistance / horizontalDistance);
  return slopeRadians * (180 / Math.PI); // Convert to degrees
};

/**
 * Categorize slope based on angle in degrees
 */
export const categorizeSlope = (slope: number): SlopeCategory => {
  if (slope <= 10) return 'flat';
  if (slope <= 20) return 'medium';
  if (slope <= 30) return 'steep';
  return 'very_steep';
};

/**
 * Get color for slope visualization
 */
export const getSlopeColor = (category: SlopeCategory): string => {
  switch (category) {
    case 'flat': return '#00ff00'; // Green
    case 'medium': return '#ffff00'; // Yellow
    case 'steep': return '#ff8800'; // Orange
    case 'very_steep': return '#ff0000'; // Red
    default: return '#888888'; // Gray fallback
  }
};

/**
 * Mock elevation service for development/testing
 * In production, this would integrate with a real elevation API
 */
export const getElevation = async (lat: number, lng: number): Promise<number> => {
  // Mock elevation based on latitude/longitude
  // This creates a simplified terrain model for testing
  const baseElevation = 100; // Base elevation in meters
  
  // Create some variation based on coordinates
  const latVariation = Math.sin(lat * 0.1) * 50;
  const lngVariation = Math.cos(lng * 0.1) * 30;
  const randomVariation = (Math.random() - 0.5) * 20;
  
  return Math.max(0, baseElevation + latVariation + lngVariation + randomVariation);
};

/**
 * Generate points every 100m along a polyline
 */
export const generateInterpolatedPoints = (
  points: LatLng[], 
  intervalDistance: number = 100
): LatLng[] => {
  if (points.length < 2) return points;
  
  const interpolatedPoints: LatLng[] = [points[0]];
  let accumulatedDistance = 0;
  
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const segmentDistance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
    
    // Calculate how many intervals fit in this segment
    const remainingToNextInterval = intervalDistance - (accumulatedDistance % intervalDistance);
    
    if (segmentDistance >= remainingToNextInterval) {
      // Add interpolated points at regular intervals
      let distanceAlongSegment = remainingToNextInterval;
      
      while (distanceAlongSegment < segmentDistance) {
        const ratio = distanceAlongSegment / segmentDistance;
        const interpolatedLat = start.lat + (end.lat - start.lat) * ratio;
        const interpolatedLng = start.lng + (end.lng - start.lng) * ratio;
        interpolatedPoints.push(new LatLng(interpolatedLat, interpolatedLng));
        distanceAlongSegment += intervalDistance;
      }
    }
    
    accumulatedDistance += segmentDistance;
  }
  
  // Always include the end point
  interpolatedPoints.push(points[points.length - 1]);
  
  return interpolatedPoints;
};

/**
 * Analyze track for slope information
 */
export const analyzeTrackSlopes = async (points: LatLng[]): Promise<TrackAnalysis> => {
  if (points.length < 2) {
    return {
      totalDistance: 0,
      segments: [],
      maxSlope: 0,
      averageSlope: 0,
      slopeDistribution: { flat: 0, medium: 0, steep: 0, very_steep: 0 }
    };
  }
  
  // Generate points every 100m
  const interpolatedPoints = generateInterpolatedPoints(points, 100);
  
  const segments: SlopeSegment[] = [];
  let totalDistance = 0;
  let totalSlope = 0;
  const slopeDistribution = { flat: 0, medium: 0, steep: 0, very_steep: 0 };
  
  // Calculate slope for each segment
  for (let i = 0; i < interpolatedPoints.length - 1; i++) {
    const start = interpolatedPoints[i];
    const end = interpolatedPoints[i + 1];
    
    const distance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
    const startElevation = await getElevation(start.lat, start.lng);
    const endElevation = await getElevation(end.lat, end.lng);
    const slope = calculateSlope(startElevation, endElevation, distance);
    const category = categorizeSlope(slope);
    
    const segment: SlopeSegment = {
      start: [start.lat, start.lng],
      end: [end.lat, end.lng],
      slope,
      category,
      startElevation,
      endElevation,
      distance
    };
    
    segments.push(segment);
    totalDistance += distance;
    totalSlope += slope;
    slopeDistribution[category]++;
  }
  
  return {
    totalDistance,
    segments,
    maxSlope: Math.max(...segments.map(s => s.slope)),
    averageSlope: segments.length > 0 ? totalSlope / segments.length : 0,
    slopeDistribution
  };
};