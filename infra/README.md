# Infrastructure

Everything the app runs on is defined in [`main.bicep`](main.bicep) and deployed by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) in one pipeline:
**build → test → provision → deploy**. The Static Web App deployment token is fetched
at deploy time (`az staticwebapp secrets list`), so deleting and recreating the Azure
resources never breaks CI — re-running the workflow rebuilds the whole environment.

## Resources provisioned

| Resource | Purpose |
| --- | --- |
| Storage Account (`Standard_LRS`) + tables `equipment`, `vegetation`, `savedplans` | Equipment specs, vegetation formation mappings, cloud saved plans |
| Static Web App (Free/Standard) | React frontend + managed Azure Functions API |
| Application Insights + Log Analytics workspace (`deployMonitoring`, on by default) | Production telemetry incl. the fallback-rate KPI — see below |
| Azure AI Foundry account + model deployment (optional, `deployAiAssistant`) | Grounded briefings/chat for the Plan Assistant — see below |
| Monthly cost budget + email alerts (optional, `monthlyBudget` + `budgetAlertEmails`) | Backstop against runaway anonymous/AI spend — see below |
| SWA app settings | `TABLES_CONNECTION_STRING`, `EQUIPMENT_TABLE_NAME`, `VEGETATION_TABLE_NAME`, `SAVED_PLANS_TABLE_NAME`, `SUITE_AUTH_URL`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `DEM_IMAGESERVER_URL`, `AI_FOUNDRY_ENDPOINT`, `AI_FOUNDRY_API_KEY`, `AI_FOUNDRY_DEPLOYMENT_NAME` |

### Observability (`deployMonitoring`, on by default)

Provisions Application Insights (workspace-based) + a Log Analytics workspace and
wires the managed Functions host via `APPLICATIONINSIGHTS_CONNECTION_STRING`
(`host.json` already configures sampling). The API emits structured `METRIC`
lines (see `api/src/services/telemetry.ts`) so the **fallback rate** — the
fraction of analyses running on estimated/fallback data, a safety KPI because the
app degrades silently — is queryable and alertable. The KQL to build that
dashboard/alert is in the telemetry file's header. Turn off with
`--parameters deployMonitoring=false` if you bring your own monitoring.

### Cost guard: rate limits + budget

The anonymous, un-authed endpoints (`/api/analysis/calculate`,
`/api/assistant/*`, `/api/elevation/profile`) fan out to metered upstreams on
consumption billing. Two layers protect against a scraped-token or scripted
wallet-drain:

1. **Per-IP rate limiting** in the API (`api/src/services/rateLimit.ts`),
   env-tunable via app settings: `RATE_LIMIT_ANON_PER_MIN` (default 30),
   `RATE_LIMIT_AUTHED_PER_MIN` (default 300), `RATE_LIMIT_WINDOW_SEC`
   (default 60), `RATE_LIMIT_DISABLED` (`true` to bypass). Signed-in Bushie
   Tools callers get the higher tier automatically.
2. **Budget alerts** — pass `monthlyBudget` (in the billing currency) and a
   non-empty `budgetAlertEmails` array to create a `Microsoft.Consumption`
   budget that emails at 50%/90% actual and 100% forecast. Omit either to skip.

### Mapbox token (client-side) — restrict it

`VITE_MAPBOX_ACCESS_TOKEN` ships in the client bundle and can be scraped, so a
public token drives quota/billing against your account. Use a **URL-restricted**
Mapbox public token (allow only your deployed origin[s]) so a scraped token is
useless off-site. This is a Mapbox account setting, not infra — set it when
issuing the token.

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
