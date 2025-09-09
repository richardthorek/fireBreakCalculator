# Scripts folder — secrets & safe usage

Important: these scripts interact with Azure Table Storage and previously contained a hard-coded connection string which triggered GitHub push protection (secret scanning).

What changed
- Scripts now read the Azure Tables connection string from the environment variable `TABLES_CONNECTION_STRING`.
- The repository no longer contains hard-coded secrets in these scripts.

How to run locally
1. Set the environment variable in PowerShell (temporary for session):

```powershell
$env:TABLES_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net'
node remove_max_slope.js
```

2. Or create a local `.env` file in the `scripts/` folder (DO NOT commit it). You can copy `scripts/.env.example` and fill real values.

Security notes
- Never commit real secrets. If a secret was committed in past commits, follow GitHub's guidance to rotate the secret (e.g., regenerate the storage key) and remove it from commit history using tools like `git filter-repo` or `git rebase --interactive`.
- If your push is blocked by GitHub push protection, either remove the secret from the commit history or use the GitHub Security UI to temporarily allow the push after rotating the secret (not recommended).

If you need help rotating a leaked key or rewriting commit history, ask and I'll provide concrete steps.

Note about `api/local.settings.json`
-----------------------------------
If you previously committed `api/local.settings.json` with real secrets, this repository has been updated to remove those values and replace them with placeholders. If your keys were exposed in commits, you must rotate those keys in Azure (regenerate storage account keys) and remove the secret from the git history using a tool like `git filter-repo`. If you need step-by-step help, request guidance and include whether you have permission to rotate keys.
