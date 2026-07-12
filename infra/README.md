# Infrastructure

Everything the app runs on is defined in [`main.bicep`](main.bicep) and deployed by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) in one pipeline:
**build → test → provision → deploy**. The Static Web App deployment token is fetched
at deploy time (`az staticwebapp secrets list`), so deleting and recreating the Azure
resources never breaks CI — re-running the workflow rebuilds the whole environment.

## Resources provisioned

| Resource | Purpose |
| --- | --- |
| Storage Account (`Standard_LRS`) + tables `equipment`, `vegetation` | Equipment specs and vegetation formation mappings |
| Static Web App (Free/Standard) | React frontend + managed Azure Functions API |
| Azure AI Foundry account + model deployment (optional, `deployAiAssistant`) | Grounded briefings/chat for the Plan Assistant — see below |
| SWA app settings | `TABLES_CONNECTION_STRING`, `EQUIPMENT_TABLE_NAME`, `VEGETATION_TABLE_NAME`, `DEM_IMAGESERVER_URL`, `AI_FOUNDRY_ENDPOINT`, `AI_FOUNDRY_API_KEY`, `AI_FOUNDRY_DEPLOYMENT_NAME` |

### Elevation data source (`DEM_IMAGESERVER_URL`)

The `/api/elevation/profile` endpoint samples a bare-earth DEM server-side (one
request per line) for accurate slope. Set the `demImageServerUrl` Bicep
parameter (→ `DEM_IMAGESERVER_URL` app setting) to an ArcGIS **ImageServer**
that supports `getSamples` — e.g. the Geoscience Australia national 1‑second /
5 m DEM. **Verify the exact endpoint** against
<https://services.ga.gov.au/> before production. Leave it empty to fall back to
client-side Mapbox Terrain-RGB (the app still works, just less accurate).

Pass it at deploy time by adding to the workflow's `az deployment group create`:
`--parameters demImageServerUrl="https://…/ImageServer"`.

### AI assistant (`deployAiAssistant`)

Off by default — the app is fully functional without it (the rule-based Plan
Assistant is the deterministic core; see `docs/AI_ASSISTANT.md` for the
grounding contract that keeps the AI layer honest). To enable:

```bash
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters deployAiAssistant=true aiFoundryLocation=eastus2 \
               aiModelName=gpt-4o-mini aiModelVersion=2024-07-18
```

**Verify before first deploy** (this Bicep was written without access to a
live `az`/Bicep compiler in this session — sanity-checked by hand against
known-good patterns, but not mechanically validated):
- `Microsoft.CognitiveServices/accounts` API version `2024-10-01` and `kind: 'AIServices'` are current for your subscription (`az provider show --namespace Microsoft.CognitiveServices`).
- `aiModelName`/`aiModelVersion` are available in `aiFoundryLocation` (model availability varies by region — check the [Azure AI Foundry model catalog](https://ai.azure.com)).
- Quota for the chosen `aiModelCapacity` (GlobalStandard, thousands of tokens/minute) exists in the subscription/region.

Run a `--what-if` first: `az deployment group create --what-if ...` with the
same parameters, before applying for real.

## One-time Azure setup (OIDC — no long-lived credentials)

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
RG=rg-firebreakcalc            # must match the AZURE_RESOURCE_GROUP variable (or default)
REPO=richardthorek/fireBreakCalculator

# 1. App registration + service principal
APP_ID=$(az ad app create --display-name firebreakcalc-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID" --output none

# 2. Federated credentials for this repo (main branch + PRs)
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-main\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]}"
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-prs\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:${REPO}:pull_request\",
  \"audiences\": [\"api://AzureADTokenExchange\"]}"

# 3. Grant Contributor on the resource group (create it first)
az group create --name "$RG" --location australiaeast
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RG}"

echo "AZURE_CLIENT_ID=$APP_ID"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID"
```

## GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | app registration client id from above |
| `AZURE_TENANT_ID` | Entra tenant id |
| `AZURE_SUBSCRIPTION_ID` | subscription id |
| `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox public token (URL-restrict it in the Mapbox dashboard) |

**Variables** (optional):

| Variable | Default |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | `rg-firebreakcalc` |
| `AZURE_LOCATION` | `australiaeast` |

## Seeding data

After first provisioning the tables are empty. Seed equipment via the running API:

```bash
API_BASE_URL=https://<your-swa-hostname>/api node scripts/seed_data.js
```

## Local development

Set `TABLES_CONNECTION_STRING` in `api/local.settings.json` (Azurite works:
`UseDevelopmentStorage=true`). See [README-local-dev.md](../README-local-dev.md).
