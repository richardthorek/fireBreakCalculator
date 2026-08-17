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
    { type: 'way', tags: { highway: 'track', name: 'Old Mill Rd', surface: 'gravel', tracktype: 'grade3' }, geometry: [
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
  check('surface/tracktype tags pass through for the road-speed model (docs §35)',
    (r1.trails[0] as any).surface === 'gravel' && (r1.trails[0] as any).tracktype === 'grade3');
  check('untagged smoothness stays undefined, not fabricated',
    (r1.trails[0] as any).smoothness === undefined);

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

  // --- 'highway-mobility' queries the wider set (motorway/trunk/primary),
  //     deliberately different from the default fire-break REUSABLE_HIGHWAYS
  //     query (docs §35) — verified by inspecting the actual Overpass query
  //     body sent, not just the response. ---
  _clearInfrastructureCache();
  let lastBody = '';
  setFetch(async (_url: string, init?: any) => {
    lastBody = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
    return okJson(overpassBody);
  });
  await fetchCorridorInfrastructure(-35.0, 148.0, -34.9, 148.1, 'highway' as any);
  const defaultQuery = lastBody;
  _clearInfrastructureCache();
  await fetchCorridorInfrastructure(-35.0, 148.0, -34.9, 148.1, 'highway-mobility' as any);
  const mobilityQuery = lastBody;
  check('default highway query excludes motorway (fire-break reusable set)',
    !defaultQuery.includes('motorway'));
  check("'highway-mobility' query includes motorway/trunk/primary",
    mobilityQuery.includes('motorway') && mobilityQuery.includes('trunk') && mobilityQuery.includes('primary'));
  check("'highway-mobility' still includes track (rural AU coverage)",
    mobilityQuery.includes('track'));

  // --- OSM water relations (docs §35 addendum, 2026-07-28) — a real,
  // live-confirmed gap: multipolygon water bodies (Lake Tuggeranong,
  // Gungahlin Pond — both Canberra-region, both `relation` not `way` in
  // real OSM data) were previously never requested or parsed at all, so a
  // profile with no fording capability could cross one uncontested. Shape
  // below matches Overpass's REAL `out geom` response for a relation
  // (confirmed live): `members[].geometry` is inlined directly, no
  // recursion needed. ---
  _clearInfrastructureCache();
  setFetch(async (_url: string, init?: any) => {
    lastBody = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
    return okJson({
      elements: [
        {
          type: 'relation',
          tags: { natural: 'water', name: 'Lake Testown' },
          members: [
            { type: 'way', role: 'outer', geometry: [
              { lat: -35.0, lon: 149.0 }, { lat: -35.0, lon: 149.1 }, { lat: -34.9, lon: 149.1 }, { lat: -35.0, lon: 149.0 },
            ] },
            { type: 'way', role: 'inner', geometry: [
              { lat: -34.98, lon: 149.05 }, { lat: -34.98, lon: 149.06 }, { lat: -34.97, lon: 149.05 },
            ] },
            { type: 'way', role: 'outer', geometry: [{ lat: -35.0, lon: 149.0 }] }, // too short, must be dropped
            { type: 'node', role: 'admin_centre' }, // not a way, must be dropped
          ],
        },
      ],
    });
  });
  const relationResult = await fetchCorridorInfrastructure(-35.1, 148.9, -34.8, 149.2, 'water' as any);
  check("'water' query now also requests relation[natural=water]", lastBody.includes('relation["natural"="water"]'));
  check('relation outer member becomes a water trail, inner member does not',
    relationResult.trails.length === 1, `got ${relationResult.trails.length} trail(s)`);
  check('relation trail carries the relation\'s own name and kind=water',
    relationResult.trails[0]?.name === 'Lake Testown' && relationResult.trails[0]?.kind === 'water');
  check('relation trail carries the outer member\'s full geometry (lon→lng mapped)',
    relationResult.trails[0]?.coords.length === 4 && relationResult.trails[0]?.coords[0].lng === 149.0);

  // --- Full multipolygon reassembly (docs §35 addendum, 2026-07-28) — MUST
  // match the webapp's identical `waterRelationTopology.test.ts` behaviour. ---
  _clearInfrastructureCache();
  const sw = { lat: -35.00, lon: 149.00 };
  const se = { lat: -35.00, lon: 149.02 };
  const ne = { lat: -34.98, lon: 149.02 };
  const nw = { lat: -34.98, lon: 149.00 };
  const islandSw = { lat: -34.991, lon: 149.008 };
  const islandSe = { lat: -34.991, lon: 149.012 };
  const islandNe = { lat: -34.989, lon: 149.012 };
  const islandNw = { lat: -34.989, lon: 149.008 };
  const islandRing = [islandSw, islandSe, islandNe, islandNw, islandSw];
  setFetch(async () => okJson({
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Split-Ring Lake With Island' },
      members: [
        { type: 'way', role: 'outer', geometry: [sw, se] },
        { type: 'way', role: 'outer', geometry: [se, ne] },
        { type: 'way', role: 'outer', geometry: [ne, nw, sw] },
        { type: 'way', role: 'inner', geometry: islandRing },
      ],
    }],
  }));
  const stitchedResult = await fetchCorridorInfrastructure(-35.1, 148.9, -34.8, 149.2, 'water' as any);
  check('a three-fragment outer ring stitches into exactly ONE water trail',
    stitchedResult.trails.length === 1, `got ${stitchedResult.trails.length}`);
  check('the stitched ring is genuinely closed (first point === last point)', (() => {
    const c = stitchedResult.trails[0]?.coords ?? [];
    return c.length >= 4 && c[0].lat === c[c.length - 1].lat && c[0].lng === c[c.length - 1].lng;
  })());
  check('the closed inner member is attached as a hole on the stitched outer trail',
    (stitchedResult.trails[0] as any)?.holes?.length === 1, `got ${JSON.stringify((stitchedResult.trails[0] as any)?.holes)}`);

  // A genuinely unstitchable fragment (no matching endpoint anywhere) must
  // still surface as a plain edge feature, not crash and not fabricate a
  // false closure.
  _clearInfrastructureCache();
  setFetch(async () => okJson({
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Broken Relation' },
      members: [{ type: 'way', role: 'outer', geometry: [{ lat: -35.2, lon: 149.3 }, { lat: -35.19, lon: 149.31 }] }],
    }],
  }));
  const brokenResult = await fetchCorridorInfrastructure(-35.3, 149.2, -35.1, 149.4, 'water' as any);
  check('an unstitchable fragment still surfaces as ONE edge-only trail, no crash',
    brokenResult.trails.length === 1 && (brokenResult.trails[0] as any).holes === undefined);

  // --- Concurrency limiter (2026-08-17 — a production 502 + client-side
  // Overpass CORS failure traced to Overpass's per-IP CONCURRENT-connection
  // quota, not a rate limit). Five requests for five DISTINCT bboxes (no
  // cache collisions) fired at once must never have more than
  // OVERPASS_MAX_CONCURRENT (default 2, no env override in this test
  // process) outbound fetches in flight simultaneously, while still
  // genuinely overlapping — not silently serialised to one at a time. ---
  _clearInfrastructureCache();
  {
    let inFlight = 0;
    let peakInFlight = 0;
    const resolvers: (() => void)[] = [];
    setFetch(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise<void>(resolve => resolvers.push(resolve));
      inFlight--;
      return okJson(overpassBody);
    });

    const bboxes: [number, number, number, number][] = [
      [-30.0, 140.0, -29.9, 140.1],
      [-31.0, 141.0, -30.9, 141.1],
      [-32.0, 142.0, -31.9, 142.1],
      [-33.0, 143.0, -32.9, 143.1],
      [-34.0, 144.0, -33.9, 144.1],
    ];
    const pending = bboxes.map(([s, w, n, e]) => fetchCorridorInfrastructure(s, w, n, e));

    // Let the microtask queue settle so every call that's going to start has
    // started, then release one held fetch at a time — each release should
    // let exactly one queued call step in, never spiking peakInFlight higher.
    await new Promise(resolve => setImmediate(resolve));
    check('at most OVERPASS_MAX_CONCURRENT (2) requests are ever in flight at once',
      peakInFlight <= 2, `peak was ${peakInFlight}`);
    check('the cap is actually reached, not accidentally serialised to 1 at a time',
      peakInFlight === 2, `peak was ${peakInFlight}`);

    while (resolvers.length > 0) {
      resolvers.shift()!();
      await new Promise(resolve => setImmediate(resolve));
      check(`peak in-flight stays capped after a release (${resolvers.length} release(s) left)`,
        peakInFlight <= 2, `peak was ${peakInFlight}`);
    }
    const results = await Promise.all(pending);
    check('every queued request eventually completes successfully',
      results.every(r => r.available === true && r.trails.length === 1));
  }

  setFetch(origFetch as any);
  if (failures > 0) {
    console.error(`\n${failures} infrastructure check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll infrastructure checks passed.');
}

run().catch(e => { console.error(e); process.exit(1); });
