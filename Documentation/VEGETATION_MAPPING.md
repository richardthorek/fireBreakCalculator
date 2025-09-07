# 🌱 Hierarchical Vegetation Mapping Configuration

**Administrative configuration system for NSW vegetation formation classification**

---

## 📋 Quick Navigation
- [🎯 Overview](#-overview) - System purpose and configuration access
- [🏗️ Hierarchical Structure](#-hierarchical-mapping-structure) - Three-level classification system
- [📊 Default Mappings](#-default-mappings) - Pre-configured vegetation formations
- [⚙️ Technical Details](#-technical-details) - Implementation and database design
- [➕ Adding Custom Mappings](#-adding-custom-mappings) - Creating new classifications

**🔗 Related Documentation:**
- [📖 User Guide](../webapp/Documentation/USER_GUIDE.md) - End-user vegetation features
- [🌿 Vegetation Analysis](../webapp/Documentation/VEGETATION_ANALYSIS.md) - Technical implementation details
- [🗄️ Data Sources](DATA_SOURCES.md) - NSW Government data attribution

---

The RFS Fire Break Calculator supports hierarchical vegetation mappings that allow administrators to specify how NSW vegetation formations, classes, and types map to the application's four vegetation categories:

- **Grassland** - Open areas with minimal vegetation
- **Light Shrub** - Sparse shrubland and low vegetation  
- **Medium Scrub** - Dense shrubland and mixed vegetation
- **Heavy Forest** - Dense forest and woodland areas

## 🎯 Overview

The hierarchical vegetation mapping system allows administrators to:

1. Create mappings at three levels of granularity:
   - Formation level (e.g., "Rainforest")
   - Class level (e.g., "Subtropical Rainforest")
   - Type level (specific vegetation types)
2. Override parent settings at any level in the hierarchy
3. Update existing mappings to fine-tune how vegetation is classified
4. Delete mappings that are no longer needed

## 🌐 Accessing the Configuration

The vegetation mapping configuration panel can be accessed by clicking the "🌱 Vegetation" button in the top navigation bar.

## 🏗️ Hierarchical Mapping Structure

Each vegetation mapping consists of:

- **Formation Name**: The top-level vegetation formation name (e.g., "Rainforest", "Grassland", etc.)
- **Class Name**: The mid-level vegetation class name (e.g., "Subtropical Rainforest", "Temperate Montane Grassland", etc.)
- **Type Name**: The most specific vegetation type name (e.g., "Coastal Subtropical Rainforest")
- **Vegetation Type**: The application's vegetation category (grassland, lightshrub, mediumscrub, heavyforest)
- **Is Override**: Whether this mapping explicitly overrides its parent's classification
- **Active**: Whether this mapping is currently in use

### Inheritance Rules

1. If a specific type is defined (e.g., "Coastal Subtropical Rainforest"), that mapping is used
2. If no specific type is defined, but the class is defined (e.g., "Subtropical Rainforest"), that mapping is used
3. If neither type nor class is defined, the formation-level mapping (e.g., "Rainforest") is used
4. If no mapping exists at any level, a default mapping is applied

## 📊 Default Mappings

The application comes with a set of default mappings for common NSW vegetation formations. These provide a good starting point for most use cases.

## ⚙️ Technical Details

The vegetation mapping system consists of:

1. A database table for storing vegetation mappings
2. API endpoints for CRUD operations
3. A React component for managing mappings in the UI
4. A helper utility for dynamic mapping of vegetation formations

When vegetation analysis is performed, the system:

1. Queries NSW vegetation data for the specific location
2. Looks up the vegetation formation in the mappings database
3. Determines the appropriate vegetation category
4. Falls back to hardcoded mappings if no matching formation is found

## ➕ Adding Custom Mappings

To add a custom mapping:

1. Click the "⚙️ Configuration" button in the top navigation bar
2. Select the "Vegetation" tab
3. Click the "Add New Mapping" button
4. Fill in the formation name, class name (optional), type name (optional), and vegetation type
5. Check "Override parent settings" if you want this mapping to take precedence over parent mappings
6. Click "Save"

### Bulk Import

For importing thousands of vegetation types from CSV data, use the provided import script:

```bash
node scripts/import_vegetation_csv.js
```

This will parse the vegetation.csv file and create the appropriate hierarchy of mappings.

## 📈 Impact on Calculations

The vegetation mapping directly affects:

- Equipment selection (which equipment can operate in specific terrain)
- Fire break calculations (different vegetation types have different clearing factors)
- Resource allocation recommendations

## ✅ Benefits

- **Flexibility**: Update vegetation classifications without code changes
- **Accuracy**: Fine-tune mappings based on local knowledge
- **Maintainability**: Separate configuration from code
