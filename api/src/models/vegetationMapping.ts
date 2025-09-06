// Vegetation Formation Mapping domain models and mapping helpers for Azure Table Storage
import { VegetationType } from './equipment';

export interface VegetationFormationMapping {
  id: string; // RowKey (unique identifier)
  formationName: string; // The top-level vegetation formation name
  className?: string; // The mid-level vegetation class name
  typeName?: string; // The most specific vegetation type name
  vegetationType: VegetationType; // The mapped vegetation type category
  description?: string; // Optional description
  isOverride?: boolean; // Whether this mapping overrides its parent's setting
  active: boolean;
  version: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// Table entity flattened representation
export interface VegetationMappingTableEntity {
  partitionKey: string; // Always "VegetationMapping"
  rowKey: string; // id (unique identifier)
  formationName: string;
  className?: string;
  typeName?: string;
  vegetationType: string;
  description?: string;
  isOverride?: boolean;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Convert from table entity to domain model
export function fromTableEntity(entity: VegetationMappingTableEntity): VegetationFormationMapping {
  return {
    id: entity.rowKey,
    formationName: entity.formationName,
    className: entity.className,
    typeName: entity.typeName,
    vegetationType: entity.vegetationType as VegetationType,
    description: entity.description,
    isOverride: entity.isOverride,
    active: entity.active,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt
  };
}

// Convert from domain model to table entity
export function toTableEntity(mapping: VegetationFormationMapping): VegetationMappingTableEntity {
  return {
    partitionKey: 'VegetationMapping',
    rowKey: mapping.id,
    formationName: mapping.formationName,
    className: mapping.className,
    typeName: mapping.typeName,
    vegetationType: mapping.vegetationType,
    description: mapping.description,
    isOverride: mapping.isOverride,
    active: mapping.active,
    version: mapping.version,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt
  };
}
