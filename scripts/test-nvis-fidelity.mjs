#!/usr/bin/env node

/**
 * NVIS Dataset Fidelity Test (Direct execution)
 * Tests NVIS vegetation type variation across diverse Australian regions
 * Run: node scripts/test-nvis-fidelity.mjs
 */

const NVIS_MVG_URL =
  'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer';

const MVG_CLASSES = {
  1: { name: 'Rainforests and Vine Thickets', vegetation: 'heavyforest', confidence: 0.9 },
  2: { name: 'Eucalypt Tall Open Forests', vegetation: 'heavyforest', confidence: 0.95 },
  3: { name: 'Eucalypt Open Forests', vegetation: 'heavyforest', confidence: 0.9 },
  4: { name: 'Eucalypt Low Open Forests', vegetation: 'heavyforest', confidence: 0.8 },
  5: { name: 'Eucalypt Woodlands', vegetation: 'mediumscrub', confidence: 0.8 },
  6: { name: 'Acacia Forests and Woodlands', vegetation: 'mediumscrub', confidence: 0.7 },
  7: { name: 'Callitris Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.8 },
  8: { name: 'Casuarina Forests and Woodlands', vegetation: 'mediumscrub', confidence: 0.7 },
  9: { name: 'Melaleuca Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.75 },
  10: { name: 'Other Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.7 },
  11: { name: 'Eucalypt Open Woodlands', vegetation: 'lightshrub', confidence: 0.65 },
  12: { name: 'Tropical Eucalypt Woodlands/Grasslands', vegetation: 'grassland', confidence: 0.7 },
  13: { name: 'Acacia Open Woodlands', vegetation: 'lightshrub', confidence: 0.65 },
  14: { name: 'Mallee Woodlands and Shrublands', vegetation: 'mediumscrub', confidence: 0.85 },
  15: { name: 'Low Closed Forests and Tall Closed Shrublands', vegetation: 'mediumscrub', confidence: 0.7 },
  16: { name: 'Acacia Shrublands', vegetation: 'mediumscrub', confidence: 0.8 },
  17: { name: 'Other Shrublands', vegetation: 'mediumscrub', confidence: 0.8 },
  18: { name: 'Heathlands', vegetation: 'mediumscrub', confidence: 0.85 },
  19: { name: 'Tussock Grasslands', vegetation: 'grassland', confidence: 0.95 },
  20: { name: 'Hummock Grasslands', vegetation: 'grassland', confidence: 0.9 },
  21: { name: 'Other Grasslands, Herblands, Sedgelands and Rushlands', vegetation: 'grassland', confidence: 0.9 },
  22: { name: 'Chenopod Shrublands, Samphire Shrublands and Forblands', vegetation: 'lightshrub', confidence: 0.8 },
  23: { name: 'Mangroves', vegetation: 'lightshrub', confidence: 0.5 },
  24: { name: 'Inland Aquatic - freshwater, salt lakes, lagoons', vegetation: 'grassland', confidence: 0.4 },
  25: { name: 'Cleared, non-native vegetation, buildings', vegetation: 'grassland', confidence: 0.5 },
  26: { name: 'Unclassified native vegetation', vegetation: 'mediumscrub', confidence: 0.4 },
  27: { name: 'Naturally bare - sand, rock, claypan, mudflat', vegetation: 'grassland', confidence: 0.4 },
  28: { name: 'Sea and estuaries', vegetation: 'grassland', confidence: 0.3 },
  29: { name: 'Regrowth, modified native vegetation', vegetation: 'mediumscrub', confidence: 0.6 },
  30: { name: 'Unclassified forest', vegetation: 'heavyforest', confidence: 0.6 },
  31: { name: 'Other Open Woodlands', vegetation: 'lightshrub', confidence: 0.6 },
  32: { name: 'Mallee Open Woodlands and Sparse Mallee Shrublands', vegetation: 'mediumscrub', confidence: 0.7 },
  99: { name: 'Unknown / no data', vegetation: 'lightshrub', confidence: 0.3 },
};

const TEST_REGIONS = [
  {
    name: 'Tropical Rainforest (Far North QLD)',
    points: [
      { lat: -16.0, lng: 145.0 },
      { lat: -15.9, lng: 145.1 },
      { lat: -16.1, lng: 145.2 },
    ],
    expectedDiversity: 'low',
  },
  {
    name: 'Eucalypt Woodland (Central QLD)',
    points: [
      { lat: -21.0, lng: 138.0 },
      { lat: -21.1, lng: 137.9 },
      { lat: -20.9, lng: 138.1 },
    ],
    expectedDiversity: 'high',
  },
  {
    name: 'Grassland/Savanna (Northern Territory)',
    points: [
      { lat: -12.5, lng: 131.0 },
      { lat: -12.4, lng: 131.1 },
      { lat: -12.6, lng: 130.9 },
    ],
    expectedDiversity: 'high',
  },
  {
    name: 'Mallee Shrubland (Victoria)',
    points: [
      { lat: -34.7, lng: 141.2 },
      { lat: -34.8, lng: 141.3 },
      { lat: -34.6, lng: 141.1 },
    ],
    expectedDiversity: 'low',
  },
  {
    name: 'Mixed Forest (Tasmania)',
    points: [
      { lat: -42.5, lng: 147.0 },
      { lat: -42.4, lng: 147.1 },
      { lat: -42.6, lng: 146.9 },
    ],
    expectedDiversity: 'high',
  },
  {
    name: 'Coastal Heathland (South Australia)',
    points: [
      { lat: -35.5, lng: 139.5 },
      { lat: -35.4, lng: 139.6 },
      { lat: -35.6, lng: 139.4 },
    ],
    expectedDiversity: 'high',
  },
  {
    name: 'Desert/Arid (Central Australia)',
    points: [
      { lat: -23.5, lng: 133.5 },
      { lat: -23.4, lng: 133.6 },
      { lat: -23.6, lng: 133.4 },
    ],
    expectedDiversity: 'low',
  },
];

function buildIdentifyUrl(lat, lng) {
  const d = 0.01;
  const mapExtent = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return (
    `${NVIS_MVG_URL}/identify` +
    `?f=json&geometry=${encodeURIComponent(lng + ',' + lat)}` +
    `&geometryType=esriGeometryPoint&sr=4326` +
    `&layers=${encodeURIComponent('all:0')}&tolerance=1` +
    `&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=400,400,96` +
    `&returnGeometry=false`
  );
}

function extractMVGCode(attributes) {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  const codeKeys = keys.filter((k) =>
    /mvg.*(number|num|code|value)|^value$|pixel\s*value|nvisdsc1|gridcode|^mvg$|raster\.?value/i.test(k)
  );
  for (const k of [...codeKeys, ...keys]) {
    const raw = attributes[k];
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    if (Number.isInteger(num) && MVG_CLASSES[num]) return num;
  }
  return null;
}

async function fetchNVISPoint(lat, lng) {
  try {
    const url = buildIdentifyUrl(lat, lng);
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    const attrs = json?.results?.[0]?.attributes;
    if (!attrs) return null;

    const code = extractMVGCode(attrs);
    if (code != null) {
      const mvg = MVG_CLASSES[code];
      return {
        code,
        name: mvg.name,
        vegetation: mvg.vegetation,
        confidence: mvg.confidence,
      };
    }
    return null;
  } catch (error) {
    console.error(`  ✗ Query failed for (${lat}, ${lng}):`, error.message);
    return null;
  }
}

async function testRegion(region) {
  const result = {
    region: region.name,
    totalSamples: region.points.length,
    successfulQueries: 0,
    vegetationDistribution: {
      grassland: 0,
      lightshrub: 0,
      mediumscrub: 0,
      heavyforest: 0,
    },
    mvgCodes: new Map(),
    uniqueTypes: 0,
    diversityScore: 0,
    confidences: [],
    avgConfidence: 0,
    issues: [],
  };

  console.log(`\n  Testing: ${region.name}`);

  for (const point of region.points) {
    const data = await fetchNVISPoint(point.lat, point.lng);
    if (data) {
      result.successfulQueries++;
      result.vegetationDistribution[data.vegetation]++;
      result.confidences.push(data.confidence);
      result.mvgCodes.set(data.code, data.vegetation);
    }
    // Small delay between requests
    await new Promise((r) => setTimeout(r, 200));
  }

  // Calculate diversity
  const vegTypes = Object.entries(result.vegetationDistribution)
    .filter(([_, count]) => count > 0)
    .map(([type]) => type);
  result.uniqueTypes = vegTypes.length;

  if (result.successfulQueries > 0) {
    let entropy = 0;
    for (const count of Object.values(result.vegetationDistribution)) {
      if (count > 0) {
        const p = count / result.successfulQueries;
        entropy -= p * Math.log2(p);
      }
    }
    result.diversityScore = entropy / 2; // Normalize to 0-1

    result.avgConfidence =
      result.confidences.length > 0
        ? result.confidences.reduce((a, b) => a + b, 0) / result.confidences.length
        : 0;
  }

  // Validate
  if (region.expectedDiversity === 'high' && result.diversityScore < 0.4) {
    result.issues.push(
      `Expected high diversity but got low (${result.diversityScore.toFixed(3)}). Only ${result.uniqueTypes} types.`
    );
  }
  if (region.expectedDiversity === 'low' && result.uniqueTypes > 3) {
    result.issues.push(`Expected low diversity but got ${result.uniqueTypes} types.`);
  }

  return result;
}

function formatResult(result) {
  console.log(`  ├─ Success: ${result.successfulQueries}/${result.totalSamples}`);
  console.log(`  ├─ Types: ${result.uniqueTypes} | Diversity: ${result.diversityScore.toFixed(3)}`);
  console.log(`  ├─ Distribution:`);
  for (const [veg, count] of Object.entries(result.vegetationDistribution)) {
    if (count > 0) {
      const pct = ((count / result.successfulQueries) * 100).toFixed(0);
      console.log(`     ${veg}: ${count} (${pct}%)`);
    }
  }
  console.log(`  ├─ Avg Confidence: ${result.avgConfidence.toFixed(3)}`);

  if (result.issues.length > 0) {
    console.log(`  ├─ Issues:`);
    for (const issue of result.issues) {
      console.log(`     ⚠ ${issue}`);
    }
  }

  if (result.mvgCodes.size > 0) {
    console.log(`  └─ MVG Codes:`);
    for (const [code, veg] of result.mvgCodes.entries()) {
      const mvg = MVG_CLASSES[code];
      console.log(`     ${code}: ${mvg.name} → ${veg}`);
    }
  }
}

async function main() {
  console.log('\n=== NVIS Dataset Fidelity Test ===\n');
  console.log('Testing NVIS vegetation variation across Australian regions...');

  const allResults = [];
  let totalQueries = 0;
  let totalSuccesses = 0;

  for (const region of TEST_REGIONS) {
    const result = await testRegion(region);
    allResults.push(result);
    formatResult(result);

    totalQueries += result.totalSamples;
    totalSuccesses += result.successfulQueries;
  }

  // Summary
  console.log('\n=== Overall Analysis ===\n');

  const successRate = (totalSuccesses / totalQueries) * 100;
  console.log(`Total Success Rate: ${successRate.toFixed(1)}%`);

  const avgDiversity = allResults.reduce((sum, r) => sum + r.diversityScore, 0) / allResults.length;
  console.log(`Average Diversity: ${avgDiversity.toFixed(3)} (0-1 scale)`);

  const globalDist = { grassland: 0, lightshrub: 0, mediumscrub: 0, heavyforest: 0 };
  for (const result of allResults) {
    for (const [veg, count] of Object.entries(result.vegetationDistribution)) {
      globalDist[veg] += count;
    }
  }

  console.log('\nGlobal Distribution:');
  const globalTotal = Object.values(globalDist).reduce((a, b) => a + b, 0);
  for (const [veg, count] of Object.entries(globalDist)) {
    const pct = ((count / globalTotal) * 100).toFixed(1);
    console.log(`  ${veg}: ${count} (${pct}%)`);
  }

  // Fidelity assessment
  console.log('\n=== Fidelity Assessment ===\n');

  const issueRegions = allResults.filter((r) => r.issues.length > 0);
  if (issueRegions.length > 0) {
    console.log(`⚠  Regions with issues: ${issueRegions.length}/${allResults.length}`);
  } else {
    console.log('✓ All regions passed initial checks');
  }

  // Check concentration
  const topVeg = Object.entries(globalDist).sort(([, a], [, b]) => b - a)[0];
  const topPct = (topVeg[1] / globalTotal) * 100;

  if (topPct > 70) {
    console.log(
      `\n⚠  WARNING: Data heavily concentrated on '${topVeg[0]}' (${topPct.toFixed(1)}%).`
    );
    console.log('   Reduced fidelity detected compared to state-based approaches.');
  } else if (topPct > 50) {
    console.log(
      `\n⚠  CAUTION: Concentration on '${topVeg[0]}' (${topPct.toFixed(1)}%).`
    );
  } else {
    console.log(`\n✓ Good distribution: top type '${topVeg[0]}' is ${topPct.toFixed(1)}%`);
  }

  console.log('\n=== Test Complete ===\n');

  if (issueRegions.length === 0 && topPct <= 60) {
    console.log('✓ NVIS dataset fidelity appears adequate\n');
  } else {
    console.log('✗ NVIS dataset shows signs of reduced fidelity\n');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Test error:', e);
  process.exitCode = 1;
});
