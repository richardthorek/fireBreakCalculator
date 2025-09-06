/**
 * Script to update vegetation data in the database
 * This script updates vegetation mappings to ensure classes and types inherit their parent formation's vegetation type
 * 
 * Usage: node update_vegetation_mappings.js
 */

const fetch = require('node-fetch');

// Set this to your API base URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7071/api';

// Map the NSW vegetation formations to our application's vegetation types
const VEGETATION_TYPE_MAPPING = {
  'Rainforest': 'heavyforest',
  'Wet Sclerophyll Forest': 'heavyforest',
  'Wet Sclerophyll Forests': 'heavyforest', // Handle variations in naming
  'Dry Sclerophyll Forest': 'heavyforest',
  'Dry Sclerophyll Forests': 'heavyforest', // Handle variations in naming
  'Forested Wetland': 'heavyforest',
  'Forested Wetlands': 'heavyforest', // Handle variations in naming
  'Grassy Woodland': 'heavyforest',
  'Grassy Woodlands': 'heavyforest', // Handle variations in naming
  'Semi-arid Woodland': 'mediumscrub',
  'Semi-arid Woodlands': 'mediumscrub', // Handle variations in naming
  'Heathland': 'mediumscrub',
  'Heathlands': 'mediumscrub', // Handle variations in naming
  'Alpine Complex': 'mediumscrub',
  'Alpine Complexes': 'mediumscrub', // Handle variations in naming
  'Arid Shrubland': 'mediumscrub',
  'Arid Shrublands': 'mediumscrub', // Handle variations in naming
  'Grassland': 'grassland',
  'Grasslands': 'grassland', // Handle variations in naming
  'Freshwater Wetland': 'grassland',
  'Freshwater Wetlands': 'grassland', // Handle variations in naming
  'Saline Wetland': 'lightshrub',
  'Saline Wetlands': 'lightshrub', // Handle variations in naming
  'Saltmarsh': 'lightshrub'
};

// Default for anything not explicitly mapped
const DEFAULT_VEGETATION_TYPE = 'mediumscrub';

// Fetch all vegetation mappings
async function getAllVegetationMappings() {
  try {
    const response = await fetch(`${API_BASE_URL}/vegetation-mapping`);
    if (!response.ok) {
      throw new Error(`Failed to fetch vegetation mappings: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching vegetation mappings:', error);
    throw error;
  }
}

// Update a vegetation mapping
async function updateVegetationMapping(id, updateData) {
  try {
    const response = await fetch(`${API_BASE_URL}/vegetation-mapping/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update vegetation mapping: ${errorText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error updating vegetation mapping ${id}:`, error.message);
    throw error;
  }
}

// Main function to update the vegetation mappings
async function updateVegetationMappings() {
  try {
    console.log('Fetching all vegetation mappings...');
    const mappings = await getAllVegetationMappings();
    console.log(`Retrieved ${mappings.length} vegetation mappings`);
    
    // First, organize mappings by hierarchy (formations, classes, types)
    const formations = mappings.filter(m => m.formationName && !m.className && !m.typeName);
    const classes = mappings.filter(m => m.formationName && m.className && !m.typeName);
    const types = mappings.filter(m => m.formationName && m.className && m.typeName);
    
    console.log(`Found ${formations.length} formations, ${classes.length} classes, and ${types.length} types`);
    
    // Create a mapping of formation names to their vegetation types
    const formationToType = {};
    for (const formation of formations) {
      // Use our predefined mapping or the current value as fallback
      formationToType[formation.formationName] = VEGETATION_TYPE_MAPPING[formation.formationName] || 
                                                formation.vegetationType ||
                                                DEFAULT_VEGETATION_TYPE;
      
      // Update formation if it doesn't match our mapping
      if (formation.vegetationType !== formationToType[formation.formationName]) {
        console.log(`Updating formation "${formation.formationName}" to vegetation type: ${formationToType[formation.formationName]}`);
        await updateVegetationMapping(formation.id, {
          vegetationType: formationToType[formation.formationName],
          version: formation.version
        });
      }
    }
    
    // Update classes to match their parent formation's vegetation type
    console.log('\nUpdating classes to match parent formations...');
    let classUpdates = 0;
    for (const cls of classes) {
      const parentType = formationToType[cls.formationName];
      if (parentType && cls.vegetationType !== parentType) {
        console.log(`Updating class "${cls.formationName} > ${cls.className}" from ${cls.vegetationType} to ${parentType}`);
        await updateVegetationMapping(cls.id, {
          vegetationType: parentType,
          version: cls.version
        });
        classUpdates++;
      }
    }
    console.log(`Updated ${classUpdates} classes`);
    
    // Update types to match their parent formation's vegetation type
    console.log('\nUpdating types to match parent formations...');
    let typeUpdates = 0;
    for (const type of types) {
      const parentType = formationToType[type.formationName];
      if (parentType && type.vegetationType !== parentType) {
        console.log(`Updating type "${type.formationName} > ${type.className} > ${type.typeName}" from ${type.vegetationType} to ${parentType}`);
        await updateVegetationMapping(type.id, {
          vegetationType: parentType,
          version: type.version
        });
        typeUpdates++;
      }
    }
    console.log(`Updated ${typeUpdates} types`);
    
    console.log('\nVegetation mapping update complete!');
  } catch (error) {
    console.error('Update process failed:', error);
  }
}

// Run the update process
updateVegetationMappings().catch(error => {
  console.error('Update process failed:', error);
  process.exit(1);
});
