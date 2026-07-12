import { app } from '@azure/functions';

// Import all functions to ensure they're registered with the app
import './functions/analysisCalculate';
import './functions/assistantBriefing';
import './functions/assistantChat';
import './functions/elevationProfile';
import './functions/equipmentCreate';
import './functions/equipmentDelete';
import './functions/equipmentList';
import './functions/equipmentSeed';
import './functions/equipmentUpdate';
import './functions/planCreate';
import './functions/planDelete';
import './functions/planList';
import './functions/planUpdate';
import './functions/vegetationMappingCreate';
import './functions/vegetationMappingDelete';
import './functions/vegetationMappingList';
import './functions/vegetationMappingUpdate';

app.setup({
    enableHttpStream: true,
});
