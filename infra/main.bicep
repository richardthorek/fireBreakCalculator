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

@description('ArcGIS ImageServer URL for the bare-earth DEM used by the elevation-profile API. Leave empty to fall back to client-side Mapbox Terrain-RGB. Verify the endpoint before production.')
param demImageServerUrl string = ''

@description('Station Manager (StationKit) base URL used to validate suite sign-in tokens and read the fireBreakEnabled entitlement. Leave empty to disable account features (saved-plan endpoints return 503). This app\'s origin must also be present in Station Manager\'s FRONTEND_URLS for CORS.')
param suiteAuthUrl string = ''

@description('Provision the Azure AI Foundry account + model deployment for the AI assistant (grounded briefings/chat). Off by default so existing environments do not pick up new cost on redeploy; the app works with the deterministic rule engine either way.')
param deployAiAssistant bool = false

@description('Azure region for the AI Foundry account. Must support the chosen model; verify capacity/quota before enabling in a new region.')
param aiFoundryLocation string = 'eastus2'

@description('Model to deploy from the Foundry catalog (OpenAI-compatible chat completions).')
param aiModelName string = 'gpt-4o-mini'

@description('Model version. Verify the current supported version for aiModelName in the target region before deploying.')
param aiModelVersion string = '2024-07-18'

@description('Deployment throughput (thousands of tokens/minute for GlobalStandard). Kept low — this is a narration layer over deterministic data, not a high-volume workload.')
param aiModelCapacity int = 10

@description('Provision Application Insights (+ Log Analytics) and wire the managed Functions API to it. On by default: production observability is the single biggest gap — every field bug so far was found by users, not telemetry. The fallback-rate KPI (see api/src/services/telemetry.ts) is queryable from here.')
param deployMonitoring bool = true

@description('Monthly cost budget in the billing currency (0 disables the budget + alerts). A guard against runaway consumption-plan/AI spend from anonymous traffic.')
param monthlyBudget int = 0

@description('Email addresses notified at budget thresholds. Required (non-empty) for the budget to be created.')
param budgetAlertEmails array = []

@description('Budget start month (YYYY-MM). Defaults to the current month at deploy time; do not set manually. utcNow() is only valid as a parameter default.')
param budgetStartMonth string = utcNow('yyyy-MM')

var storageAccountName = toLower(replace('${baseName}${uniqueString(resourceGroup().id)}', '-', ''))
var swaName = '${baseName}-${environmentName}'
var aiFoundryName = take('${baseName}-ai-${environmentName}', 24)
var logAnalyticsName = '${baseName}-logs-${environmentName}'
var appInsightsName = '${baseName}-ai-insights-${environmentName}'

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

resource savedPlansTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'savedplans'
}

// Shared cross-user vegetation tile cache (see api/src/services/
// vegetationTileService.ts): raw NVIS export PNGs / NSW SVTM polygon JSON,
// keyed by quantised tile. First user at an incident pays the upstream
// fetch; everyone after reads the blob.
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource vegTilesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'vegtiles'
  properties: {
    publicAccess: 'None'
  }
}

// Vegetation changes on a timescale of years — a 365-day expiry means one
// upstream fetch effectively caches a tile for a whole fire season and
// beyond (the upstream canary watches for contract drift in between).
resource storageLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'vegtiles-expiry'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['vegtiles/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 365
                }
              }
            }
          }
        }
      ]
    }
  }
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

// --- Observability: Log Analytics + Application Insights ---------------------
//
// The app degrades silently by design (flagged fallbacks), so without telemetry
// the production fallback rate — a safety KPI — is invisible. host.json already
// configures App Insights sampling; wiring the connection string below makes the
// managed Functions host emit to this component. Query the METRIC lines from
// api/src/services/telemetry.ts here to build the fallback-rate dashboard/alert.

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (deployMonitoring) {
  name: logAnalyticsName
  location: storageLocation
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (deployMonitoring) {
  name: appInsightsName
  location: storageLocation
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

// --- AI Foundry: model deployment backing the assistant (briefings + chat) --
//
// Optional (deployAiAssistant). The assistant is a NARRATION layer only — see
// docs/AI_ASSISTANT.md's grounding contract — so the app is fully functional
// with this off; the rule-based Plan Assistant covers the deterministic core.
// Local auth (API key) is used for simplicity, matching this project's other
// external integrations; migrating to managed identity + Entra ID auth is a
// documented hardening follow-up, not a blocker for a first deployment.

resource aiFoundry 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (deployAiAssistant) {
  name: aiFoundryName
  location: aiFoundryLocation
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: aiFoundryName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

resource aiModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployAiAssistant) {
  parent: aiFoundry
  name: aiModelName
  sku: {
    name: 'GlobalStandard'
    capacity: aiModelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: aiModelName
      version: aiModelVersion
    }
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
    SAVED_PLANS_TABLE_NAME: 'savedplans'
    // Suite auth (Station Manager). Empty → saved-plan endpoints return 503 and
    // the webapp hides account features; the calculator stays fully anonymous.
    SUITE_AUTH_URL: suiteAuthUrl
    // Observability. Empty → the managed Functions host simply emits no
    // telemetry; the app is unaffected.
    APPLICATIONINSIGHTS_CONNECTION_STRING: deployMonitoring ? appInsights.properties.ConnectionString : ''
    // Elevation profile source. Empty → API returns 'unavailable' and the client
    // falls back to Mapbox Terrain-RGB, so the app still works before this is set.
    DEM_IMAGESERVER_URL: demImageServerUrl
    // AI assistant. Empty → assistant endpoints report 'unavailable' and the
    // client falls back to the deterministic template/rule engine, so the app
    // still works before (or without) this being enabled.
    AI_FOUNDRY_ENDPOINT: deployAiAssistant ? aiFoundry.properties.endpoint : ''
    AI_FOUNDRY_API_KEY: deployAiAssistant ? aiFoundry.listKeys().key1 : ''
    AI_FOUNDRY_DEPLOYMENT_NAME: deployAiAssistant ? aiModelDeployment.name : ''
  }
}

// --- Cost guard: monthly budget with email alerts ---------------------------
//
// Anonymous, un-authed endpoints on consumption billing + optional AI tokens
// are a runaway-spend risk. The API rate-limits per client; this is the
// backstop that tells a human before a bill surprises them. Created only when a
// budget amount and at least one contact email are supplied.

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (monthlyBudget > 0 && !empty(budgetAlertEmails)) {
  name: '${baseName}-${environmentName}-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: '${budgetStartMonth}-01T00:00:00Z'
    }
    notifications: {
      actual_50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        contactEmails: budgetAlertEmails
        thresholdType: 'Actual'
      }
      actual_90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        contactEmails: budgetAlertEmails
        thresholdType: 'Actual'
      }
      forecast_100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        contactEmails: budgetAlertEmails
        thresholdType: 'Forecasted'
      }
    }
  }
}

// --- Outputs consumed by the deploy workflow --------------------------------

output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output storageAccountName string = storage.name
output aiFoundryEndpoint string = deployAiAssistant ? aiFoundry.properties.endpoint : ''
output appInsightsName string = deployMonitoring ? appInsights.name : ''
