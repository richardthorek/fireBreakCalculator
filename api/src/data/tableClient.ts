import { TableClient } from '@azure/data-tables';

// For simplicity we use full connection string via environment variable.
// In production prefer managed identity / role assignment.
const connectionString = process.env.TABLES_CONNECTION_STRING;
const equipmentTableName = process.env.EQUIPMENT_TABLE_NAME || 'equipment';
const vegetationTableName = process.env.VEGETATION_TABLE_NAME || 'vegetation';

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn('TABLES_CONNECTION_STRING not set. Table operations will fail.');
}

export function getEquipmentTableClient(): TableClient {
  return TableClient.fromConnectionString(connectionString!, equipmentTableName);
}

export function getVegetationTableClient(): TableClient {
  return TableClient.fromConnectionString(connectionString!, vegetationTableName);
}
