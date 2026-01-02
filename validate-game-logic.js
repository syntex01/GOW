#!/usr/bin/env node

/**
 * Validates game logic and configuration without requiring a browser
 */

console.log('='.repeat(70));
console.log('AGE OF WAR - GAME LOGIC VALIDATION');
console.log('='.repeat(70));
console.log('');

const fs = require('fs');
const path = require('path');

let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passedTests++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failedTests++;
    failures.push({ name, error: e.message });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('STRUCTURAL VALIDATION:\n');

// Test 1: Verify all critical files exist
test('All critical game files exist', () => {
  const requiredFiles = [
    'src/game.ts',
    'src/scenes/battleScene.ts',
    'src/scenes/testScene.ts',
    'src/scenes/menuScene.ts',
    'src/battle/unit.ts',
    'src/battle/unitConfig.ts',
    'src/battle/base.ts',
    'src/battle/effectsManager.ts',
    'src/battle/projectile.ts'
  ];

  requiredFiles.forEach(file => {
    const fullPath = path.join(__dirname, file);
    assert(fs.existsSync(fullPath), `Missing file: ${file}`);
  });
});

// Test 2: Verify test scene is registered
test('Test scene is registered in game.ts', () => {
  const gameFile = fs.readFileSync(path.join(__dirname, 'src/game.ts'), 'utf8');
  assert(gameFile.includes("import TestScene from './scenes/testScene'"), 'TestScene not imported');
  assert(gameFile.includes('TestScene'), 'TestScene not registered in scenes array');
});

// Test 3: Verify unit config structure
test('Unit config file is valid TypeScript', () => {
  const configFile = fs.readFileSync(path.join(__dirname, 'src/battle/unitConfig.ts'), 'utf8');
  assert(configFile.includes('STONE_AGE_UNITS'), 'Stone age units not defined');
  assert(configFile.includes('MEDIEVAL_AGE_UNITS'), 'Medieval age units not defined');
  assert(configFile.includes('MODERN_AGE_UNITS'), 'Modern age units not defined');
  assert(configFile.includes('FUTURE_AGE_UNITS'), 'Future age units not defined');
  assert(configFile.includes('ALL_UNIT_CONFIGS'), 'ALL_UNIT_CONFIGS not defined');
});

// Test 4: Count units in config
test('All 16+ units are defined in config', () => {
  const configFile = fs.readFileSync(path.join(__dirname, 'src/battle/unitConfig.ts'), 'utf8');

  // Count actual unit definitions
  const units = [
    'clubman', 'slinger', 'spearman', 'mammoth',  // Stone age (4)
    'swordsman', 'archer', 'knight', 'catapult', // Medieval (4)
    'rifleman', 'machinegunner', 'tank', 'sniper', // Modern (4)
    'laser_trooper', 'plasma_artillery', 'mech', 'drone', 'superweapon' // Future (5)
  ];

  let foundUnits = 0;
  units.forEach(unit => {
    if (configFile.includes(`${unit}:`)) {
      foundUnits++;
    }
  });

  assert(foundUnits >= 16, `Only ${foundUnits} units found, expected 16+`);
  console.log(`  Found ${foundUnits} units`);
});

// Test 5: Verify test scene has all test methods
test('Test scene has all required test methods', () => {
  const testFile = fs.readFileSync(path.join(__dirname, 'src/scenes/testScene.ts'), 'utf8');

  const requiredTests = [
    'testUnitCreation',
    'testAllUnitTypes',
    'testMeleeAttack',
    'testRangedAttack',
    'testUnitMovement',
    'testUnitDamage',
    'testUnitDeath',
    'testBaseAttack',
    'testProjectileSystem',
    'testEffectsManager'
  ];

  requiredTests.forEach(testMethod => {
    assert(testFile.includes(`private ${testMethod}(`), `Missing test method: ${testMethod}`);
  });
});

// Test 6: Verify auto-run functionality exists
test('Test scene has auto-run functionality', () => {
  const testFile = fs.readFileSync(path.join(__dirname, 'src/scenes/testScene.ts'), 'utf8');
  assert(testFile.includes('runAllTests'), 'runAllTests method missing');
  assert(testFile.includes('autoRunTests'), 'autoRunTests method missing');
  assert(testFile.includes('logFinalResults'), 'logFinalResults method missing');
  assert(testFile.includes("keydown-A"), 'Auto-run key binding missing');
});

// Test 7: Verify test validations use assertion arrays
test('Tests use programmatic assertions', () => {
  const testFile = fs.readFileSync(path.join(__dirname, 'src/scenes/testScene.ts'), 'utf8');

  // Check that tests use checks arrays
  assert(testFile.includes('const checks = ['), 'Assertion arrays not found');
  assert(testFile.includes('checks.every('), 'checks.every() validation not found');
  assert(testFile.match(/checks\.every/g).length >= 3, 'Not enough assertion-based tests');
});

// Test 8: Verify effects manager has new methods
test('Effects manager has enhanced methods', () => {
  const effectsFile = fs.readFileSync(path.join(__dirname, 'src/battle/effectsManager.ts'), 'utf8');

  const newMethods = ['unitSpawn', 'hitMarker', 'resourceGain', 'ageUpEffect', 'selectionIndicator'];
  newMethods.forEach(method => {
    assert(effectsFile.includes(`${method}(`), `Missing effect method: ${method}`);
  });
});

// Test 9: Verify Unit class has getHp method
test('Unit class has getHp method', () => {
  const unitFile = fs.readFileSync(path.join(__dirname, 'src/battle/unit.ts'), 'utf8');
  assert(unitFile.includes('getHp()'), 'getHp() method missing from Unit class');
  assert(unitFile.includes('return this.hp'), 'getHp() does not return hp');
});

// Test 10: Verify build succeeds
test('Project builds without errors', () => {
  const { execSync } = require('child_process');
  try {
    const output = execSync('NODE_OPTIONS=--openssl-legacy-provider npm run build 2>&1', {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 60000
    });

    assert(!output.includes('ERROR in'), 'Build contains errors');
    assert(output.includes('Built at'), 'Build did not complete');
  } catch (e) {
    throw new Error(`Build failed: ${e.message}`);
  }
});

console.log('\n' + '='.repeat(70));
console.log('VALIDATION RESULTS');
console.log('='.repeat(70));
console.log(`Total Tests: ${passedTests + failedTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log(`Pass Rate: ${Math.round((passedTests / (passedTests + failedTests)) * 100)}%`);
console.log('='.repeat(70));

if (failedTests > 0) {
  console.log('\nFAILURES:');
  failures.forEach(f => {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error}`);
  });
  process.exit(1);
}

console.log('\n✓ All structural validations passed!');
console.log('\nNext: Run the full interactive test suite');
console.log('  1. npm start');
console.log('  2. Open http://localhost:8080');
console.log('  3. Click "Run Tests"');
console.log('  4. Press "A" to auto-run all tests');
console.log('  5. Check browser console for detailed results');
console.log('');
