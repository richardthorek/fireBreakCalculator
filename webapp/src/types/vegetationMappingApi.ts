/**
 * Types for vegetation formation mappings in the API
 */
import { VegetationType } from '../config/classification';

export interface VegetationFormationMappingApi {
  id: string;
  formationName: string;
  className?: string;
  typeName?: string;
  vegetationType: VegetationType;
  description?: string;
  isOverride?: boolean;
  /** Optional confidence score (0-1) representing heuristic mapping certainty in dev/mock data */
  confidence?: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVegetationMappingInput {
  formationName: string;
  className?: string;
  typeName?: string;
  vegetationType: VegetationType;
  description?: string;
  isOverride?: boolean;
}
