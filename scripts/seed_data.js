/**
 * Script to seed initial data for the Fire Break Calculator
 * This creates sample equipment and vegetation formation mappings
 */

const fetch = require('node-fetch');

// Set this to your API base URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7071/api';

// Sample machinery data
const machinery = [
  {
    type: 'Machinery',
    name: 'D4 Bulldozer',
    description: 'Small bulldozer suitable for creating fire breaks in grassland and light shrub',
    clearingRate: 0.5,
    maxSlope: 20,
    costPerHour: 180,
    allowedTerrain: ['flat', 'medium'],
    allowedVegetation: ['grassland', 'lightshrub'],
    active: true
  },
  {
    type: 'Machinery',
    name: 'D6 Bulldozer',
    description: 'Medium bulldozer for medium scrub and small trees',
    clearingRate: 0.8,
    maxSlope: 25,
    costPerHour: 220,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    active: true
  },
  {
    type: 'Machinery',
    name: 'D9 Bulldozer',
    description: 'Large bulldozer capable of clearing heavy forest',
    clearingRate: 1.1,
    maxSlope: 30,
    costPerHour: 280,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    active: true
  }
];

// Sample aircraft data
const aircraft = [
  {
    type: 'Aircraft',
    name: 'Single Engine Air Tanker',
    description: 'Small fixed-wing aircraft with 3000L capacity',
    dropLength: 100,
    turnaroundMinutes: 12,
    costPerHour: 3500,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    active: true
  },
  {
    type: 'Aircraft',
    name: 'Large Air Tanker',
    description: 'Large fixed-wing aircraft with 15000L capacity',
    dropLength: 180,
    turnaroundMinutes: 25,
    costPerHour: 8000,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    active: true
  }
];

// Sample hand crew data
const handCrews = [
  {
    type: 'HandCrew',
  name: 'Standard Crew',
  description: 'Standard 5-person fire response crew',
    crewSize: 5,
    clearingRatePerPerson: 0.02,
    equipmentList: ['chainsaws', 'rakehoes'],
    costPerHour: 240,
    allowedTerrain: ['flat', 'medium', 'steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub'],
    active: true
  },
  {
    type: 'HandCrew',
    name: 'RAFT Team',
    description: 'Remote Area Firefighting Team specialized for difficult terrain',
    crewSize: 6,
    clearingRatePerPerson: 0.018,
    equipmentList: ['chainsaws', 'rakehoes', 'pulaskis'],
    costPerHour: 300,
    allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
    allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
    active: true
  }
];

// Vegetation formation mappings
const vegetationMappings = [
  // Formations (top level)
  { formationName: 'Rainforest', vegetationType: 'heavyforest', active: true },
  { formationName: 'Wet Sclerophyll Forest', vegetationType: 'heavyforest', active: true },
  { formationName: 'Dry Sclerophyll Forest', vegetationType: 'heavyforest', active: true },
  { formationName: 'Forested Wetlands', vegetationType: 'heavyforest', active: true },
  { formationName: 'Grassy Woodland', vegetationType: 'heavyforest', active: true },
  { formationName: 'Semi-arid Woodland', vegetationType: 'mediumscrub', active: true },
  { formationName: 'Heathland', vegetationType: 'mediumscrub', active: true },
  { formationName: 'Alpine Complex', vegetationType: 'mediumscrub', active: true },
  { formationName: 'Arid Shrubland', vegetationType: 'mediumscrub', active: true },
  { formationName: 'Grassland', vegetationType: 'grassland', active: true },
  { formationName: 'Freshwater Wetland', vegetationType: 'grassland', active: true },
  { formationName: 'Saline Wetland', vegetationType: 'lightshrub', active: true },
  { formationName: 'Saltmarsh', vegetationType: 'lightshrub', active: true },
  
  // Classes (mid level)
  { formationName: 'Rainforest', className: 'Subtropical', vegetationType: 'heavyforest', active: true },
  { formationName: 'Rainforest', className: 'Temperate', vegetationType: 'heavyforest', active: true },
  { formationName: 'Wet Sclerophyll Forest', className: 'North Coast', vegetationType: 'heavyforest', active: true },
  { formationName: 'Grassland', className: 'Temperate Montane', vegetationType: 'grassland', active: true },
  
  // Types (most granular)
  { formationName: 'Rainforest', className: 'Subtropical', typeName: 'Coastal Subtropical', vegetationType: 'heavyforest', active: true, isOverride: true },
  { formationName: 'Wet Sclerophyll Forest', className: 'North Coast', typeName: 'Blackbutt', vegetationType: 'heavyforest', active: true }
];

// Create equipment
async function createEquipment(equipment) {
  try {
    const response = await fetch(`${API_BASE_URL}/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(equipment)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create equipment: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`Created ${equipment.type} '${equipment.name}' with ID: ${data.id}`);
    return data;
  } catch (error) {
    console.error(`Error creating ${equipment.type} '${equipment.name}':`, error.message);
  }
}

// Create vegetation mapping
async function createVegetationMapping(mapping) {
  try {
    const response = await fetch(`${API_BASE_URL}/vegetation-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create vegetation mapping: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`Created vegetation mapping for '${mapping.formationName}${mapping.subFormation ? ' - ' + mapping.subFormation : ''}' with ID: ${data.id}`);
    return data;
  } catch (error) {
    console.error(`Error creating vegetation mapping for '${mapping.formationName}':`, error.message);
  }
}

// Main function to seed data
async function seedData() {
  console.log('Starting to seed data...');
  
  // Create machinery
  for (const machine of machinery) {
    await createEquipment(machine);
  }
  
  // Create aircraft
  for (const plane of aircraft) {
    await createEquipment(plane);
  }
  
  // Create hand crews
  for (const crew of handCrews) {
    await createEquipment(crew);
  }
  
  // Create vegetation mappings
  for (const mapping of vegetationMappings) {
    await createVegetationMapping(mapping);
  }
  
  console.log('Data seeding complete!');
}

// Run the seeding process
seedData().catch(error => {
  console.error('Seeding process failed:', error);
  process.exit(1);
});
