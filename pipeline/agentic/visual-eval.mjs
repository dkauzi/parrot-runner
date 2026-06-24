#!/usr/bin/env node
/**
 * Visual QA — play the built game, screenshot it, and have the AI judge REVIEW THE LIVE SCENE.
 *
 * Functional e2e tests prove the game loads and the loop runs, but they can't see that (say) the
 * sprites have ugly colored background boxes. This launches the real playable, captures a frame,
 * and asks the game-designer AI judge "does this look right?" — catching visual regressions that
 * pass every functional test. The screenshot + verdict are written for the dashboard.
 *
 * Run:  GEMINI_API_KEY=... node pipeline/agentic/visual-eval.mjs   (needs the built dist + a key)
 */

import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const fileUrl = 'file://' + join(ROOT, 'dist', 'index.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${fileUrl}?test=fastend`, { waitUntil: 'load' });
await page.waitForTimeout(1000); // play a moment
const shot = await page.screenshot();
await browser.close();
writeFileSync(join(OUT, 'game-screenshot.png'), shot);
console.log('Screenshot saved: pipeline/agentic/out/game-screenshot.png');

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.log('No GEMINI_API_KEY — screenshot saved; skipping the AI visual judge.');
  process.exit(0);
}

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const prompt =
  'You are a senior game designer doing VISUAL QA on a screenshot of a tropical-jungle flying ' +
  'collectible game. Check carefully: (1) are the collectible/tree sprites CLEAN cutouts with ' +
  'transparent backgrounds — i.e. NO solid coloured rectangle boxes behind them? (2) does the ' +
  'scene look polished and readable (jungle background, a bird, fruit to collect, a ground)? ' +
  '(3) any obvious rendering bugs? Respond ONLY with JSON: ' +
  '{"ok": <boolean>, "score": <integer 1-5>, "issues": ["..."], "summary": "<one sentence>"}.';

const body = {
  contents: [
    { parts: [{ inline_data: { mime_type: 'image/png', data: shot.toString('base64') } }, { text: prompt }] },
  ],
  generationConfig: { responseMimeType: 'application/json', temperature: 0 },
};
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
);
let verdict;
try {
  const json = await res.json();
  verdict = JSON.parse(json?.candidates?.[0]?.content?.parts?.[0]?.text);
} catch {
  verdict = { ok: false, score: 0, issues: [`judge error (HTTP ${res.status})`], summary: 'judge unavailable' };
}
verdict.at = new Date().toISOString();
verdict.model = model;
writeFileSync(join(OUT, 'visual-eval.json'), JSON.stringify(verdict, null, 2));
console.log('Visual QA verdict:', JSON.stringify(verdict));
process.exit(verdict.ok ? 0 : 1);
