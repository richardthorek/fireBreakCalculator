# Data Sources & API Documentation

This document provides comprehensive details about all external data sources, APIs, and services used by the RFS Fire Break Calculator, including required attributions and licensing information.

## 🗺️ Mapping & Geospatial Services

### Mapbox Platform
**Provider**: [Mapbox, Inc.](https://www.mapbox.com/)  
**Services Used**: Base maps, satellite imagery, terrain data, and map styling

#### Technical Integration
- **API Endpoint**: Mapbox Maps API v1
- **Tile Format**: Vector tiles (MVT) and raster tiles
- **Authentication**: Requires `VITE_MAPBOX_ACCESS_TOKEN` environment variable
- **Implementation**: Integrated via Leaflet.js with Mapbox tile layers

#### Usage Limits & Costs
- **Free Tier**: 200,000 tile requests per month
- **Paid Plans**: Usage-based pricing for higher volumes
- **Monitoring**: Track usage via Mapbox dashboard

#### Attribution Requirements
```html
© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> 
© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
```

#### License & Terms
- **License**: [Mapbox Terms of Service](https://www.mapbox.com/legal/tos)
- **Commercial Use**: Permitted under standard commercial license
- **Data Usage**: Subject to Mapbox data usage policies

---

## 🌿 Vegetation Data Sources

### NSW Department of Planning and Environment
**Provider**: [NSW Government](https://www.dpie.nsw.gov.au/)  
**Service**: Statewide Vegetation Type Mapping (SVTM) - NSW Extant Plant Community Types

#### Technical Integration
- **Service URL**: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`
- **Layer ID**: Layer 3 (PCT polygons with vegetation attributes)
- **Query Format**: ArcGIS REST API spatial queries
- **Response Format**: JSON with vegetation classification attributes

#### Data Attributes Used
- **`vegForm`**: Vegetation formation (primary classification)
- **`vegClass`**: Vegetation class (secondary classification)  
- **`PCTName`**: Plant Community Type name (detailed classification)

#### Coverage & Updates
- **Geographic Scope**: New South Wales, Australia
- **Data Currency**: Regularly updated by NSW Government
- **Accuracy**: High-resolution mapping based on field surveys and remote sensing
- **Update Frequency**: Periodic updates as new surveys are completed

#### Attribution Requirements
```html
Vegetation data © State of New South Wales through 
Department of Planning and Environment
```

#### License & Terms
- **License**: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- **Commercial Use**: Permitted with proper attribution
- **Data Quality**: Provided "as is" - see NSW Government data disclaimer
- **Terms**: Subject to [NSW Government Open Data Policy](https://www.digital.nsw.gov.au/policy/data-sharing/open-data-policy)

#### Mapping Logic
The application uses hierarchical vegetation mapping:
1. **Primary**: Vegetation formation (`vegForm`) 
2. **Secondary**: Vegetation class (`vegClass`)
3. **Tertiary**: Plant Community Type (`PCTName`)

See [`Documentation/VEGETATION_MAPPING.md`](VEGETATION_MAPPING.md) for detailed classification rules.

---

## ☁️ Backend Services & Storage

### Microsoft Azure Services
**Provider**: [Microsoft Azure](https://azure.microsoft.com/)  
**Services Used**: Azure Functions, Table Storage, hosting infrastructure

#### Azure Functions API
- **Runtime**: Node.js 18 TypeScript
- **Endpoints**: Equipment CRUD, vegetation mapping management
- **Authentication**: Currently open (production should implement Azure AD)
- **Scaling**: Automatic serverless scaling based on demand

#### Azure Table Storage
- **Purpose**: Equipment specifications and vegetation mapping configurations
- **Tables**: 
  - `equipment`: Machinery, aircraft, and hand crew specifications
  - `vegetationMappings`: Custom vegetation classification rules
- **Consistency**: Strong consistency with optimistic concurrency control
- **Backup**: Automated Azure backup policies

#### Data Privacy & Security
- **Data Residency**: Configurable Azure region (recommend Australia East)
- **Encryption**: At rest and in transit using Azure standards
- **Access Control**: Configurable via Azure IAM (not implemented in demo)
- **Compliance**: Azure SOC, ISO 27001, and other certifications

---

## 📊 Elevation Data

### Current Implementation
**Status**: Mock elevation service for demonstration purposes

#### Mock Service Details
- **Algorithm**: Generates realistic terrain variation
- **Coverage**: ±50m elevation changes along routes
- **Performance**: Client-side calculation for immediate response
- **Accuracy**: Not suitable for production planning

### Planned Integration
**Target Services**: Real elevation data integration planned for future releases

#### Option 1: Google Elevation API
- **Provider**: Google Cloud Platform
- **Coverage**: Global elevation data
- **Resolution**: 30m SRTM data or better
- **Pricing**: Usage-based, free tier available
- **Attribution**: © Google

#### Option 2: Geoscience Australia
- **Provider**: Australian Government
- **Service**: ELVIS (Elevation Information System)
- **Coverage**: High-resolution Australian elevation data
- **License**: Creative Commons (varies by dataset)
- **Attribution**: © Commonwealth of Australia (Geoscience Australia)

---

## 🔧 Equipment Data

### Equipment Specifications
**Source**: Configurable via application API and seed data
**Management**: Administrative interface for CRUD operations

#### Data Sources
- **Manufacturer Specifications**: Official equipment documentation
- **Operational Data**: Field-tested performance metrics
- **Cost Information**: Industry-standard pricing (Australian dollars)
- **Capability Ratings**: Expert assessment of terrain and vegetation suitability

#### Data Quality
- **Validation**: API-level validation for required fields and ranges
- **Versioning**: Optimistic concurrency control prevents data conflicts
- **Audit Trail**: Creation and modification timestamps tracked
- **Backup**: Regular Azure Table Storage backups

---

## 📱 Application Configuration

### Environment Variables
All external service integrations require proper environment configuration:

```bash
# Required for map functionality
VITE_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here

# Optional API override (defaults to /api proxy)
VITE_API_BASE_URL=https://your-api.azurewebsites.net/api

# Azure backend (production)
TABLES_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
EQUIPMENT_TABLE_NAME=equipment
```

### Rate Limiting & Caching
- **Mapbox**: Implements client-side tile caching
- **NSW Vegetation**: Simple grid-based caching (~100m resolution)
- **Elevation**: Results cached until route modification
- **Equipment API**: No caching (low volume, infrequent changes)

---

## 🔒 Privacy & Compliance

### Data Collection
- **No Personal Data**: Application does not collect or store personal information
- **Location Data**: Map coordinates used only for analysis (not stored)
- **Usage Analytics**: None implemented (consider privacy-friendly analytics)

### Third-Party Data Sharing
- **Mapbox**: May receive aggregated usage statistics
- **NSW Government**: Read-only access to public vegetation data
- **Azure**: Standard cloud hosting data processing

### Compliance Considerations
- **Australian Privacy Act**: No personal data collected
- **GDPR**: Not applicable (no EU personal data)
- **Government Data**: Complies with NSW Open Data terms

---

## 📈 Usage Monitoring

### Recommended Monitoring
- **Mapbox Usage**: Monitor tile requests via Mapbox dashboard
- **Azure Costs**: Track Function executions and storage usage
- **API Performance**: Monitor response times and error rates
- **Service Availability**: Implement health checks for external dependencies

### Cost Optimization
- **Mapbox**: Implement appropriate zoom level restrictions
- **Azure**: Use consumption-based pricing for low-traffic scenarios
- **Vegetation API**: Cache responses to minimize repeat queries
- **Elevation**: Batch requests when possible (future enhancement)

---

*For technical implementation details, see individual service documentation in [`webapp/Documentation/`](../webapp/Documentation/)*

**Last Updated**: January 2025