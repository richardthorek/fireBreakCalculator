// Small E2E test runner that calls the local Functions endpoints.
// This script expects the Functions host to be running on http://localhost:7071

const BASE = process.env.FUNC_BASE || 'http://localhost:7071/api';

async function create(payload:any) {
  const res = await fetch(`${BASE}/equipment`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const json = await res.json().catch(()=>null);
  console.log('CREATE', res.status, json?.id || json?.error || 'no-json');
  return { status: res.status, body: json };
}

async function run(){
  console.log('E2E base', BASE);
  const machinery = {
    id: 'test-dozer',
    name: 'Test Dozer',
    description: 'E2E test dozer',
    allowedTerrain: ['flat','medium'],
    allowedVegetation: ['grassland'],
    clearingRate: 1000,
    costPerHour: 100
  };
  const aircraft = {
    id: 'test-helo',
    name: 'Test Helicopter',
    description: 'E2E test aircraft',
    allowedTerrain: ['flat'],
    allowedVegetation: ['grassland'],
    dropLength: 100,
    costPerHour: 2000
  };
  const hand = {
    id: 'test-crew',
    name: 'Test Crew',
    description: 'E2E test hand crew',
    allowedTerrain: ['flat','medium'],
    allowedVegetation: ['grassland'],
    crewSize: 4,
    clearingRatePerPerson: 60,
    costPerHour: 300
  };

  const m = await create({ ...machinery, type: 'Machinery' });
  const a = await create({ ...aircraft, type: 'Aircraft' });
  const h = await create({ ...hand, type: 'HandCrew' });

  const listRes = await fetch(`${BASE}/equipment?type=Machinery`);
  console.log('LIST Machinery', listRes.status);
  const listJson = await listRes.json().catch(()=>null);
  console.log('LIST count', Array.isArray(listJson)?listJson.length:listJson);

  if (m.status===201){
    const id = m.body.id;
    const upd = { ...m.body, name: m.body.name + ' (updated)', version: m.body.version };
    const put = await fetch(`${BASE}/equipment/Machinery/${id}`, { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(upd) });
    console.log('UPDATE', put.status, await put.json().catch(()=>null));
    const del = await fetch(`${BASE}/equipment/Machinery/${id}`, { method: 'DELETE' });
    console.log('DELETE', del.status);
  }

  console.log('E2E done');
}

run().catch(e=>{ console.error(e); process.exit(1); });
