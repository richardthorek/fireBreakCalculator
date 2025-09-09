import { MachinerySpec } from '../types/config';
import { logger } from './logger';

// clearingrates.csv is no longer used. All equipment data should come from the
// equipment API/Table storage. Keep a small compatibility shim so any code
// importing this module gets an empty list and a helpful log message.

export function loadMachineryFromCSV(): MachinerySpec[] {
  logger.info('clearingrates.csv import disabled: equipment should be loaded from API/table storage');
  return [];
}

export default loadMachineryFromCSV();
