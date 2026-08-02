#!/usr/bin/env node
/**
 * Runs every `webapp/tests/*.test.ts` file under tsx, one process each — the
 * project's existing framework-free convention (plain node:assert, matches
 * the api package's `test:unit`). Was previously undocumented, run-by-hand
 * only (per docs/ROUTE_INTELLIGENCE.md: "All run via `npx tsx`") and never
 * wired into CI — closed as part of OCOKA 1 (docs/ROUTE_INTELLIGENCE.md §47)
 * so the vocabulary migration's blast radius is actually verifiable.
 *
 * Fails fast on the first file that exits non-zero, but reports every file
 * run before that point.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Live-network tests, excluded from the default (and CI) run: they call a
// real external endpoint and their pass/fail tracks that endpoint's
// reachability from wherever the run happens, not this codebase's
// correctness. master_plan.md has documented this exact file's failure as
// pre-existing and unrelated across many prior verification notes (steps 23,
// 35, 42-46) — this list makes that exclusion explicit and mechanical instead
// of "expect one known failure" living only in commit messages. Run
// individually with `npx tsx webapp/tests/<file>` to check connectivity by hand.
const LIVE_DATA_TESTS = new Set(['nvis-fidelity.test.ts']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(__dirname, '..', 'tests');
const includeLive = process.argv.includes('--include-live');
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => includeLive || !LIVE_DATA_TESTS.has(f))
  .sort();

if (!includeLive && LIVE_DATA_TESTS.size > 0) {
  console.log(`Skipping ${LIVE_DATA_TESTS.size} live-network test file(s): ${[...LIVE_DATA_TESTS].join(', ')} (pass --include-live to run them)`);
}

if (files.length === 0) {
  console.error('No test files found in', testsDir);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const full = path.join(testsDir, file);
  console.log(`\n--- ${file} ---`);
  const result = spawnSync('npx', ['tsx', full], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (result.status !== 0) {
    failures++;
    console.error(`✗ ${file} FAILED`);
  }
}

console.log(`\n${files.length - failures}/${files.length} test files passed.`);
process.exit(failures > 0 ? 1 : 0);
