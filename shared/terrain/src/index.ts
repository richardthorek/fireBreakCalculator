/**
 * Public surface of @firebreak/terrain — see README.md for what belongs
 * here (pure compute only) and what deliberately stays client-side.
 */

export * from './geo';
export * from './chainage';
export * from './hexGrid';
export * from './classification';
export * from './confidenceTier';

export * from './accumulatedCost';
export * from './concealment';
export * from './corridorAnalysis';
export * from './corridorField';
export * from './counterMeasures';
export * from './delayLedger';
export * from './keyTerrain';
export * from './minCutBarrier';
export * from './mobilityClass';
export * from './mobilityCost';
export * from './movementSimulation';
export * from './moverProfiles';
export * from './paintedArea';
export * from './restrictionPlanner';
export * from './roadGraph';
export * from './roadRouting';
export * from './roadSpeedModel';
export * from './viewshed';

export * from './dataLayers/demDerivatives';
// dataLayers/structureTable.ts and mobilityCost.ts each declare their own,
// differently-shaped `StructureEstimate` (pre-existing duplication, not
// introduced by this package extraction) — explicit re-export under a
// distinct name resolves the `export *` collision; nothing outside this
// package currently imports either by name.
export type { StructureEstimate as StructureTableEstimate, ScreeningHeight } from './dataLayers/structureTable';
export { lookupStructure, lookupScreeningHeight } from './dataLayers/structureTable';
