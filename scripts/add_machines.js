// Script: add_machines.js
// Reads webapp/clearingrates.csv, appends generated rows for bulldozers and graders across slope/vegetation combos.
const fs = require('fs');
const path = require('path');

const csvPath = path.resolve(__dirname, '..', 'webapp', 'clearingrates.csv');
const header = 'Name\tType\tMaxSlope\tMaxVegetation\tm/hour\t$/hour';

function readCsv(fp) {
  return fs.readFileSync(fp, 'utf8').trim();
}

function writeCsv(fp, contents) {
  fs.writeFileSync(fp, contents + '\n', 'utf8');
}

function rowKey(cols) {
  return `${cols[0]}|${cols[2]}|${cols[3]}`; // Name|MaxSlope|MaxVegetation
}

(function main(){
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found at', csvPath);
    process.exit(1);
  }
  const content = readCsv(csvPath).split(/\r?\n/);
  const existing = content.slice(1).map(line => line.trim()).filter(Boolean);
  const existingKeys = new Set(existing.map(l => rowKey(l.split(/\s+/))));

  const bulldozers = [
    { name: 'D4', baseSpeed: 800, cost: 500 },
    { name: 'D6', baseSpeed: 850, cost: 1000 },
    { name: 'D7', baseSpeed: 900, cost: 1500 },
    { name: 'D8', baseSpeed: 1000, cost: 2000 },
  ];
  const graders = [
    { name: 'grader', baseSpeed: 2000, cost: 500 },
    { name: 'heavy grader', baseSpeed: 1800, cost: 500 },
  ];

  const slopes = [10,20,30];
  const vegs = ['grassland','lightshrub','mediumscrub','heavyforest'];

  const vegFactor = { grassland: 1.2, lightshrub: 1.05, mediumscrub: 0.8, heavyforest: 0.6 };
  const slopeFactor = { 10: 1.0, 20: 0.75, 30: 0.5 };

  const rowsToAdd = [];

  function addFor(machine) {
    for (const s of slopes) {
      for (const v of vegs) {
        const speed = Math.round(machine.baseSpeed * (vegFactor[v] || 1) * (slopeFactor[s] || 1));
        const cost = machine.cost;
        const cols = [machine.name, 'machinery', String(s), v, String(speed), String(cost)];
        const key = rowKey(cols);
        if (!existingKeys.has(key)) {
          rowsToAdd.push(cols.join('\t'));
          existingKeys.add(key);
        }
      }
    }
  }

  bulldozers.forEach(addFor);
  graders.forEach(addFor);

  if (!rowsToAdd.length) {
    console.log('No new rows to add. CSV already contains all combinations.');
    process.exit(0);
  }

  // Append rows
  const newContent = content.join('\n') + '\n' + rowsToAdd.join('\n') + '\n';
  writeCsv(csvPath, newContent.trim());
  console.log(`Appended ${rowsToAdd.length} rows to ${csvPath}`);
})();
