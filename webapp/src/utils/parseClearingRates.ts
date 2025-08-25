import { MachinerySpec, MachineryPerformance } from '../types/config';

// Import the CSV as raw text using Vite's raw import handling
// Note: Vite supports `?raw` to import file contents as string.
import csvText from '../../clearingrates.csv?raw';

/**
 * Parse the clearing rates CSV into MachinerySpec entries.
 * Expected CSV columns (tab or comma separated):
 * id, category, slopeMax, density, metersPerHour, costPerHour
 */
function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  // If header-like first line contains non-numeric fields, treat as header
  const headerCandidates = lines[0].split(/\t|,/).map(h => h.trim());
  let startIndex = 0;
  let headers: string[] = [];

  // Heuristic: if first token equals known ids like D4/D6/D7/D8/grader, there's no header
  if (/^(D[4678]|grader)$/i.test(headerCandidates[0])) {
    // use default headers
    headers = ['id', 'category', 'slopeMax', 'density', 'metersPerHour', 'costPerHour'];
  } else {
    headers = headerCandidates.map(h => h.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, ''));
    startIndex = 1;
  }

  const rows: Array<Record<string, string>> = [];

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(/\t|,/).map(p => p.trim());
    if (parts.length < headers.length) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parts[j];
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Map CSV row into MachinerySpec. We derive allowedTerrain and allowedVegetation
 * from slopeMax and density heuristics.
 */
function mapRowsToMachinery(rows: Record<string, string>[]): MachinerySpec[] {
  // Group rows by id (machine type)
  const groups: Record<string, Record<string, string>[]> = {};
  for (const r of rows) {
    const idKey = (r.id || r.ID || r.type || r['type'] || 'machine').toString().toLowerCase().replace(/\s+/g, '-');
    groups[idKey] = groups[idKey] || [];
    groups[idKey].push(r);
  }

  const result: MachinerySpec[] = [];

  for (const id of Object.keys(groups)) {
    const group = groups[id];
    // determine rawType and name heuristics from first row
    const first = group[0];
    const rawType = (first.category || first.type || '').toString().toLowerCase();

    let type: MachinerySpec['type'] = 'other';
    if (/^d[4678]$/i.test(id) || /dozer/i.test(id) || /dozer/i.test(rawType)) type = 'dozer';
    if (/grader/i.test(id) || /grader/i.test(rawType)) type = 'grader';

    const performances: MachineryPerformance[] = group.map(row => {
      const slopeMax = Number(row.slopeMax || row['slopemax'] || row['slope max'] || 0);
  const rawDensity = ((row.density || 'mediumscrub') as string).toLowerCase().trim();
  let density: MachineryPerformance['density'];
  // Map legacy or shorthand density strings to the new taxonomy used across the app
  if (rawDensity.startsWith('grass') || rawDensity.startsWith('gra') || rawDensity.startsWith('g')) density = 'grassland';
  else if (rawDensity.startsWith('lig') || rawDensity.startsWith('light')) density = 'lightshrub';
  else if (rawDensity.startsWith('med') || rawDensity.startsWith('mod') || rawDensity.startsWith('medium')) density = 'mediumscrub';
  else if (rawDensity.startsWith('hea') || rawDensity.startsWith('for') || rawDensity.startsWith('heavy')) density = 'heavyforest';
  else density = 'mediumscrub';
      const metersPerHour = Number(row.metersPerHour || row['mperhour'] || row['m per hour'] || 0);
      const costPerHour = Number(row.costPerHour || row['$perhour'] || row['$ per hour'] || 0) || undefined;

      return { slopeMax, density, metersPerHour, costPerHour };
    }).sort((a,b) => a.slopeMax - b.slopeMax);

    // default clearingRate is best-case (max metersPerHour)
    const clearingRate = Math.max(...performances.map(p => p.metersPerHour), 0);

    // derive allowedTerrain and allowedVegetation from performance rows
    const maxSlope = Math.max(...performances.map(p => p.slopeMax));
    const allowedTerrain: MachinerySpec['allowedTerrain'] = [];
    if (maxSlope <= 10) allowedTerrain.push('easy','moderate');
    else if (maxSlope <= 20) allowedTerrain.push('easy','moderate','difficult');
    else allowedTerrain.push('easy','moderate','difficult','extreme');

  const densities = new Set(performances.map(p => p.density));
  const allowedVegetation: MachinerySpec['allowedVegetation'] = [];
  
  // Use hierarchical vegetation compatibility: if a machine can handle heavier vegetation,
  // it can also handle lighter vegetation. Order: grassland < lightshrub < mediumscrub < heavyforest
  const allVegetationTypes: Array<'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest'> = 
    ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'];
  
  // Find the heaviest vegetation type this machine can handle
  let maxVegetationIndex = -1;
  if (densities.has('heavyforest')) maxVegetationIndex = 3;
  else if (densities.has('mediumscrub')) maxVegetationIndex = 2;
  else if (densities.has('lightshrub')) maxVegetationIndex = 1;
  else if (densities.has('grassland')) maxVegetationIndex = 0;
  
  // Include all vegetation types up to and including the maximum
  for (let i = 0; i <= maxVegetationIndex; i++) {
    allowedVegetation.push(allVegetationTypes[i]);
  }

  // Determine a minimum clear diameter heuristic (meters)
  // grassland -> 0.05m, light shrub -> 0.1m, medium scrub -> 0.3m, heavy forest -> 0.5m
  let minClearDiameter = 0.05;
  if (densities.has('lightshrub')) minClearDiameter = Math.max(minClearDiameter, 0.1);
  if (densities.has('mediumscrub')) minClearDiameter = Math.max(minClearDiameter, 0.3);
  if (densities.has('heavyforest')) minClearDiameter = Math.max(minClearDiameter, 0.5);

    const name = id.includes('grader') ? 'Motor Grader' : id.toUpperCase();

    result.push({
      id,
      name,
      type,
      clearingRate,
      performances,
      costPerHour: performances.find(p => p.costPerHour !== undefined)?.costPerHour,
      description: `${name} derived from clearingrates.csv`,
      allowedTerrain,
      allowedVegetation,
      maxSlope // Add the maximum slope capability
    });
  }

  return result;
}

export function loadMachineryFromCSV(): MachinerySpec[] {
  try {
    const rows = parseCSV(csvText as string);
    return mapRowsToMachinery(rows);
  } catch (err) {
    // On error return empty array so defaultConfig can fallback
    // eslint-disable-next-line no-console
    console.error('Failed to parse clearingrates.csv', err);
    return [];
  }
}

export default loadMachineryFromCSV();
