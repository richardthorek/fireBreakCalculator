import { TableClient } from '@azure/data-tables';

// Same storage account as /api (docs/ROUTE_INTELLIGENCE.md §47.3: additive
// tables/containers in the EXISTING account, not a new one) — same env var
// name as api/src/data/tableClient.ts so one connection string configures
// both apps.
const connectionString = process.env.TABLES_CONNECTION_STRING;
const mobilityJobRateLimitTableName = process.env.MOBILITY_JOB_RATE_LIMIT_TABLE_NAME || 'mobilityjobratelimit';

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn('TABLES_CONNECTION_STRING not set. Table operations will fail.');
}

export function getMobilityJobRateLimitTableClient(): TableClient {
  return TableClient.fromConnectionString(connectionString!, mobilityJobRateLimitTableName);
}
