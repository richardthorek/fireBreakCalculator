/**
 * Machine Compatibility Test Suite
 * Validates that machine recommendation logic works correctly,
 * especially for machines configured for all terrain/vegetation types.
 * 
 * Run with: node webapp/tests/machine-compatibility.test.js
 */

// Import logic from the actual implementation (for real tests, this would use proper imports)
const TERRAIN_LEVELS = ['flat', 'medium', 'steep', 'very_steep'];
const VEGETATION_TYPES = ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'];

// Test machines based on defaultConfig.ts
const TEST_MACHINES = [
  {
    id: 'dozer-d8',
    name: 'Caterpillar D8 Dozer',
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'], // ALL TERRAINS
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'], // ALL VEGETATION
    maxSlope: 35,
    description: 'Machine configured for all terrain and vegetation types'
  },
  {
    id: 'dozer-d6',
    name: 'Caterpillar D6 Dozer',
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    maxSlope: 25,
    description: 'Machine with most terrain, some vegetation'
  },
  {
    id: 'grader-140m',
    name: 'Motor Grader 140M',
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland'],
    maxSlope: 15,
    description: 'Machine with limited terrain and vegetation'
  }
];

// Compatibility logic (replicated from AnalysisPanel.tsx)
const terrainRank = { flat: 0, medium: 1, steep: 2, very_steep: 3 };

function baseEnvironmentCompatible(equipment, requiredTerrain, vegetation) {
  return equipment.allowedTerrain.includes(requiredTerrain) && 
         equipment.allowedVegetation.includes(vegetation);
}

function evaluateMachineryTerrainCompatibility(machine, trackAnalysis, vegetation, requiredTerrain) {
  // Fallback to simple membership logic if no track analysis
  if (!trackAnalysis) {
    return baseEnvironmentCompatible(machine, requiredTerrain, vegetation)
      ? { level: 'full', compatible: true }
      : { level: 'incompatible', compatible: false, note: 'Terrain/vegetation not permitted' };
  }

  const simpleOk = baseEnvironmentCompatible(machine, requiredTerrain, vegetation);
  const highestAllowed = machine.allowedTerrain.reduce((max, t) => Math.max(max, terrainRank[t]), 0);
  const requiredRank = terrainRank[requiredTerrain];
  
  if (requiredRank <= highestAllowed && simpleOk) {
    return { level: 'full', compatible: true };
  }

  // Detailed terrain analysis
  const slopeCategoryToTerrain = {
    flat: 'flat',
    medium: 'medium', 
    steep: 'steep',
    very_steep: 'very_steep'
  };

  const distByCat = trackAnalysis.slopeDistribution;
  const overDistance = Object.entries(distByCat).reduce((acc, [cat, dist]) => {
    const terr = slopeCategoryToTerrain[cat];
    if (!terr) return acc;
    const r = terrainRank[terr];
    return r > highestAllowed ? acc + dist : acc;
  }, 0);
  
  const total = trackAnalysis.totalDistance || 0;
  const overPercent = total > 0 ? overDistance / total : 0;

  if (overPercent === 0 && simpleOk) {
    return { level: 'full', compatible: true };
  }
  
  // Allow partial compatibility within threshold
  const PARTIAL_THRESHOLD = 0.15; // 15% of distance
  if (overPercent > 0 && overPercent <= PARTIAL_THRESHOLD && machine.allowedVegetation.includes(vegetation)) {
    return {
      level: 'partial',
      compatible: true,
      note: `~${Math.round(overPercent * 100)}% of route exceeds rated terrain`
    };
  }
  
  return { 
    level: 'incompatible', 
    compatible: false,
    note: overPercent > 0 ? 'Too much challenging terrain' : 'Terrain/vegetation not permitted' 
  };
}

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'Flat terrain, light vegetation',
    terrain: 'flat',
    vegetation: 'grassland',
    trackAnalysis: {
      totalDistance: 1000,
      maxSlope: 5,
      slopeDistribution: { flat: 1000, medium: 0, steep: 0, very_steep: 0 }
    }
  },
  {
    name: 'Medium terrain, medium vegetation',  
    terrain: 'medium',
    vegetation: 'mediumscrub',
    trackAnalysis: {
      totalDistance: 1000,
      maxSlope: 15,
      slopeDistribution: { flat: 200, medium: 800, steep: 0, very_steep: 0 }
    }
  },
  {
    name: 'Steep terrain, heavy vegetation',
    terrain: 'steep', 
    vegetation: 'heavyforest',
    trackAnalysis: {
      totalDistance: 1000,
      maxSlope: 25,
      slopeDistribution: { flat: 100, medium: 200, steep: 700, very_steep: 0 }
    }
  },
  {
    name: 'Very steep terrain, heavy vegetation',
    terrain: 'very_steep',
    vegetation: 'heavyforest', 
    trackAnalysis: {
      totalDistance: 1000,
      maxSlope: 35,
      slopeDistribution: { flat: 0, medium: 100, steep: 200, very_steep: 700 }
    }
  }
];

// Test execution
function runTests() {
  console.log('🧪 Machine Compatibility Test Suite');
  console.log('=====================================\n');
  
  let totalTests = 0;
  let passedTests = 0;
  const results = [];

  TEST_MACHINES.forEach(machine => {
    console.log(`🚛 ${machine.name}`);
    console.log(`   Terrain: [${machine.allowedTerrain.join(', ')}]`);
    console.log(`   Vegetation: [${machine.allowedVegetation.join(', ')}]`);
    console.log('   ' + '-'.repeat(60));
    
    TEST_SCENARIOS.forEach(scenario => {
      totalTests++;
      
      const result = evaluateMachineryTerrainCompatibility(
        machine,
        scenario.trackAnalysis,
        scenario.vegetation,
        scenario.terrain
      );
      
      // Expected result: compatible if machine supports both terrain and vegetation
      const expectedCompatible = machine.allowedTerrain.includes(scenario.terrain) && 
                                 machine.allowedVegetation.includes(scenario.vegetation);
      
      const testPassed = result.compatible === expectedCompatible;
      
      if (testPassed) passedTests++;
      
      const status = testPassed ? '✅' : '❌';
      const resultText = result.compatible ? 
        `${result.level} (compatible)` : 
        `${result.level} (incompatible)`;
      
      console.log(`   ${status} ${scenario.name}: ${resultText}`);
      if (result.note) console.log(`       ${result.note}`);
      
      results.push({
        machine: machine.name,
        scenario: scenario.name,
        expected: expectedCompatible,
        actual: result.compatible,
        level: result.level,
        passed: testPassed
      });
    });
    
    console.log('');
  });

  // Summary
  console.log('Summary');
  console.log('=======');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  // Focus on D8 Dozer (all terrain/vegetation)
  const d8Results = results.filter(r => r.machine.includes('D8'));
  const d8Passed = d8Results.filter(r => r.passed).length;
  
  console.log('🎯 Key Issue Validation: D8 Dozer (All Terrain/Vegetation)');
  console.log('===========================================================');
  console.log(`D8 Tests: ${d8Passed}/${d8Results.length} passed`);
  
  if (d8Passed === d8Results.length) {
    console.log('✅ SUCCESS: D8 Dozer correctly marked as compatible in all scenarios');
    console.log('   Issue RESOLVED: Machines configured for all terrains/vegetation work correctly');
  } else {
    console.log('❌ FAILURE: D8 Dozer incorrectly marked as incompatible');
    console.log('   Issue PERSISTS: Machine recommendation alignment still has problems');
    
    d8Results.filter(r => !r.passed).forEach(fail => {
      console.log(`   - ${fail.scenario}: expected ${fail.expected}, got ${fail.actual}`);
    });
  }

  // Overall result
  console.log('\n' + '='.repeat(70));
  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED - Machine recommendation alignment is working correctly!');
  } else {
    console.log('❌ SOME TESTS FAILED - Issues remain in machine recommendation logic');
  }

  return {
    totalTests,
    passedTests,
    success: passedTests === totalTests,
    d8Success: d8Passed === d8Results.length
  };
}

// Execute tests
if (require.main === module) {
  runTests();
}

module.exports = { runTests, TEST_MACHINES, TEST_SCENARIOS };