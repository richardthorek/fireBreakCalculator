// Clean up script to remove old equipment entries with outdated terrain terminology
const { TableClient } = require('@azure/data-tables');

// Load connection string from environment variable to avoid committing secrets.
// Set TABLES_CONNECTION_STRING in your environment or use a local .env (not committed).
const connectionString = process.env.TABLES_CONNECTION_STRING;
if (!connectionString) {
  console.error('ERROR: TABLES_CONNECTION_STRING environment variable is not set.\n\nSet it to your Azure Tables connection string before running this script.\nExample (PowerShell): $env:TABLES_CONNECTION_STRING="DefaultEndpointsProtocol=..."');
  process.exit(1);
}

const equipmentTableClient = TableClient.fromConnectionString(connectionString, 'equipment');

async function cleanOldEquipment() {
  console.log('Starting cleanup of old equipment entries...');
  
  const oldEquipmentIds = [
    'MF1QP1YGH3SWQOGG',  // Chook
    'MF1QQTYWL3OD6Q9E',  // Air Crane  
    'MF1QSCKYDB7WMKVS',  // Helitack
    'MER3ONY3NRSG70TF',  // Crew 1 (has old terrain terminology)
    'MER7F664KKNIVJYK',  // D4 (old entry)
    'MER7F8LEJOLN5ONL',  // D6 (old entry)
    'MER7FAAX2EFZYQNU',  // D7 (old entry)
    'MER7FC15CCFREOAF',  // D8 (old entry)
    'MER7FDR6U1M6CDWC',  // Grader (old entry)
    'MER7FFGY2MRD0YI8'   // Heavy Grader (old entry)
  ];

  for (const equipmentId of oldEquipmentIds) {
    try {
      await equipmentTableClient.deleteEntity('Equipment', equipmentId);
      console.log(`✓ Deleted equipment: ${equipmentId}`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`- Equipment ${equipmentId} not found (already deleted)`);
      } else {
        console.error(`✗ Failed to delete ${equipmentId}:`, error.message);
      }
    }
  }
  
  console.log('Cleanup completed!');
}

cleanOldEquipment().catch(console.error);
