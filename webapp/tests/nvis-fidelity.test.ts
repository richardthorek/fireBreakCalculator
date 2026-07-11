/**
 * NVIS Dataset Fidelity Test
 * Validates that the NVIS national vegetation dataset provides adequate variation
 * in vegetation type classification across diverse Australian regions.
 *
 * Tests for regression: previous tests showed reduced variation in vegetation types
 * when using NVIS compared to state-based data (NSW SVTM PCT).
 */

import { fetchNVISVegetation, MVG_CLASSES, extractMVGCode, mapMVGCode } from '../src/utils/nvisVegetationService';
import { logger } from '../src/utils/logger';

interface RegionSamples {
  name: string;
  points: Array<{ lat: number; lng: number }>;
  expectedDiversity: 'high' | 'medium' | 'low';
}

// Test regions across Australia with diverse vegetation expectations
const TEST_REGIONS: RegionSamples[] = [
  {
    name: 'Tropical Rainforest (Far North QLD)',
    points: [
      { lat: -16.0, lng: 145.0 }, // Daintree area
      { lat: -15.9, lng: 145.1 },
      { lat: -16.1, lng: 145.2 },
    ],
    expectedDiversity: 'low', // Should be mostly rainforest/forest
  },
  {
    name: 'Eucalypt Woodland (Central QLD)',
    points: [
      { lat: -21.0, lng: 138.0 }, // Central west
      { lat: -21.1, lng: 137.9 },
      { lat: -20.9, lng: 138.1 },
    ],
    expectedDiversity: 'high', // Mixed woodlands/grasslands
  },
  {
    name: 'Grassland/Savanna (Northern Territory)',
    points: [
      { lat: -12.5, lng: 131.0 }, // Near Darwin
      { lat: -12.4, lng: 131.1 },
      { lat: -12.6, lng: 130.9 },
    ],
    expectedDiversity: 'high', // Mix of savanna, grassland, woodland
  },
  {
    name: 'Mallee Shrubland (Victoria)',
    points: [
      { lat: -36.0, lng: 141.0 }, // Mallee region
      { lat: -36.1, lng: 141.1 },
      { lat: -35.9, lng: 140.9 },
    ],
    expectedDiversity: 'low', // Predominantly mallee shrubland
  },
  {
    name: 'Mixed Forest (Tasmania)',
    points: [
      { lat: -42.5, lng: 147.0 }, // Central Tasmania
      { lat: -42.4, lng: 147.1 },
      { lat: -42.6, lng: 146.9 },
    ],
    expectedDiversity: 'high', // Forest, woodland, grassland mix
  },
  {
    name: 'Coastal Heathland (South Australia)',
    points: [
      { lat: -35.5, lng: 139.5 }, // South coast
      { lat: -35.4, lng: 139.6 },
      { lat: -35.6, lng: 139.4 },
    ],
    expectedDiversity: 'high', // Heath, woodland, grassland
  },
  {
    name: 'Desert/Arid (Central Australia)',
    points: [
      { lat: -23.5, lng: 133.5 }, // MacDonnell Ranges area
      { lat: -23.4, lng: 133.6 },
      { lat: -23.6, lng: 133.4 },
    ],
    expectedDiversity: 'low', // Sparse shrubland, bare ground
  },
];

interface VegetationDistribution {
  grassland: number;
  lightshrub: number;
  mediumscrub: number;
  heavyforest: number;
}

interface RegionTestResult {
  region: string;
  totalSamples: number;
  successfulQueries: number;
  failureRate: number;
  vegetationDistribution: VegetationDistribution;
  mvgCodesToVegetation: Map<number, string>;
  uniqueVegetationTypes: number;
  diversityScore: number; // 0-1, higher = more variation
  confidenceScores: number[];
  averageConfidence: number;
  potentialIssues: string[];
}

async function testRegion(region: RegionSamples): Promise<RegionTestResult> {
  const results: RegionTestResult = {
    region: region.name,
    totalSamples: region.points.length,
    successfulQueries: 0,
    failureRate: 0,
    vegetationDistribution: {
      grassland: 0,
      lightshrub: 0,
      mediumscrub: 0,
      heavyforest: 0,
    },
    mvgCodesToVegetation: new Map(),
    uniqueVegetationTypes: 0,
    diversityScore: 0,
    confidenceScores: [],
    averageConfidence: 0,
    potentialIssues: [],
  };

  for (const point of region.points) {
    try {
      const response = await fetchNVISVegetation(point.lat, point.lng);

      if (response) {
        results.successfulQueries++;
        results.vegetationDistribution[response.vegetationType]++;
        results.confidenceScores.push(response.confidence);

        if (response.mvgCode) {
          results.mvgCodesToVegetation.set(response.mvgCode, response.vegetationType);
        }
      }
    } catch (error) {
      logger.warn(`NVIS query failed for ${region.name} at (${point.lat}, ${point.lng}):`, error);
    }
  }

  results.failureRate = 1 - results.successfulQueries / results.totalSamples;

  // Calculate diversity
  const vegTypes = Object.entries(results.vegetationDistribution)
    .filter(([_, count]) => count > 0)
    .map(([type]) => type);
  results.uniqueVegetationTypes = vegTypes.length;

  // Diversity score: normalized Shannon entropy
  if (results.successfulQueries > 0) {
    let entropy = 0;
    for (const count of Object.values(results.vegetationDistribution)) {
      if (count > 0) {
        const p = count / results.successfulQueries;
        entropy -= p * Math.log2(p);
      }
    }
    // Normalize to 0-1 range (max entropy for 4 types = 2)
    results.diversityScore = entropy / 2;

    // Average confidence
    results.averageConfidence =
      results.confidenceScores.length > 0
        ? results.confidenceScores.reduce((a, b) => a + b, 0) / results.confidenceScores.length
        : 0;
  }

  // Validate results against expectations
  if (region.expectedDiversity === 'high' && results.diversityScore < 0.4) {
    results.potentialIssues.push(
      `Expected high diversity but got low (score: ${results.diversityScore.toFixed(3)}). Only ${results.uniqueVegetationTypes} vegetation types detected.`
    );
  }

  if (region.expectedDiversity === 'low' && results.uniqueVegetationTypes > 3) {
    results.potentialIssues.push(`Expected low diversity but got ${results.uniqueVegetationTypes} types. May indicate over-generalization.`);
  }

  if (results.failureRate > 0.2) {
    results.potentialIssues.push(`High NVIS query failure rate: ${(results.failureRate * 100).toFixed(1)}%`);
  }

  if (results.averageConfidence < 0.6) {
    results.potentialIssues.push(`Low average confidence: ${results.averageConfidence.toFixed(2)}`);
  }

  return results;
}

function compareWithExpectations(results: RegionTestResult): void {
  console.log(`\n  Region: ${results.region}`);
  console.log(`  ├─ Queries: ${results.successfulQueries}/${results.totalSamples} (${((1 - results.failureRate) * 100).toFixed(0)}% success)`);
  console.log(`  ├─ Vegetation types: ${results.uniqueVegetationTypes} | Diversity: ${results.diversityScore.toFixed(3)}`);
  console.log(`  ├─ Distribution:`);
  for (const [veg, count] of Object.entries(results.vegetationDistribution)) {
    if (count > 0) {
      const pct = ((count / results.successfulQueries) * 100).toFixed(0);
      console.log(`     ${veg}: ${count} (${pct}%)`);
    }
  }
  console.log(`  ├─ Avg Confidence: ${results.averageConfidence.toFixed(3)}`);

  if (results.potentialIssues.length > 0) {
    console.log(`  ├─ Issues:`);
    for (const issue of results.potentialIssues) {
      console.log(`     ⚠ ${issue}`);
    }
  }

  if (results.mvgCodesToVegetation.size > 0) {
    console.log(`  └─ MVG Codes found:`);
    for (const [code, vegType] of results.mvgCodesToVegetation) {
      const mvgName = MVG_CLASSES[code]?.name || 'Unknown';
      console.log(`     ${code}: ${mvgName} → ${vegType}`);
    }
  }
}

async function runAllTests(): Promise<void> {
  console.log('\n=== NVIS Dataset Fidelity Test ===\n');
  console.log('Testing NVIS vegetation type variation across Australian regions...\n');

  const allResults: RegionTestResult[] = [];
  let totalQueries = 0;
  let totalSuccesses = 0;

  for (const region of TEST_REGIONS) {
    const result = await testRegion(region);
    allResults.push(result);
    compareWithExpectations(result);

    totalQueries += result.totalSamples;
    totalSuccesses += result.successfulQueries;
  }

  // Summary analysis
  console.log('\n=== Overall Analysis ===\n');

  const overallSuccessRate = (totalSuccesses / totalQueries) * 100;
  console.log(`Total Query Success Rate: ${overallSuccessRate.toFixed(1)}%`);

  // Calculate average diversity
  const avgDiversity = allResults.reduce((sum, r) => sum + r.diversityScore, 0) / allResults.length;
  console.log(`Average Diversity Score: ${avgDiversity.toFixed(3)} (0-1 scale, higher = more variation)`);

  // Vegetation distribution across all regions
  const globalDistribution: VegetationDistribution = {
    grassland: 0,
    lightshrub: 0,
    mediumscrub: 0,
    heavyforest: 0,
  };

  for (const result of allResults) {
    for (const [veg, count] of Object.entries(result.vegetationDistribution)) {
      globalDistribution[veg as keyof VegetationDistribution] += count;
    }
  }

  console.log('\nGlobal Vegetation Distribution:');
  const globalTotal = Object.values(globalDistribution).reduce((a, b) => a + b, 0);
  for (const [veg, count] of Object.entries(globalDistribution)) {
    const pct = ((count / globalTotal) * 100).toFixed(1);
    console.log(`  ${veg}: ${count} (${pct}%)`);
  }

  // Assess fidelity issues
  console.log('\n=== Fidelity Assessment ===\n');

  const issueRegions = allResults.filter((r) => r.potentialIssues.length > 0);
  if (issueRegions.length > 0) {
    console.log(`⚠  Regions with potential issues: ${issueRegions.length}/${allResults.length}`);
    for (const region of issueRegions) {
      console.log(`   • ${region.region}`);
    }
  } else {
    console.log('✓ All regions passed fidelity checks');
  }

  // Check for over-concentration on particular types
  const topType = Object.entries(globalDistribution).sort(([, a], [, b]) => b - a)[0];
  const topTypePercent = (topType[1] / globalTotal) * 100;

  if (topTypePercent > 70) {
    console.log(
      `\n⚠  WARNING: Vegetation data appears over-concentrated on '${topType[0]}' (${topTypePercent.toFixed(1)}%).`
    );
    console.log('   This may indicate reduced fidelity compared to state-based approaches.');
  } else if (topTypePercent > 50) {
    console.log(
      `\n⚠  CAUTION: Vegetation data shows concentration on '${topType[0]}' (${topTypePercent.toFixed(1)}%).`
    );
    console.log('   Consider comparing with NSW state data in overlapping regions.');
  }

  // Confidence assessment
  const avgConfidence = allResults.reduce((sum, r) => sum + r.averageConfidence, 0) / allResults.length;
  console.log(`\nAverage Confidence Across All Regions: ${avgConfidence.toFixed(3)}`);
  if (avgConfidence < 0.65) {
    console.log('⚠  Low average confidence detected. May need recalibration of MVG→fuel class mapping.');
  }

  console.log('\n=== Test Complete ===\n');

  if (issueRegions.length === 0 && topTypePercent <= 50 && avgConfidence >= 0.65) {
    console.log('✓ NVIS dataset fidelity appears adequate');
  } else {
    console.log('✗ NVIS dataset shows signs of reduced fidelity');
    process.exitCode = 1;
  }
}

// Run tests
runAllTests().catch((e) => {
  console.error('Test suite error:', e);
  process.exitCode = 1;
});
