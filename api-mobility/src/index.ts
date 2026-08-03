import { app } from '@azure/functions';

// Import all functions to ensure they're registered with the app.
// mobilityJobOrchestrator registers the orchestrator + its activities as a
// side effect of import, same as the HTTP-triggered functions below.
import './functions/mobilityJobOrchestrator';
import './functions/mobilityJobSubmit';
import './functions/mobilityJobStatus';

app.setup({
  enableHttpStream: true,
});
