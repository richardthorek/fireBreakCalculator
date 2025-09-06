import { VegetationFormationMappingApi } from '../types/vegetationMappingApi';
import { VegetationType } from '../config/classification';
import { listVegetationMappings } from './vegetationMappingApi';
import { logger } from './logger';

// Cache for vegetation mappings to avoid repeated API calls
let vegetationMappingsCache: VegetationFormationMappingApi[] | null = null;
let lastMappingFetchTime = 0;
const MAPPING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear the vegetation mapping cache - for diagnostics and testing
 */
export function _clearVegetationMappingCache(): void {
  vegetationMappingsCache = null;
  lastMappingFetchTime = 0;
  logger.debug('Vegetation mapping cache cleared');
}

/**
 * Get vegetation mappings, using cache if available
 */
export async function getVegetationMappings(): Promise<VegetationFormationMappingApi[]> {
  const now = Date.now();
  if (vegetationMappingsCache && now - lastMappingFetchTime < MAPPING_CACHE_TTL) {
    return vegetationMappingsCache;
  }
  
  try {
    const mappings = await listVegetationMappings();
    vegetationMappingsCache = mappings;
    lastMappingFetchTime = now;
    return mappings;
  } catch (error) {
    logger.warn('Failed to fetch vegetation mappings:', error);
    // Return empty array if no mappings available
    return vegetationMappingsCache || [];
  }
}

/**
 * Map vegetation formation name to application vegetation type using hierarchical mapping
 * Supports formation -> class -> type hierarchy with overrides
 * Falls back to default mapping if no match is found
 */
export async function mapFormationToVegetationType(
  formationName: string, 
  className?: string | null,
  typeName?: string | null
): Promise<{ vegetation: VegetationType; confidence: number }> {
  // Default fallback mapping
  const defaultResult: { vegetation: VegetationType; confidence: number } = { 
    vegetation: 'mediumscrub', 
    confidence: 0.5 
  };
  
  try {
    const mappings = await getVegetationMappings();
    if (!mappings || mappings.length === 0) {
      logger.warn('No vegetation mappings available, using default mapping');
      return defaultResult;
    }
    
    // First try to find an exact match with formation, class, and type
    if (formationName && className && typeName) {
      const typeMatch = mappings.find(m => 
        m.formationName.toLowerCase() === formationName.toLowerCase() && 
        m.className?.toLowerCase() === className.toLowerCase() &&
        m.typeName?.toLowerCase() === typeName.toLowerCase() &&
        m.active
      );
      
      if (typeMatch) {
        return { 
          vegetation: typeMatch.vegetationType, 
          confidence: typeMatch.isOverride ? 0.99 : 0.95 // Higher confidence for overrides
        };
      }
    }
    
    // Try to find a match with formation and class
    if (formationName && className) {
      const classMatch = mappings.find(m => 
        m.formationName.toLowerCase() === formationName.toLowerCase() && 
        m.className?.toLowerCase() === className.toLowerCase() &&
        !m.typeName && // No specific type
        m.active
      );
      
      if (classMatch) {
        return { 
          vegetation: classMatch.vegetationType, 
          confidence: classMatch.isOverride ? 0.94 : 0.9 // Good confidence for class match
        };
      }
    }
    
    // Try to find a match with just the formation name
    if (formationName) {
      const formationMatch = mappings.find(m => 
        m.formationName.toLowerCase() === formationName.toLowerCase() && 
        !m.className && // No specific class
        !m.typeName && // No specific type
        m.active
      );
      
      if (formationMatch) {
        return { 
          vegetation: formationMatch.vegetationType, 
          confidence: 0.8 // Base confidence for formation match
        };
      }
    }
    
    // No match found
    const details = [
      formationName,
      className ? `class: ${className}` : '',
      typeName ? `type: ${typeName}` : ''
    ].filter(Boolean).join(', ');
    
    logger.warn(`No vegetation mapping found for: ${details}`);
    return defaultResult;
  } catch (error) {
    logger.error('Error mapping vegetation formation:', error);
    return defaultResult;
  }
}
