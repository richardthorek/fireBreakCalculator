import { app } from '@azure/functions';

// Import all functions to ensure they're registered with the app
import './functions/equipmentCreate';
import './functions/equipmentDelete';
import './functions/equipmentList';
import './functions/equipmentUpdate';
import './functions/vegetationMappingCreate';
import './functions/vegetationMappingDelete';
import './functions/vegetationMappingList';
import './functions/vegetationMappingUpdate';

app.setup({
    enableHttpStream: true,
});
