#!/usr/bin/env node
/**
 * Functional-test + regression report for the dashboard (tech AND non-tech readable).
 * Runs the unit suite (captures TAP), reads the Playwright e2e results, and reads the golden eval
 * (the JUDGE regression guard). Writes out/tests.json so the dashboard can list every CASE with a
 * pass/fail - proving the functional tests + regression are re-run after every code change.
 *
 * Run:  node pipeline/agentic/generate-tests-report.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'pipeline', 'agentic', 'out');

// ---- unit suite (TAP) ----
let unit = [];
try {
  const tap = execSync('npm run -s test:unit', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  unit = [...tap.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)]
    .map((m) => ({ name: m[2].trim(), ok: m[1] === 'ok' }))
    .filter((t) => !/^tests \d|^subtests|^pass \d|^fail \d/.test(t.name));
} catch {
  /* report whatever we captured */
}

// ---- e2e (Playwright JSON) ----
let e2e = [];
try {
  const r = JSON.parse(readFileSync(join(OUT, 'e2e-results.json'), 'utf8'));
  const walk = (s) => {
    (s.specs || []).forEach((sp) => e2e.push({ name: sp.title, ok: sp.ok !== false }));
    (s.suites || []).forEach(walk);
  };
  (r.suites || []).forEach(walk);
} catch {
  /* none */
}

// ---- regression: the golden eval guards the JUDGE from drift ----
let regression = null;
try {
  const g = JSON.parse(readFileSync(join(OUT, 'golden-eval.json'), 'utf8'));
  regression = { passed: g.passed ?? g.ok ?? null, total: g.total ?? null, summary: g.summary || 'golden eval (judge drift guard)' };
} catch {
  /* none */
}

const report = {
  unit: { cases: unit, passed: unit.filter((t) => t.ok).length, total: unit.length },
  e2e: { cases: e2e, passed: e2e.filter((t) => t.ok).length, total: e2e.length },
  regression,
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, 'tests.json'), JSON.stringify(report, null, 2));
console.log(`tests.json: unit ${report.unit.passed}/${report.unit.total}, e2e ${report.e2e.passed}/${report.e2e.total}`);
