/**
 * Unit tests for the server-side Overpass proxy: endpoint fallback, caching,
 * honest failure, and result normalisation. Global fetch is stubbed so no real
 * network is touched.
 */
import { fetchCorridorInfrastructure, _clearInfrastructureCache } from '../services/infrastructureService';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

type FetchStub = (url: string, init?: any) => Promise<any>;
const origFetch = globalThis.fetch;
function setFetch(stub: FetchStub) {
  (globalThis as any).fetch = stub;
}
const okJson = (body: any) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// One OSM way (a track) with 3 geometry points, plus a node that must be
// filtered out (not a way / no geometry).
const overpassBody = {
  elements: [
    { type: 'way', tags: { highway: 'track', name: 'Old Mill Rd' }, geometry: [
      { lat: -35.30, lon: 148.00 }, { lat: -35.29, lon: 148.01 }, { lat: -35.28, lon: 148.02 },
    ] },
    { type: 'node', lat: -35.3, lon: 148.0 },
    { type: 'way', tags: { highway: 'path' }, geometry: [{ lat: -35.3, lon: 148.0 }] }, // too short
  ],
};

async function run() {
  // --- happy path: parses ways, filters non-ways/short ways, maps lon→lng ---
  _clearInfrastructureCache();
  let calls = 0;
  setFetch(async () => { calls++; return okJson(overpassBody); });
  const r1 = await fetchCorridorInfrastructure(-35.31, 147.99, -35.27, 148.03);
  check('available on success', r1.available === true);
  check('parses exactly the one valid way', r1.trails.length === 1, `${r1.trails.length}`);
  check('maps OSM lon→lng and keeps name/kind',
    r1.trails[0].kind === 'track' && r1.trails[0].name === 'Old Mill Rd' &&
    r1.trails[0].coords.length === 3 && r1.trails[0].coords[0].lng === 148.00);

  // --- cache: identical bbox does not re-hit the network ---
  const callsBefore = calls;
  const r2 = await fetchCorridorInfrastructure(-35.31, 147.99, -35.27, 148.03);
  check('identical bbox served from cache (no new fetch)', calls === callsBefore && r2.trails.length === 1);

  // --- endpoint fallback: first endpoint throws, second succeeds ---
  _clearInfrastructureCache();
  let seq = 0;
  setFetch(async () => {
    seq++;
    if (seq === 1) throw new Error('primary down');
    return okJson(overpassBody);
  });
  const r3 = await fetchCorridorInfrastructure(-36.0, 149.0, -35.9, 149.1);
  check('falls over to a second endpoint on failure', r3.available === true && r3.trails.length === 1);

  // --- non-OK status also triggers fallover / honest failure ---
  _clearInfrastructureCache();
  setFetch(async () => Promise.resolve({ ok: false, status: 504, json: async () => ({}) }));
  const r4 = await fetchCorridorInfrastructure(-34.0, 150.0, -33.9, 150.1);
  check('all endpoints non-OK → available:false, no trails', r4.available === false && r4.trails.length === 0);

  // --- total failure is NOT cached (a later attempt may succeed) ---
  let after = 0;
  setFetch(async () => { after++; return okJson(overpassBody); });
  const r5 = await fetchCorridorInfrastructure(-34.0, 150.0, -33.9, 150.1);
  check('failure not cached — retried and now succeeds', after > 0 && r5.available === true);

  setFetch(origFetch as any);
  if (failures > 0) {
    console.error(`\n${failures} infrastructure check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll infrastructure checks passed.');
}

run().catch(e => { console.error(e); process.exit(1); });
