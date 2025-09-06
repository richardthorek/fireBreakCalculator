/**
 * Script to import vegetation data from CSV
 * This script reads the vegetation.csv file and imports it into the database
 * 
 * Usage: node import_vegetation_csv.js
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { parse } = require('csv-parse');

// Set this to your API base URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7071/api';

// Path to the CSV file
const CSV_FILE = path.join(__dirname, '..', 'vegetation.csv');
console.log(`Reading from CSV file: ${CSV_FILE}`);

// Map the NSW vegetation formations to our application's vegetation types
const DEFAULT_VEGETATION_TYPE_MAPPING = {
  'Rainforest': 'heavyforest',
  'Wet Sclerophyll Forest': 'heavyforest', 
  'Dry Sclerophyll Forest': 'heavyforest',
  'Forested Wetland': 'heavyforest',
  'Grassy Woodland': 'mediumscrub',
  'Semi-arid Woodland': 'mediumscrub',
  'Heathland': 'mediumscrub',
  'Alpine Complex': 'mediumscrub',
  'Arid Shrubland': 'mediumscrub',
  'Grassland': 'grassland',
  'Freshwater Wetland': 'grassland',
  'Saline Wetland': 'lightshrub',
  'Saltmarsh': 'lightshrub'
};

// Default for anything not explicitly mapped
const DEFAULT_VEGETATION_TYPE = 'mediumscrub';

// Generate a shorter, hash-based ID to avoid exceeding Azure Table Storage row key size limits
function generateShortId(text) {
  // Create a simple hash code from the text
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to base36 string (alphanumeric) and ensure it's positive
  return Math.abs(hash).toString(36);
}

// Create vegetation mapping
async function createVegetationMapping(mapping) {
  try {
    // Generate a shorter ID based on the combination of values
    const idBase = (mapping.formationName || '').toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
    const classHash = mapping.className ? `-${generateShortId(mapping.className)}` : '';
    const typeHash = mapping.typeName ? `-${generateShortId(mapping.typeName)}` : '';
    
    // Override the ID with our shorter version
    const shortenedMapping = {
      ...mapping,
      id: `${idBase}${classHash}${typeHash}`
    };
    
    const response = await fetch(`${API_BASE_URL}/vegetation-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shortenedMapping)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create vegetation mapping: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`Created vegetation mapping for '${mapping.formationName}${mapping.className ? ' > ' + mapping.className : ''}${mapping.typeName ? ' > ' + mapping.typeName : ''}' with ID: ${data.id}`);
    return data;
  } catch (error) {
    console.error(`Error creating vegetation mapping for '${mapping.formationName}':`, error.message);
  }
}

// Parse the CSV file and create vegetation mappings
async function importVegetationCSV() {
  return new Promise((resolve, reject) => {
    const formations = new Map();
    const classes = new Map();
    const types = new Map();
    
    // Debug counter
    let rowCount = 0;
    
    fs.createReadStream(CSV_FILE)
      .pipe(parse({
        delimiter: ',',
        columns: true,
        skip_empty_lines: true,
        trim: true
      }))
      .on('data', (row) => {
        rowCount++;
        
        // Log every 100 rows to show progress
        if (rowCount % 100 === 0) {
          console.log(`Processing row ${rowCount}...`);
        }
        
        // Debug first few rows
        if (rowCount <= 3) {
          console.log('Sample row:', JSON.stringify(row));
          console.log('Row keys:', Object.keys(row));
          console.log('Row values:', Object.values(row));
        }
        
        // Access raw column data with exact key names from the CSV
        const keys = Object.keys(row);
        const formation = row[keys[0]]; // First column (vegetationFormation)
        const className = row[keys[1]]; // Second column (vegetationClass)
        const typeName = row[keys[2]];  // Third column (vvegetationName - note the typo in the CSV)
        
        // Debug column extraction
        if (rowCount <= 3) {
          console.log(`Extracted: formation=${formation}, class=${className}, type=${typeName}`);
        }
        
        // Add formation if it doesn't exist
        if (formation && !formations.has(formation)) {
          formations.set(formation, {
            formationName: formation,
            vegetationType: DEFAULT_VEGETATION_TYPE_MAPPING[formation] || DEFAULT_VEGETATION_TYPE,
            active: true
          });
        }
        
        // Add class if it doesn't exist - always inherit vegetation type from parent formation
        if (formation && className && !classes.has(`${formation}|${className}`)) {
          const formationVegetationType = DEFAULT_VEGETATION_TYPE_MAPPING[formation] || DEFAULT_VEGETATION_TYPE;
          classes.set(`${formation}|${className}`, {
            formationName: formation,
            className: className,
            vegetationType: formationVegetationType, // Always use the parent formation's vegetation type
            active: true
          });
        }
        
        // Add type if it doesn't exist - always inherit vegetation type from parent formation
        if (formation && className && typeName && !types.has(`${formation}|${className}|${typeName}`)) {
          const formationVegetationType = DEFAULT_VEGETATION_TYPE_MAPPING[formation] || DEFAULT_VEGETATION_TYPE;
          types.set(`${formation}|${className}|${typeName}`, {
            formationName: formation,
            className: className,
            typeName: typeName,
            vegetationType: formationVegetationType, // Always use the parent formation's vegetation type
            active: true
          });
        }
      })
      .on('end', () => {
        console.log(`Total rows processed: ${rowCount}`);
        console.log(`Collected ${formations.size} unique formations, ${classes.size} unique classes, and ${types.size} unique types`);
        
        resolve({
          formations: Array.from(formations.values()),
          classes: Array.from(classes.values()),
          types: Array.from(types.values())
        });
      })
      .on('error', (error) => {
        console.error('Error processing CSV:', error);
        reject(error);
      });
  });
}

// Main function to import data
async function importData() {
  console.log('Starting to import vegetation data from CSV...');
  
  try {
    const data = await importVegetationCSV();
    console.log(`Found ${data.formations.length} formations, ${data.classes.length} classes, and ${data.types.length} types`);
    
    // Create formations first
    console.log('Creating formation mappings...');
    for (const formation of data.formations) {
      await createVegetationMapping(formation);
    }
    
    // Create classes next
    console.log('Creating class mappings...');
    for (const cls of data.classes) {
      await createVegetationMapping(cls);
    }
    
    // Create types last
    console.log('Creating type mappings...');
    for (const type of data.types) {
      await createVegetationMapping(type);
    }
    
    console.log('Vegetation data import complete!');
  } catch (error) {
    console.error('Import process failed:', error);
  }
}

// Run the import process
importData().catch(error => {
  console.error('Import process failed:', error);
  process.exit(1);
});
