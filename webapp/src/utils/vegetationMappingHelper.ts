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
 * Map vegetation formation name to application vegetation type using the curated
 * hierarchical DB mappings (formation → class → type, with overrides).
 *
 * Returns `null` when there is no curated match (or no mappings are available) so
 * the caller can fall through to its own heuristic. This is deliberate: a
 * hardcoded default here (previously `mediumscrub @ 0.5`) silently swallowed
 * EVERY unmapped formation — including forests and grasslands — into medium
 * scrub, which is exactly the kind of fabricated, uniform result a planning tool
 * must not present. The NSW service's regex heuristic (`mapNSWToInternal`) is a
 * far better fallback than a flat constant, so we defer to it rather than guess.
 */
export async function mapFormationToVegetationType(
  formationName: string,
  className?: string | null,
  typeName?: string | null
): Promise<{ vegetation: VegetationType; confidence: number } | null> {
  try {
    const mappings = await getVegetationMappings();
    if (!mappings || mappings.length === 0) {
      logger.debug('No curated vegetation mappings available; caller will use its heuristic');
      return null;
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
    
    // No curated match found — let the caller fall back to its own heuristic.
    const details = [
      formationName,
      className ? `class: ${className}` : '',
      typeName ? `type: ${typeName}` : ''
    ].filter(Boolean).join(', ');

    logger.debug(`No curated vegetation mapping for: ${details}; caller will use its heuristic`);
    return null;
  } catch (error) {
    logger.error('Error mapping vegetation formation:', error);
    return null;
  }
}
