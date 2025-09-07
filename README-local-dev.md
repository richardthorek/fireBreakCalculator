# Local Development Setup

Quick setup guide for developers working on the Fire Break Calculator.

## Prerequisites

- **Node.js 18+** and npm
- **Azure Functions Core Tools v4** (for local API development)
- **Azure Storage account** OR **Azurite** for local development
- **Mapbox account** and access token

## Environment Configuration

### 1. API Configuration
Create `api/local.settings.json` (excluded from git):

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node", 
    "TABLES_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "EQUIPMENT_TABLE_NAME": "equipment"
  }
}
```

### 2. Web Application Configuration  
Create `webapp/.env` (excluded from git):

```bash
VITE_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here
# Optional: Override API endpoint (defaults to dev proxy)
# VITE_API_BASE_URL=http://localhost:7071/api
```

## Installation & Startup

```bash
# Clone and install dependencies
git clone <repo-url>
cd rfsFireBreakCalculator

# Install API dependencies
cd api && npm install && cd ..

# Install webapp dependencies  
cd webapp && npm install && cd ..

# Start both services (use separate terminals)
cd api && npm start          # Azure Functions host (port 7071)
cd webapp && npm run dev     # Vite dev server (port 5173)
```

The web application will be available at `http://localhost:5173` and will automatically proxy API requests to the Functions host.

## Seeding Initial Data

Populate the database with sample equipment and vegetation mappings:

```bash
# For local development (uses default local endpoints)
node scripts/seed_data.js

# For remote API
export API_BASE_URL=https://your-api-url.azurewebsites.net/api
node scripts/seed_data.js
```

## Development Commands

### API (Azure Functions)
```bash
cd api
npm start           # Start local Functions host
npm run build       # Compile TypeScript
npm test            # Run tests (placeholder)
```

### Web Application
```bash
cd webapp  
npm run dev         # Start development server with HMR
npm run build       # Production build
npm run preview     # Preview production build
```

## Production Deployment

### Azure Infrastructure
1. **Storage Account** - Azure Table Storage for data
2. **Function App** - Linux, Node 18 runtime for API
3. **Static Web App** - For hosting the frontend (or Web App)

### Environment Variables (Production)
| Component | Variable | Description |
|-----------|----------|-------------|
| API | `TABLES_CONNECTION_STRING` | Azure Storage connection string |
| API | `EQUIPMENT_TABLE_NAME` | Table name (default: `equipment`) |
| Web | `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox API token |

### Build & Deploy Process
```bash
# Build API
cd api && npm run build

# Build webapp
cd webapp && npm run build

# Deploy using Azure CLI, GitHub Actions, or manual upload
```

For detailed deployment steps, see the main [README](README.md) deployment section.

## Common Development Issues

### Map Not Loading
- Verify `VITE_MAPBOX_ACCESS_TOKEN` is set correctly
- Check browser console for authentication errors
- Confirm Mapbox token has required permissions

### API Connection Issues  
- Ensure Azure Functions host is running (port 7071)
- Check `local.settings.json` configuration
- Verify Azurite is running for local storage emulation

### Build Errors
- Clear `node_modules` and reinstall if dependency issues
- Ensure Node.js version 18+ is being used
- Check for TypeScript compilation errors

---

For comprehensive project information, see the main [README](README.md).
