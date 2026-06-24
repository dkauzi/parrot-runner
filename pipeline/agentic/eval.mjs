#!/usr/bin/env node
/**
 * Golden evaluation — the regression that guards the JUDGE itself.
 *
 * The judge is an LLM, and LLMs drift (a model swap silently moves our quality bar). So we keep a
 * small GOLDEN SET of labeled cases with known-correct verdicts: real accepted sprites that should
 * pass, and a deliberately bad image that should be rejected. This runs the judge over them and
 * reports its AGREEMENT with the known labels. If agreement drops, the EVALUATOR regressed — caught
 * here, before it quietly corrupts every future grade. This is "feed inputs whose perfect outcome
 * we know" applied to the judge.
 *
 * Run with a real judge:  GEMINI_API_KEY=... node pipeline/agentic/eval.mjs   (mock isn't a real
 * evaluator, so this is a local/periodic check, not a CI-on-every-commit gate.)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJudge } from './judge.mjs';
import { scoreVerdict } from './rubric.mjs';
import { encodePngRGBA } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const THRESHOLD = 18;

/** A deliberately bad collectible: a flat opaque gray square — off-theme, no silhouette, no alpha. */
function solidGray() {
  const s = 256;
  const d = Buffer.alloc(s * s * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 128;
    d[i + 3] = 255;
  }
  return encodePngRGBA(s, s, d);
}
const sprite = (name) => () => readFileSync(join(ROOT, 'assets', 'sprites', name));

const CASES = [
  { name: 'fruit (real, good)', buffer: sprite('fruit.png'), expect: 'accept' },
  { name: 'coconut (real, good)', buffer: sprite('coconut.png'), expect: 'accept' },
  { name: 'banana (real, good)', buffer: sprite('banana.png'), expect: 'accept' },
  { name: 'gray square (deliberately bad)', buffer: solidGray, expect: 'reject' },
];

const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.GEMINI_API_KEY ? 'gemini' : 'mock';
const model =
  provider === 'gemini'
    ? process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    : provider === 'anthropic'
      ? process.env.JUDGE_MODEL || 'claude-opus-4-8'
      : 'mock';
const apiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
const judge = getJudge(provider);

const results = [];
let agree = 0;
for (const c of CASES) {
  let got = 'error';
  try {
    const r = await judge({ buffer: c.buffer(), asset: 'fruit', model, apiKey });
    if (r.ok) {
      const s = scoreVerdict(r.verdict);
      got = s.ok && s.total >= THRESHOLD && s.weak.length === 0 ? 'accept' : 'reject';
    }
  } catch (e) {
    got = `error: ${e.message}`;
  }
  const match = got === c.expect;
  if (match) agree++;
  results.push({ name: c.name, expect: c.expect, got, match });
  console.log(`${match ? 'PASS' : 'FAIL'}  ${c.name}: expected ${c.expect}, judge said ${got}`);
}

const agreement = Math.round((agree / CASES.length) * 100);
console.log(`\nJudge agreement with golden labels: ${agreement}% (${agree}/${CASES.length})  via ${provider}:${model}`);
if (provider === 'mock') console.log('NOTE: mock judge is not a real evaluator — run with GEMINI_API_KEY for a meaningful result.');

mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(
  join(HERE, 'out', 'golden-eval.json'),
  JSON.stringify({ agreement, total: CASES.length, provider, model, at: new Date().toISOString(), results }, null, 2)
);
process.exit(agreement >= 75 ? 0 : 1);
