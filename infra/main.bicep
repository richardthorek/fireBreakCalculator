// ---------------------------------------------------------------------------
// Fire Break Calculator — Azure infrastructure (single source of truth)
//
// Provisions everything the application needs:
//   - Storage Account with Table Storage (equipment + vegetation tables)
//   - Static Web App (frontend + managed Azure Functions API)
//   - App settings on the SWA wiring the Functions API to Table Storage
//
// Deployed by .github/workflows/deploy.yml via `az deployment group create`.
// The workflow then fetches the SWA deployment token dynamically
// (`az staticwebapp secrets list`) so no deployment token ever needs to be
// stored as a GitHub secret — recreating the environment is one workflow run.
// ---------------------------------------------------------------------------

@description('Base name used to derive resource names. Lowercase letters/numbers.')
@minLength(3)
@maxLength(18)
param baseName string = 'firebreakcalc'

@description('Azure region for all resources. SWA is limited to specific regions.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param swaLocation string = 'eastasia' // closest SWA region to AU

@description('Region for the storage account (can differ from SWA).')
param storageLocation string = 'australiaeast'

@description('Static Web App SKU. Free is sufficient for evaluation; Standard adds SLA, auth customisation and more staging environments.')
@allowed(['Free', 'Standard'])
param swaSku string = 'Free'

@description('Environment tag (e.g. prod, staging).')
param environmentName string = 'prod'

var storageAccountName = toLower(replace('${baseName}${uniqueString(resourceGroup().id)}', '-', ''))
var swaName = '${baseName}-${environmentName}'

var tags = {
  application: 'fire-break-calculator'
  environment: environmentName
  managedBy: 'bicep'
}

// --- Storage: equipment + vegetation mapping tables -------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take(storageAccountName, 24)
  location: storageLocation
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource equipmentTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'equipment'
}

resource vegetationTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'vegetation'
}

// --- Static Web App (frontend + managed Functions API) ----------------------

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: swaLocation
  tags: tags
  sku: {
    name: swaSku
    tier: swaSku
  }
  properties: {
    // Content is deployed by the GitHub workflow with the deployment token;
    // no repository binding is required on the resource itself.
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

// Wire the managed Functions API to Table Storage. These names must match
// what api/src/data/tableClient.ts reads from process.env.
resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    TABLES_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${az.environment().suffixes.storage}'
    EQUIPMENT_TABLE_NAME: 'equipment'
    VEGETATION_TABLE_NAME: 'vegetation'
  }
}

// --- Outputs consumed by the deploy workflow --------------------------------

output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output storageAccountName string = storage.name
