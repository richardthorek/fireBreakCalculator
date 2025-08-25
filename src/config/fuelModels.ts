/**
 * Fuel Model data for hand crew productivity calculations.
 * Based on Table 3 from the fire break planning reference.
 * 
 * Data converted from feet/hour for 20-person crews to meters/hour per person:
 * Formula: (feet/hour ÷ 3.281) ÷ 20 = meters/hour per person
 * 
 * Crew Types:
 * - Type I: Interagency Hotshots Crews (IHC) - faster production, highly skilled
 * - Type II: Standard crews with lower production rates
 * 
 * Attack Methods:
 * - Direct: Attack fire directly at the edge
 * - Indirect: Create firebreaks away from the fire edge
 */

import { FuelModelSpec } from '../types/config';

export const fuelModels: FuelModelSpec[] = [
  {
    id: 'short-grass',
    name: '1 Short Grass',
    description: 'Short grass fuels with minimal ground cover',
    rates: {
      typeI: {
        direct: 17.1,   // 1,122 ft/hr ÷ 3.281 ÷ 20
        indirect: 9.6   // 627 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 9.6,    // 628 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.3   // 285 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'open-timber-grass',
    name: '2 Open Timber Grass',
    description: 'Open timber with grass understory',
    rates: {
      typeI: {
        direct: 16.6,   // Average of 792-1,386: 1,089 ft/hr ÷ 3.281 ÷ 20
        indirect: 9.6   // Average of 508-746: 627 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 9.5,    // Average of 396-858: 627 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.5   // Average of 198-396: 297 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'chaparral',
    name: '4 Chaparral',
    description: 'Dense shrubland with woody vegetation',
    rates: {
      typeI: {
        direct: 6.7,    // 436 ft/hr ÷ 3.281 ÷ 20
        indirect: 5.0   // 330 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 6.9,    // 449 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.0   // 264 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'brush',
    name: '5 Brush',
    description: 'Mixed brush and shrubland',
    rates: {
      typeI: {
        direct: 16.6,   // 1,089 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.9   // 323 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 7.1,    // 462 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.2   // 277 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'dormant-brush',
    name: '6 Dormant Brush/Hardwood Slash',
    description: 'Dormant brush and hardwood slash areas',
    rates: {
      typeI: {
        direct: 16.6,   // 1,089 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.9   // 323 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 7.1,    // 462 ft/hr ÷ 3.281 ÷ 20
        indirect: 4.2   // 277 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'closed-timber-litter',
    name: '8 Closed Timber Litter',
    description: 'Closed timber with forest litter',
    rates: {
      typeI: {
        direct: 10.6,   // 693 ft/hr ÷ 3.281 ÷ 20
        indirect: 6.9   // 455 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 7.1,    // 462 ft/hr ÷ 3.281 ÷ 20
        indirect: 5.7   // 376 ft/hr ÷ 3.281 ÷ 20
      }
    }
  },
  {
    id: 'hardwood-litter',
    name: '9 Hardwood Litter',
    description: 'Hardwood forest with leaf litter',
    rates: {
      typeI: {
        direct: 10.6,   // Average of 594-792: 693 ft/hr ÷ 3.281 ÷ 20
        indirect: 6.9   // Average of 396-515: 455.5 ft/hr ÷ 3.281 ÷ 20
      },
      typeII: {
        direct: 6.5,    // Average of 396-462: 429 ft/hr ÷ 3.281 ÷ 20
        indirect: 5.5   // Average of 264-462: 363 ft/hr ÷ 3.281 ÷ 20
      }
    }
  }
];