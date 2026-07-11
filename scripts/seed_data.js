/**
 * Seed the built-in standard equipment catalogue.
 *
 * The API now owns a canonical, well-sourced standard catalogue
 * (api/src/data/standardEquipment.ts) and seeds it automatically the first time
 * the equipment table is read or analysis is run. This script simply triggers
 * that seed explicitly against a running API — useful for a fresh environment
 * or CI, and for force-refreshing the standard rows after a catalogue update.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:7071/api node scripts/seed_data.js
 *   API_BASE_URL=https://<app>/api FORCE=true node scripts/seed_data.js
 *
 *   FORCE=true  overwrite existing standard rows (otherwise seed only if empty)
 */

const fetch = require('node-fetch');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7071/api';
const FORCE = String(process.env.FORCE || '').toLowerCase() === 'true';

async function seed() {
  const url = `${API_BASE_URL}/equipment/seed${FORCE ? '?force=true' : ''}`;
  console.log(`Seeding standard equipment via ${url} ...`);
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Seed request failed (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  console.log(`Seeded ${data.seeded} item(s); catalogue now has ${data.count} equipment item(s).`);
  for (const item of data.equipment || []) {
    console.log(`  - [${item.type}] ${item.name}${item.standard ? ' (standard)' : ''}`);
  }
  console.log('Done.');
}

seed().catch((error) => {
  console.error('Seeding process failed:', error.message);
  process.exit(1);
});
