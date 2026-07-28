// Terrain Mobility run telemetry — scale/performance metadata only, no
// location or user identity. Purpose: build an evidence base (cell counts,
// terrain/veg difficulty mix, elapsed time by phase, device hints) for the
// cloud-offload threshold design in docs/ROUTE_INTELLIGENCE.md "Cloud offload
// for large-area analysis" — see that section before changing this shape.

export interface MobilityRunTelemetry {
  sessionId: string; // random per browser session — not tied to identity
  timestamp: string; // ISO, client clock
  profileId: string;
  fidelity: string;
  cellCount: number;
  targetCellCount: number;
  reachableCount: number;
  noGoCount: number;
  slowGoCount: number;
  goCount: number;
  distanceM: number | null; // straight-line origin↔objective, null if indeterminate
  searchAttempts: number;
  usedExpandedSearch: boolean;
  routeFound: boolean;
  elapsedMs: number; // total wall-clock for the whole appreciation run
  stageDurationsMs: Record<string, number>; // grid/sampling/search/ensemble/corridors/chokepoints/barrier/restrictions/done
  vegetationHistogram: Record<string, number>; // vegetation kind -> cell count
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
}

export interface MobilityRunTelemetryTableEntity {
  partitionKey: string; // date bucket, YYYY-MM-DD (client clock) — keeps partitions small and queryable by day
  rowKey: string; // sessionId-timestamp, unique enough for this purpose
  sessionId: string;
  timestamp: string;
  profileId: string;
  fidelity: string;
  cellCount: number;
  targetCellCount: number;
  reachableCount: number;
  noGoCount: number;
  slowGoCount: number;
  goCount: number;
  distanceM?: number;
  searchAttempts: number;
  usedExpandedSearch: boolean;
  routeFound: boolean;
  elapsedMs: number;
  stageDurationsJson: string; // Table Storage has no nested types — flattened to JSON
  vegetationHistogramJson: string;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export function toTableEntity(t: MobilityRunTelemetry): MobilityRunTelemetryTableEntity {
  const dateBucket = t.timestamp.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return {
    partitionKey: dateBucket,
    rowKey: `${t.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: t.sessionId,
    timestamp: t.timestamp,
    profileId: t.profileId,
    fidelity: t.fidelity,
    cellCount: t.cellCount,
    targetCellCount: t.targetCellCount,
    reachableCount: t.reachableCount,
    noGoCount: t.noGoCount,
    slowGoCount: t.slowGoCount,
    goCount: t.goCount,
    distanceM: t.distanceM ?? undefined,
    searchAttempts: t.searchAttempts,
    usedExpandedSearch: t.usedExpandedSearch,
    routeFound: t.routeFound,
    elapsedMs: t.elapsedMs,
    stageDurationsJson: JSON.stringify(t.stageDurationsMs ?? {}),
    vegetationHistogramJson: JSON.stringify(t.vegetationHistogram ?? {}),
    hardwareConcurrency: t.hardwareConcurrency ?? undefined,
    deviceMemoryGb: t.deviceMemoryGb ?? undefined,
  };
}
