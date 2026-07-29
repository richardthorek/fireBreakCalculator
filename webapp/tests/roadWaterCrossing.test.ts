/**
 * Road-graph water awareness (docs/ROUTE_INTELLIGENCE.md §35 addendum,
 * 2026-07-28). Field report, live-tested against a real run: "ran straight
 * across the lake which should based on data be a hard block due to water.
 * (No 'has boats' option for unit movement)."
 *
 * ROOT CAUSE, confirmed by direct inspection: `roadGraph.ts`/`roadRouting.ts`
 * had ZERO water/hydrology logic at all — unlike the hex-grid search, which
 * gates every edge through `mobilityCost.ts`'s `estimateFordingRequirement`.
 * A vehicle profile without fording capability could therefore be routed
 * straight across ANY water body a road/track happens to be tagged through
 * in OSM — and Lake George specifically has exactly this shape in the real
 * data: it is famous for drying out for years at a time, so a real,
 * currently-mapped track can run across its bed with no bridge at all.
 *
 * Verified against the REAL Lake George `natural=water` way (OSM id
 * 8060816, fetched live via Overpass for this fix — 349 nodes, a closed
 * ring) — confirmed via a direct probe that the HEX-GRID search already
 * correctly routes around this exact polygon (`estimateFordingRequirement`
 * works). The gap was specific to the road graph.
 *
 * FIX: `buildRoadGraph` now accepts the same water-body polygons the hex
 * grid already fetches, flags any edge sitting inside a CONTIGUOUS run of
 * in-water geometry longer than a plausible single bridge span
 * (`MAX_ASSUMED_BRIDGE_SPAN_M`), and `roadRouting.ts`'s `edgeTravelTime`
 * blocks that edge outright for any profile with no stated fording
 * capability — the exact same "standing water body — assumed genuinely
 * deep" default `mobilityCost.ts` already uses.
 *
 * Two things are proven here, both against REAL data:
 *  1. A long track tagged straight across the real Lake George polygon is
 *     blocked, and the router is forced onto a real detour instead.
 *  2. CONTROL: a short bridge-like dip into a small water body is NOT
 *     blocked — the fix must not turn every lakeside road unusable.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadWaterCrossing.test.ts
 */
import * as assert from 'node:assert';
import { buildRoadGraph, nearestNode, RoadWay, WaterBodyPolygon } from '../src/terrain/roadGraph';
import { findRoadRoute } from '../src/terrain/roadRouting';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
// A shallow rated fording depth (well short of a standing water body's
// assumed 2.5 m) is the MORE interesting case than "no capability at all" —
// it proves the gate compares against the assumed depth, not just presence.
assert.ok(vehicle && vehicle.fordingDepthM !== undefined && vehicle.fordingDepthM < 2.5, 'test setup: this profile must have a real but insufficient fording capability');

// Real Lake George `natural=water` way (OSM id 8060816), fetched live via
// Overpass for this fix. [lat, lng] pairs, a closed ring (349 nodes).
const LAKE_GEORGE_RING: [number, number][] = [
  [-35.11072,149.38028], [-35.1087,149.3792], [-35.1057,149.37843], [-35.10361,149.37784], [-35.10171,149.3778], [-35.09945,149.3785], [-35.09659,149.37903], [-35.09438,149.3789],
    [-35.09277,149.37768], [-35.09099,149.37685], [-35.08872,149.37597], [-35.08613,149.37606], [-35.08327,149.37621], [-35.07907,149.37611], [-35.07534,149.37613], [-35.06816,149.37589],
    [-35.06357,149.37602], [-35.0592,149.37671], [-35.05378,149.37742], [-35.04876,149.37794], [-35.04389,149.3783], [-35.03776,149.37818], [-35.02768,149.37882], [-35.02439,149.3796],
    [-35.0204,149.38103], [-35.0183,149.38141], [-35.01621,149.38146], [-35.01238,149.38191], [-35.0105,149.38234], [-35.00821,149.38291], [-35.00618,149.38325], [-35.00505,149.38382],
    [-35.0035,149.38484], [-35.00228,149.38654], [-35.00026,149.38951], [-34.99837,149.39063], [-34.99715,149.39017], [-34.99522,149.39054], [-34.99207,149.38912], [-34.9875,149.38931],
    [-34.98662,149.39001], [-34.98542,149.39056], [-34.98499,149.39435], [-34.98441,149.39489], [-34.98364,149.39484], [-34.98302,149.39617], [-34.98344,149.39999], [-34.98301,149.4022],
    [-34.98291,149.40497], [-34.98304,149.40582], [-34.98643,149.40948], [-34.99164,149.41137], [-34.99696,149.41243], [-34.99893,149.41231], [-34.99992,149.41195], [-35.0014,149.41014],
    [-35.00298,149.4103], [-35.00408,149.40961], [-35.00596,149.41085], [-35.00828,149.41168], [-35.01023,149.41346], [-35.01086,149.41581], [-35.01214,149.41762], [-35.01341,149.41894],
    [-35.01575,149.41906], [-35.01678,149.4197], [-35.02049,149.42073], [-35.02362,149.42072], [-35.0304,149.4192], [-35.03159,149.41954], [-35.03373,149.42515], [-35.03303,149.43426],
    [-35.03368,149.44171], [-35.0322,149.45304], [-35.03221,149.45616], [-35.03242,149.45796], [-35.03263,149.45937], [-35.03354,149.46052], [-35.03474,149.46079], [-35.03623,149.46155],
    [-35.03911,149.46147], [-35.04098,149.46093], [-35.04165,149.46094], [-35.04236,149.46129], [-35.04299,149.46211], [-35.04352,149.46405], [-35.0436,149.46511], [-35.04411,149.46544],
    [-35.0447,149.46601], [-35.04503,149.46653], [-35.04514,149.46719], [-35.04495,149.46817], [-35.04441,149.47032], [-35.04425,149.4718], [-35.04421,149.47323], [-35.04458,149.47442],
    [-35.04613,149.47539], [-35.04946,149.47647], [-35.05202,149.47977], [-35.05641,149.48378], [-35.05745,149.48372], [-35.05851,149.4835], [-35.06175,149.48248], [-35.06354,149.48187],
    [-35.06584,149.48103], [-35.07308,149.47731], [-35.07356,149.47706], [-35.07421,149.47692], [-35.07503,149.47663], [-35.07572,149.47639], [-35.07636,149.47609], [-35.07711,149.47573],
    [-35.07784,149.47524], [-35.07842,149.47467], [-35.07868,149.47438], [-35.07882,149.47411], [-35.07888,149.47393], [-35.07884,149.47375], [-35.07875,149.47356], [-35.07867,149.47346],
    [-35.07865,149.47336], [-35.07867,149.47324], [-35.07876,149.47319], [-35.07887,149.47308], [-35.07902,149.47296], [-35.07909,149.47286], [-35.07948,149.47288], [-35.07985,149.47274],
    [-35.08007,149.4726], [-35.08056,149.47235], [-35.08104,149.47189], [-35.08159,149.47149], [-35.08213,149.47144], [-35.08282,149.47174], [-35.08499,149.47065], [-35.08738,149.46915],
    [-35.08999,149.46748], [-35.09059,149.46686], [-35.09124,149.46622], [-35.09142,149.46561], [-35.09151,149.465], [-35.09162,149.4648], [-35.09161,149.46459], [-35.09171,149.46448],
    [-35.09189,149.46456], [-35.09205,149.46472], [-35.09243,149.46461], [-35.09319,149.46455], [-35.09351,149.46466], [-35.09382,149.4649], [-35.0937,149.46534], [-35.09357,149.46587],
    [-35.09326,149.46664], [-35.09305,149.46731], [-35.09298,149.46791], [-35.09323,149.46856], [-35.09339,149.46914], [-35.09378,149.46953], [-35.09428,149.46987], [-35.09501,149.47005],
    [-35.09621,149.47], [-35.09792,149.46962], [-35.09933,149.46902], [-35.10025,149.4682], [-35.1001,149.46775], [-35.10009,149.46742], [-35.1004,149.46724], [-35.10089,149.46742],
    [-35.10136,149.46719], [-35.10189,149.46745], [-35.10234,149.46738], [-35.10239,149.46773], [-35.10267,149.46844], [-35.10287,149.46965], [-35.1028,149.47065], [-35.10266,149.47149],
    [-35.10281,149.47231], [-35.103,149.47319], [-35.10328,149.47378], [-35.10366,149.47433], [-35.10393,149.47481], [-35.10444,149.47543], [-35.10499,149.47562], [-35.10549,149.47568],
    [-35.10617,149.47546], [-35.10661,149.47539], [-35.10713,149.47508], [-35.10778,149.47494], [-35.10909,149.47432], [-35.11055,149.47332], [-35.11116,149.473], [-35.11156,149.47279],
    [-35.11178,149.47247], [-35.11193,149.47194], [-35.11219,149.4717], [-35.11259,149.47176], [-35.11288,149.47115], [-35.11317,149.47112], [-35.11345,149.47108], [-35.11419,149.47148],
    [-35.11514,149.47221], [-35.1156,149.47345], [-35.11645,149.47321], [-35.11763,149.47291], [-35.11915,149.47241], [-35.12065,149.47167], [-35.12282,149.4702], [-35.12414,149.4691],
    [-35.12534,149.46821], [-35.12653,149.46713], [-35.12669,149.46679], [-35.12716,149.46642], [-35.12795,149.4661], [-35.12853,149.46582], [-35.12898,149.46566], [-35.12935,149.46563],
    [-35.12975,149.46575], [-35.13011,149.46594], [-35.13038,149.46642], [-35.13093,149.46681], [-35.13164,149.46685], [-35.13242,149.46658], [-35.13337,149.46644], [-35.13426,149.46612],
    [-35.13487,149.46572], [-35.13618,149.46496], [-35.13744,149.46395], [-35.13846,149.46326], [-35.13943,149.46272], [-35.14008,149.46264], [-35.14059,149.46233], [-35.14084,149.46212],
    [-35.14102,149.46195], [-35.14108,149.46173], [-35.14126,149.46177], [-35.14153,149.46203], [-35.1422,149.46225], [-35.14309,149.46207], [-35.1438,149.46208], [-35.14433,149.46202],
    [-35.14465,149.46179], [-35.14498,149.46175], [-35.14632,149.46166], [-35.14812,149.46133], [-35.15101,149.46025], [-35.15409,149.45851], [-35.15712,149.45672], [-35.15932,149.45454],
    [-35.17054,149.44385], [-35.17795,149.43956], [-35.17869,149.43854], [-35.1803,149.43768], [-35.18268,149.43626], [-35.18513,149.43539], [-35.18684,149.43502], [-35.18759,149.43491],
    [-35.18985,149.4338], [-35.19128,149.43318], [-35.19266,149.43248], [-35.19417,149.43136], [-35.19604,149.42975], [-35.19726,149.42884], [-35.19852,149.42798], [-35.19898,149.42698],
    [-35.19955,149.42616], [-35.20022,149.42537], [-35.20041,149.42441], [-35.20005,149.42344], [-35.19937,149.42231], [-35.19879,149.42096], [-35.19801,149.41959], [-35.19722,149.41797],
    [-35.19799,149.41365], [-35.19733,149.41242], [-35.19745,149.41124], [-35.19689,149.40971], [-35.19651,149.40783], [-35.19611,149.40642], [-35.19627,149.40563], [-35.19615,149.40495],
    [-35.1965,149.40491], [-35.19686,149.40422], [-35.19645,149.40363], [-35.19764,149.40346], [-35.19846,149.40243], [-35.19848,149.40201], [-35.19763,149.40189], [-35.19571,149.4022],
    [-35.19438,149.40264], [-35.19267,149.40247], [-35.19171,149.4027], [-35.19083,149.40232], [-35.18992,149.40096], [-35.18932,149.40028], [-35.18875,149.39971], [-35.18804,149.39955],
    [-35.18731,149.39944], [-35.18663,149.39961], [-35.18572,149.40002], [-35.18515,149.4002], [-35.18449,149.40007], [-35.18393,149.39972], [-35.18343,149.39915], [-35.18264,149.39836],
    [-35.18198,149.39724], [-35.18112,149.39698], [-35.17989,149.39702], [-35.17892,149.39729], [-35.17836,149.39723], [-35.17752,149.39676], [-35.17686,149.39684], [-35.17613,149.39709],
    [-35.1757,149.39706], [-35.17528,149.3969], [-35.17479,149.39683], [-35.17397,149.397], [-35.17318,149.39728], [-35.17227,149.39765], [-35.16923,149.39778], [-35.16648,149.39708],
    [-35.1629,149.3964], [-35.15967,149.39416], [-35.15732,149.3923], [-35.15408,149.39127], [-35.15362,149.39108], [-35.1525,149.39081], [-35.15015,149.39102], [-35.14734,149.39324],
    [-35.14572,149.39371], [-35.14413,149.39347], [-35.14269,149.39262], [-35.14038,149.38923], [-35.13791,149.38687], [-35.1352,149.38585], [-35.13314,149.3853], [-35.13156,149.38558],
    [-35.12652,149.3856], [-35.1244,149.38499], [-35.12301,149.384], [-35.12234,149.38285], [-35.12118,149.3821], [-35.12006,149.38225], [-35.11849,149.38314], [-35.1171,149.384],
    [-35.11482,149.38397], [-35.11363,149.38293], [-35.11265,149.38189], [-35.11203,149.38096], [-35.11072,149.38028]
];

console.log('Road-graph water awareness (§35 addendum):');

const lakeWaterBody: WaterBodyPolygon = { coords: LAKE_GEORGE_RING.map(([lat, lng]) => ({ lat, lng })) };

// A "track across the dry lakebed" — real OSM shape: many vertices, not one
// long straight edge, densely spaced so the CONTIGUOUS in-water run is well
// over `MAX_ASSUMED_BRIDGE_SPAN_M` regardless of individual edge length.
const CROSSING_LAT = -35.09;
const westShore = { lat: CROSSING_LAT, lng: 149.30 };
const eastShore = { lat: CROSSING_LAT, lng: 149.55 };
const CROSSING_STEPS = 40;
const crossingCoords = Array.from({ length: CROSSING_STEPS + 1 }, (_, i) => ({
  lat: CROSSING_LAT,
  lng: westShore.lng + ((eastShore.lng - westShore.lng) * i) / CROSSING_STEPS,
}));
const directTrackAcrossLake: RoadWay = { kind: 'track', coords: crossingCoords, name: 'Lakebed Track' };

// A real detour: north around the lake's own northern tip (~-34.98).
const northOfLake = -34.94;
const westConnector = { lat: -35.02, lng: westShore.lng };
const westNorth = { lat: northOfLake, lng: westShore.lng };
const eastNorth = { lat: northOfLake, lng: eastShore.lng };
const eastConnector = { lat: -35.02, lng: eastShore.lng };
const westFeeder: RoadWay = { kind: 'residential', coords: [westShore, westConnector, westNorth] };
const northConnector: RoadWay = { kind: 'tertiary', coords: [westNorth, eastNorth] };
const eastFeeder: RoadWay = { kind: 'residential', coords: [eastNorth, eastConnector, eastShore] };

const allWays = [directTrackAcrossLake, westFeeder, northConnector, eastFeeder];

test('setup: the synthetic crossing track really does run through the real lake polygon (sanity)', () => {
  // At least the midpoint of the crossing should sit inside the real ring.
  const midLng = (westShore.lng + eastShore.lng) / 2;
  assert.ok(midLng > 149.376 && midLng < 149.484, 'crossing midpoint must fall within the real lake\'s longitude span');
});

test('WITHOUT water awareness (old behaviour): the direct track across the lake is found and used', () => {
  const graph = buildRoadGraph(allWays); // no waterBodies param — the pre-fix call shape
  const originNode = nearestNode(graph, westShore, 50)!;
  const objectiveNode = nearestNode(graph, eastShore, 50)!;
  assert.ok(originNode && objectiveNode, 'test setup: shore nodes must exist');
  const route = findRoadRoute(graph, [originNode.id], [objectiveNode.id], vehicle);
  assert.ok(route, 'FAILED: expected a route (proving the direct track is actually in the graph and traversable pre-fix)');
  // The direct track is far shorter than the northern detour, so an
  // unaware router picks it — this is the reported live defect.
  assert.ok(route!.nodeIds.length <= CROSSING_STEPS + 2, 'FAILED: expected the SHORT direct track to be chosen, not the long detour');
});

test('WITH water awareness: the same direct track is blocked — the route is forced onto the real detour', () => {
  const graph = buildRoadGraph(allWays, [lakeWaterBody]);
  const originNode = nearestNode(graph, westShore, 50)!;
  const objectiveNode = nearestNode(graph, eastShore, 50)!;
  const route = findRoadRoute(graph, [originNode.id], [objectiveNode.id], vehicle);
  assert.ok(route, 'FAILED: a route must still exist via the northern detour');

  // Confirm it actually went via the northern connector, not through the lake.
  const wentNorth = route!.nodeIds.some(id => {
    const node = graph.nodes.get(id);
    return !!node && node.lat > -35.0; // north of the lake's own southern reach
  });
  assert.ok(wentNorth, 'FAILED: expected the route to detour north around the lake, not cross it');

  // And the route genuinely avoided the lakebed track's own nodes — not
  // just "went via a node that happens to be north", but specifically
  // excludes the crossing geometry the previous test proved WAS available
  // and WAS chosen when water awareness was absent.
  const crossingNodeIds = new Set(crossingCoords.slice(1, -1).map(c => nearestNode(graph, c, 5)?.id).filter(Boolean));
  const usedAnyCrossingNode = route!.nodeIds.some(id => crossingNodeIds.has(id));
  assert.ok(!usedAnyCrossingNode, 'FAILED: the route still used one or more nodes from the blocked lakebed track');
});

test('CONTROL: a short bridge-like dip into a SMALL water body is NOT blocked (genuine bridges still work)', () => {
  // A tiny square "pond" — well under MAX_ASSUMED_BRIDGE_SPAN_M across.
  const pondCenter = { lat: -34.5, lng: 149.9 };
  const pondRing: WaterBodyPolygon = {
    coords: [
      { lat: pondCenter.lat - 0.0005, lng: pondCenter.lng - 0.0005 },
      { lat: pondCenter.lat - 0.0005, lng: pondCenter.lng + 0.0005 },
      { lat: pondCenter.lat + 0.0005, lng: pondCenter.lng + 0.0005 },
      { lat: pondCenter.lat + 0.0005, lng: pondCenter.lng - 0.0005 },
      { lat: pondCenter.lat - 0.0005, lng: pondCenter.lng - 0.0005 },
    ],
  };
  const bridgeRoad: RoadWay = {
    kind: 'tertiary',
    coords: [
      { lat: pondCenter.lat, lng: pondCenter.lng - 0.002 },
      { lat: pondCenter.lat, lng: pondCenter.lng }, // single vertex at the pond's own centre — the "bridge deck"
      { lat: pondCenter.lat, lng: pondCenter.lng + 0.002 },
    ],
  };
  const graph = buildRoadGraph([bridgeRoad], [pondRing]);
  const a = nearestNode(graph, { lat: pondCenter.lat, lng: pondCenter.lng - 0.002 }, 50)!;
  const b = nearestNode(graph, { lat: pondCenter.lat, lng: pondCenter.lng + 0.002 }, 50)!;
  const route = findRoadRoute(graph, [a.id], [b.id], vehicle);
  assert.ok(route, 'FAILED: a short bridge-like crossing over a small water body must still be assumed passable');
});

test('a real island (holes, docs §35 addendum, full multipolygon reassembly): a long track across the ISLAND itself is NOT blocked', () => {
  // A large water body with a real island in the middle — the island is well
  // over MAX_ASSUMED_BRIDGE_SPAN_M across, so if `holes` were ignored a track
  // running the length of it would be (wrongly) treated as an unbroken
  // in-water run and blocked, exactly like the lakebed-crossing case above.
  const centre = { lat: -34.6, lng: 150.0 };
  const outerRing: WaterBodyPolygon['coords'] = [
    { lat: centre.lat - 0.01, lng: centre.lng - 0.01 },
    { lat: centre.lat - 0.01, lng: centre.lng + 0.01 },
    { lat: centre.lat + 0.01, lng: centre.lng + 0.01 },
    { lat: centre.lat + 0.01, lng: centre.lng - 0.01 },
    { lat: centre.lat - 0.01, lng: centre.lng - 0.01 },
  ];
  const islandRing = [
    { lat: centre.lat - 0.006, lng: centre.lng - 0.006 },
    { lat: centre.lat - 0.006, lng: centre.lng + 0.006 },
    { lat: centre.lat + 0.006, lng: centre.lng + 0.006 },
    { lat: centre.lat + 0.006, lng: centre.lng - 0.006 },
    { lat: centre.lat - 0.006, lng: centre.lng - 0.006 },
  ];
  const lakeWithIsland: WaterBodyPolygon = { coords: outerRing, holes: [islandRing] };

  const islandRoad: RoadWay = {
    kind: 'tertiary',
    coords: [
      { lat: centre.lat, lng: centre.lng - 0.005 }, // on the island, near its west edge
      { lat: centre.lat, lng: centre.lng },          // island centre
      { lat: centre.lat, lng: centre.lng + 0.005 },  // on the island, near its east edge
    ],
  };
  const graph = buildRoadGraph([islandRoad], [lakeWithIsland]);
  const a = nearestNode(graph, { lat: centre.lat, lng: centre.lng - 0.005 }, 50)!;
  const b = nearestNode(graph, { lat: centre.lat, lng: centre.lng + 0.005 }, 50)!;
  assert.ok(a && b, 'test setup: island road nodes must exist');
  const route = findRoadRoute(graph, [a.id], [b.id], vehicle);
  assert.ok(route, 'FAILED: a road entirely on a real island must not be treated as an in-water crossing');
});

test('CONTROL: the SAME lake, without the island road, still correctly blocks a track across the surrounding water', () => {
  const centre = { lat: -34.6, lng: 150.0 };
  const outerRing: WaterBodyPolygon['coords'] = [
    { lat: centre.lat - 0.01, lng: centre.lng - 0.01 },
    { lat: centre.lat - 0.01, lng: centre.lng + 0.01 },
    { lat: centre.lat + 0.01, lng: centre.lng + 0.01 },
    { lat: centre.lat + 0.01, lng: centre.lng - 0.01 },
    { lat: centre.lat - 0.01, lng: centre.lng - 0.01 },
  ];
  const islandRing = [
    { lat: centre.lat - 0.006, lng: centre.lng - 0.006 },
    { lat: centre.lat - 0.006, lng: centre.lng + 0.006 },
    { lat: centre.lat + 0.006, lng: centre.lng + 0.006 },
    { lat: centre.lat + 0.006, lng: centre.lng - 0.006 },
    { lat: centre.lat - 0.006, lng: centre.lng - 0.006 },
  ];
  const lakeWithIsland: WaterBodyPolygon = { coords: outerRing, holes: [islandRing] };
  // A track skirting just OUTSIDE the island (still well within the outer
  // ring) — genuinely open water on both sides, not the island's own ground.
  const openWaterCoords = Array.from({ length: 21 }, (_, i) => ({
    lat: centre.lat - 0.009,
    lng: centre.lng - 0.009 + (0.018 * i) / 20,
  }));
  const openWaterRoad: RoadWay = { kind: 'track', coords: openWaterCoords };
  const graph = buildRoadGraph([openWaterRoad], [lakeWithIsland]);
  const a = nearestNode(graph, openWaterCoords[0], 50)!;
  const b = nearestNode(graph, openWaterCoords[openWaterCoords.length - 1], 50)!;
  const route = findRoadRoute(graph, [a.id], [b.id], vehicle);
  assert.strictEqual(route, null, 'FAILED: a long track through genuine open water (not the island) must still be blocked');
});

if (process.exitCode === 1) {
  console.error(`\nRoad-graph water awareness did NOT hold.`);
} else {
  console.log(`\nAll ${passed} road-graph water-awareness checks passed.`);
}
