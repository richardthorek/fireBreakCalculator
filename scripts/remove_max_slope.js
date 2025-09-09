// Remove maxSlope field from all machinery equipment records
const { TableClient } = require('@azure/data-tables');

// Load connection string from environment variable to avoid committing secrets.
// Set TABLES_CONNECTION_STRING in your environment or use a local .env (not committed).
const connectionString = process.env.TABLES_CONNECTION_STRING;
if (!connectionString) {
  console.error('ERROR: TABLES_CONNECTION_STRING environment variable is not set.\n\nSet it to your Azure Tables connection string before running this script.\nExample (PowerShell): $env:TABLES_CONNECTION_STRING="DefaultEndpointsProtocol=..."');
  process.exit(1);
}

const equipmentTableClient = TableClient.fromConnectionString(connectionString, 'equipment');

async function removeMaxSlopeField() {
  console.log('Starting removal of maxSlope field from machinery equipment...');
  
  // Get all equipment
  const entities = equipmentTableClient.listEntities();
  
  for await (const entity of entities) {
    // Only update machinery that has maxSlope field
    if (entity.partitionKey === 'Machinery' && entity.maxSlope !== undefined) {
      try {
        console.log(`Processing ${entity.name} (maxSlope: ${entity.maxSlope})`);
        
        // Create updated entity without maxSlope
        const updatedEntity = { 
          partitionKey: entity.partitionKey,
          rowKey: entity.rowKey,
          name: entity.name,
          description: entity.description,
          allowedTerrain: entity.allowedTerrain,
          allowedVegetation: entity.allowedVegetation,
          clearingRate: entity.clearingRate,
          costPerHour: entity.costPerHour,
          active: entity.active,
          version: (entity.version || 1) + 1,
          createdAt: entity.createdAt,
          updatedAt: new Date().toISOString(),
          cutWidthMeters: entity.cutWidthMeters
          // Explicitly NOT including maxSlope
        };
        
        await equipmentTableClient.updateEntity(updatedEntity, 'Replace');
        console.log(`✓ Removed maxSlope from: ${entity.name} (ID: ${entity.rowKey})`);
      } catch (error) {
        console.error(`✗ Failed to update ${entity.name}:`, error.message);
      }
    } else if (entity.partitionKey === 'Machinery') {
      console.log(`- ${entity.name} already has no maxSlope field`);
    }
  }
  
  console.log('MaxSlope field removal completed!');
}

removeMaxSlopeField().catch(console.error);
