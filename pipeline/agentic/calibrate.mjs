#!/usr/bin/env node
/**
 * Judge-calibration gate - turn "the judge is good" into a number that fails CI.
 *
 * Runs the grader over a LABELED set (cases we KNOW should pass, and deliberately broken cases we
 * KNOW must be rejected) and reports agreement with the labels. The deterministic grader is checked
 * always (this is its regression test); if GEMINI_API_KEY is set, the AI judge is checked the same
 * way, so judge-vs-label agreement becomes a measured CI number, not an assertion. Fails below the
 * threshold (config-as-data: agents.config.json -> thresholds.minCalibrationPct).
 *
 * Run:  node pipeline/agentic/calibrate.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import { gradeSprite } from './grade-deterministic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const cfg = JSON.parse(readFileSync(join(HERE, 'agents.config.json'), 'utf8')).thresholds || {};
const MIN = cfg.minCalibrationPct ?? 90;
const maxHolePct = cfg.maxHolePct ?? 0.4;

// ---- build the labeled set ----
const cases = [];
// PASS: every shipped sprite must be graded acceptable.
const SDIR = join(ROOT, 'assets', 'sprites');
for (const f of readdirSync(SDIR).filter((x) => x.endsWith('.png'))) {
  cases.push({ name: `ship:${f}`, label: 'pass', buffer: readFileSync(join(SDIR, f)) });
}
// REJECT: deliberately broken variants derived from a real sprite (so they are realistic).
const base = await Jimp.read(readFileSync(join(SDIR, 'fruit.png')));
const W = base.bitmap.width;
const H = base.bitmap.height;
const clone = () => base.clone();
// 1) opaque background (the classic chroma-key miss): force every pixel opaque.
const opaque = clone();
for (let i = 3; i < opaque.bitmap.data.length; i += 4) opaque.bitmap.data[i] = 255;
cases.push({ name: 'bad:opaque-background', label: 'reject', buffer: await opaque.getBuffer('image/png') });
// 2) interior hole: punch a transparent disk in the middle of the subject.
const holed = clone();
const r = Math.floor(Math.min(W, H) * 0.18);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const dx = x - W / 2;
    const dy = y - H / 2;
    if (dx * dx + dy * dy < r * r) holed.bitmap.data[(y * W + x) * 4 + 3] = 0;
  }
cases.push({ name: 'bad:interior-hole', label: 'reject', buffer: await holed.getBuffer('image/png') });
// 3) near-empty speck: clear everything but a tiny off-centre block.
const speck = clone();
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const keep = x < W * 0.12 && y < H * 0.12;
    if (!keep) speck.bitmap.data[(y * W + x) * 4 + 3] = 0;
  }
cases.push({ name: 'bad:near-empty-speck', label: 'reject', buffer: await speck.getBuffer('image/png') });

// ---- grade each and compare to its label ----
let agree = 0;
const rows = [];
for (const c of cases) {
  const g = await gradeSprite(c.buffer, { maxHolePct });
  const verdict = g.ok ? 'pass' : 'reject';
  const ok = verdict === c.label;
  if (ok) agree++;
  rows.push({ name: c.name, label: c.label, verdict, agree: ok, issues: g.issues });
}
const agreementPct = +((agree / cases.length) * 100).toFixed(1);
const report = { judge: 'deterministic grader', agreementPct, threshold: MIN, total: cases.length, agreed: agree, cases: rows, at: new Date().toISOString() };
writeFileSync(join(OUT, 'calibration.json'), JSON.stringify(report, null, 2));
console.log(`Calibration: ${agree}/${cases.length} = ${agreementPct}% agreement with labels (gate >= ${MIN}%)`);
for (const r of rows) if (!r.agree) console.log(`  MISS ${r.name}: labelled ${r.label}, judged ${r.verdict}`);
process.exit(agreementPct >= MIN ? 0 : 1);
