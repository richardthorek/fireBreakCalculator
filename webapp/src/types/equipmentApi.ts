/**
 * API equipment types mirroring the Azure Functions backend.
 */
import { TerrainLevel, VegetationType } from '../config/classification';

export type EquipmentCoreType = 'Machinery' | 'Aircraft' | 'HandCrew';

export interface EquipmentBase {
  id: string;
  type: EquipmentCoreType;
  name: string;
  description?: string;
  allowedTerrain: TerrainLevel[];
  allowedVegetation: VegetationType[];
  costPerHour?: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MachineryApi extends EquipmentBase {
  type: 'Machinery';
  clearingRate?: number; // meters per hour
  maxSlope?: number;
  cutWidthMeters?: number;
}

export interface AircraftApi extends EquipmentBase {
  type: 'Aircraft';
  dropLength?: number; // meters
  turnaroundMinutes?: number; // minutes
  capacityLitres?: number;
  costPerDrop?: number;
  speed?: number; // km/h
}

export interface HandCrewApi extends EquipmentBase {
  type: 'HandCrew';
  crewSize?: number;
  clearingRatePerPerson?: number;
  equipmentList?: string[]; // tools / equipment descriptors
}

export type EquipmentApi = MachineryApi | AircraftApi | HandCrewApi;

export type CreateEquipmentInput = {
  type: EquipmentCoreType;
  name: string;
  description?: string;
  allowedTerrain?: EquipmentApi['allowedTerrain'];
  allowedVegetation?: EquipmentApi['allowedVegetation'];
  costPerHour?: number;
  active?: boolean;
} & Partial<MachineryApi & AircraftApi & HandCrewApi>;

export type UpdateEquipmentInput = {
  id: string;
  type: EquipmentCoreType;
  version: number;
} & Partial<MachineryApi & AircraftApi & HandCrewApi>;
