// Equipment domain models and mapping helpers for Azure Table Storage
export type TerrainType = 'flat' | 'medium' | 'steep' | 'very_steep';
export type VegetationType = 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest';

export interface EquipmentBase {
  id: string; // RowKey
  type: 'Machinery' | 'Aircraft' | 'HandCrew'; // PartitionKey value
  name: string;
  description?: string;
  allowedTerrain: TerrainType[];
  allowedVegetation: VegetationType[];
  clearingRate?: number; // machinery OR derived
  costPerHour?: number;
  active: boolean;
  version: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface Machinery extends EquipmentBase {
  type: 'Machinery';
  maxSlope?: number;
  cutWidthMeters?: number;
}

export interface Aircraft extends EquipmentBase {
  type: 'Aircraft';
  dropLength: number;
  turnaroundMinutes?: number;
  capacityLitres?: number;
  costPerDrop?: number;
}

export interface HandCrew extends EquipmentBase {
  type: 'HandCrew';
  crewSize: number;
  clearingRatePerPerson: number;
  equipmentList?: string[];
}

export type Equipment = Machinery | Aircraft | HandCrew;

// Table entity flattened representation
export interface EquipmentTableEntity {
  partitionKey: string; // type
  rowKey: string; // id
  name: string;
  description?: string;
  allowedTerrain: string; // CSV
  allowedVegetation: string; // CSV
  clearingRate?: number;
  costPerHour?: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Type specific optional fields
  maxSlope?: number;
  cutWidthMeters?: number;
  dropLength?: number;
  turnaroundMinutes?: number;
  capacityLitres?: number;
  costPerDrop?: number;
  crewSize?: number;
  clearingRatePerPerson?: number;
  equipmentList?: string; // CSV
}

export function toTableEntity(e: Equipment): EquipmentTableEntity {
  const base: EquipmentTableEntity = {
    partitionKey: e.type,
    rowKey: e.id,
    name: e.name,
    description: e.description,
    allowedTerrain: e.allowedTerrain.join(','),
    allowedVegetation: e.allowedVegetation.join(','),
    clearingRate: e.clearingRate,
    costPerHour: e.costPerHour,
    active: e.active,
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
  switch (e.type) {
    case 'Machinery':
      return { ...base, maxSlope: e.maxSlope, cutWidthMeters: e.cutWidthMeters };
    case 'Aircraft':
      return { ...base, dropLength: e.dropLength, turnaroundMinutes: e.turnaroundMinutes, capacityLitres: e.capacityLitres, costPerDrop: e.costPerDrop };
    case 'HandCrew':
      return { ...base, crewSize: e.crewSize, clearingRatePerPerson: e.clearingRatePerPerson, equipmentList: e.equipmentList?.join(',') };
  }
}

export function fromTableEntity(entity: EquipmentTableEntity): Equipment {
  const common = {
    id: entity.rowKey,
    type: entity.partitionKey as Equipment['type'],
    name: entity.name,
    description: entity.description,
    allowedTerrain: entity.allowedTerrain ? (entity.allowedTerrain.split(',').filter(Boolean) as TerrainType[]) : [],
    allowedVegetation: entity.allowedVegetation ? (entity.allowedVegetation.split(',').filter(Boolean) as VegetationType[]) : [],
    clearingRate: entity.clearingRate,
    costPerHour: entity.costPerHour,
    active: entity.active,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  } as EquipmentBase;
  if (entity.partitionKey === 'Machinery') {
    return { ...common, type: 'Machinery', maxSlope: entity.maxSlope, cutWidthMeters: entity.cutWidthMeters };
  }
  if (entity.partitionKey === 'Aircraft') {
    return { ...common, type: 'Aircraft', dropLength: entity.dropLength || 0, turnaroundMinutes: entity.turnaroundMinutes, capacityLitres: entity.capacityLitres, costPerDrop: entity.costPerDrop };
  }
  return { ...common, type: 'HandCrew', crewSize: entity.crewSize || 0, clearingRatePerPerson: entity.clearingRatePerPerson || 0, equipmentList: entity.equipmentList ? entity.equipmentList.split(',').filter(Boolean) : [] };
}

export function newEquipmentId(): string {
  // Simple ULID-like (timestamp + random) for ordering & uniqueness
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return (ts + rand).toUpperCase();
}

export function timestamp(): string { return new Date().toISOString(); }

export function initialVersion(): number { return 1; }

export function nextVersion(v: number): number { return v + 1; }
