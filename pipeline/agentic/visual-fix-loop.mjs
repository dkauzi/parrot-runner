#!/usr/bin/env node
/**
 * Product-level agentic loop - TWO agents fixing the end product itself.
 *
 *   Agent B (visual judge): looks at a screenshot of the BUILT game and decides if it looks right.
 *   Agent A (generator):    on a reject, regenerates the assets and rebuilds the game.
 * Repeat until Agent B is satisfied (or max iterations). Every iteration's screenshot + verdict is
 * logged so the dashboard shows the loop. This is the SaPPIA pattern applied to the playable, not
 * just to one sprite - exactly how it caught the "sprites have coloured background boxes" bug.
 *
 * Run:  GEMINI_API_KEY=... node pipeline/agentic/visual-fix-loop.mjs   (needs the built dist + key)
 */

import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const MAX = Number(process.env.VISUAL_MAX || 3);
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function screenshot() {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('file://' + join(ROOT, 'dist', 'index.html') + '?test=fastend', { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  const shot = await p.screenshot();
  await b.close();
  return shot;
}

async function judge(shot) {
  if (!key) return { ok: true, score: 0, issues: [], summary: 'no GEMINI_API_KEY - judging skipped' };
  const prompt =
    'You are a senior game designer doing VISUAL QA on a screenshot of a tropical-jungle flying ' +
    'collectible game. Are the collectible/tree sprites CLEAN cutouts (NO coloured rectangle boxes ' +
    'behind them)? Does the scene look polished and readable? Any rendering bugs? Respond ONLY JSON: ' +
    '{"ok": <boolean>, "score": <integer 1-5>, "issues": ["..."], "summary": "<one sentence>"}.';
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: shot.toString('base64') } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  );
  try {
    const json = await res.json();
    return JSON.parse(json.candidates[0].content.parts[0].text);
  } catch {
    return { ok: false, score: 0, issues: [`judge error (HTTP ${res.status})`], summary: 'judge unavailable' };
  }
}

// Agent A's fix: regenerate the sprites (mock judge, to spend the Gemini budget on the VISUAL judge,
// not the per-sprite judge) and rebuild the game.
function fix() {
  for (const a of ['fruit', 'coconut', 'banana', 'tree']) {
    execSync(`IMAGE_PROVIDER=pollinations node pipeline/agentic/run.mjs --asset ${a} --promote`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '' },
    });
  }
  execSync('npm run build:playable', { cwd: ROOT, stdio: 'inherit' });
}

const history = [];
let verdict;
for (let i = 1; i <= MAX; i++) {
  const shot = await screenshot();
  writeFileSync(join(OUT, 'game-screenshot.png'), shot);
  verdict = await judge(shot);
  history.push({ iteration: i, ok: verdict.ok, score: verdict.score, issues: verdict.issues, summary: verdict.summary });
  console.log(`Iteration ${i}: ${verdict.ok ? 'OK ✓' : 'ISSUES'} (${verdict.score}/5) - ${verdict.summary}`);
  if (verdict.ok || i === MAX) break;
  console.log('Agent A fixing: regenerating assets + rebuilding...');
  fix();
}

verdict.at = new Date().toISOString();
verdict.model = model;
writeFileSync(join(OUT, 'visual-eval.json'), JSON.stringify(verdict, null, 2));
writeFileSync(join(OUT, 'visual-loop.json'), JSON.stringify({ model, at: verdict.at, history }, null, 2));
console.log(`\nVisual fix loop done after ${history.length} iteration(s).`);
process.exit(verdict.ok ? 0 : 1);
