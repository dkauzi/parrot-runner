#!/usr/bin/env node
/**
 * Production gate: grade the SHIPPED sprites (assets/sprites/*.png) deterministically and fail the
 * build if any has an opaque background, bad coverage, off-centring, or interior holes. The pipeline
 * grades assets as they are generated; this re-checks what actually ships, so quality is verified
 * before prod no matter how an asset got into the repo. Wired into `npm run ci`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeSprite } from './grade-deterministic.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'assets', 'sprites');
const cfgPath = join(ROOT, 'pipeline', 'agentic', 'agents.config.json');
const maxHolePct = JSON.parse(readFileSync(cfgPath, 'utf8')).thresholds?.maxHolePct ?? 0.4;

let failed = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.png'))) {
  const r = await gradeSprite(readFileSync(join(DIR, f)), { maxHolePct });
  const tag = r.ok ? 'OK  ' : 'FAIL';
  console.log(`  ${tag} ${f.padEnd(14)} holes=${r.holePct}%  cover=${r.coveragePct}%  ${r.ok ? '' : JSON.stringify(r.issues)}`);
  if (!r.ok) failed++;
}
console.log(failed === 0 ? 'All shipped sprites pass the deterministic quality gate.' : `${failed} sprite(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
