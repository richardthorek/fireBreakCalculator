/**
 * Unit tests for the vegetation tile cache's pure grid math — the contract
 * that MUST match webapp/src/utils/vegetationTiles.ts, and the index
 * validation guarding the anonymous endpoint.
 */
import { tileBounds, isValidTileIndex, NVIS_TILE_DEG, NSW_TILE_DEG } from '../services/vegetationTileService';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Grid constants are the cross-package contract.
check('NVIS tile size is 0.5°', NVIS_TILE_DEG === 0.5);
check('NSW tile size is 0.05°', NSW_TILE_DEG === 0.05);

// tileBounds: exact inverse of floor(coord / deg) indexing, negative-safe.
// Canberra region: lng 149.13 → tx 298 at 0.5°; lat -35.28 → ty -71.
const b = tileBounds(298, -71, NVIS_TILE_DEG);
check('tile 298/-71 covers Canberra lng', b.minLng === 149.0 && b.maxLng === 149.5, JSON.stringify(b));
check('tile 298/-71 covers Canberra lat', b.minLat === -35.5 && b.maxLat === -35.0, JSON.stringify(b));
check('index round-trips through floor()', Math.floor(149.13 / NVIS_TILE_DEG) === 298 && Math.floor(-35.28 / NVIS_TILE_DEG) === -71);

// Validation: Australian tiles accepted, junk and far-away tiles rejected.
check('valid Australian tile accepted', isValidTileIndex(298, -71, NVIS_TILE_DEG));
check('valid NSW-grid tile accepted', isValidTileIndex(3006, -675, NSW_TILE_DEG));
check('non-integer index rejected', !isValidTileIndex(298.5, -71, NVIS_TILE_DEG));
check('NaN index rejected', !isValidTileIndex(NaN, -71, NVIS_TILE_DEG));
check('Europe-ish tile rejected', !isValidTileIndex(20, 100, NVIS_TILE_DEG));
check('deep-ocean tile rejected', !isValidTileIndex(-200, -71, NVIS_TILE_DEG));

if (failures > 0) {
  console.error(`\n${failures} vegetation-tile check(s) failed`);
  process.exit(1);
}
console.log('\nAll vegetation-tile checks passed.');
