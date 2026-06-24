#!/usr/bin/env node
/**
 * Visual QA — play the built game, screenshot ACTUAL GAMEPLAY, and verify it two ways:
 *   1. DETERMINISTIC checks (always run): stray magenta/pink in the scene = leftover chroma-key.
 *   2. AI judge (strict game-designer): upside-down bird, texture seams, dirty cutouts, etc.
 * The AI is not trusted alone (it gave a buggy frame 5/5 once); the deterministic check is the
 * floor. Captures during play (not the end card) so it sees the real thing. Writes screenshot +
 * verdict for the dashboard.
 *
 * Run:  GEMINI_API_KEY=... node pipeline/agentic/visual-eval.mjs   (needs the built dist + a key)
 */

import { chromium } from '@playwright/test';
import { Jimp } from 'jimp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

// ---- capture real gameplay (start a run, let it play, then snapshot) ----
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('file://' + join(ROOT, 'dist', 'index.html'), { waitUntil: 'load' });
await page.click('#start-btn').catch(() => {});
await page.waitForTimeout(1200);
const shot = await page.screenshot();
await browser.close();
writeFileSync(join(OUT, 'game-screenshot.png'), shot);

// ---- DETERMINISTIC check: stray magenta/pink (leftover chroma-key) anywhere in the frame ----
const img = await Jimp.read(shot);
const d = img.bitmap.data;
let magenta = 0;
for (let i = 0; i < d.length; i += 4) {
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  if (r > 170 && b > 120 && g < Math.min(r, b) - 50) magenta++; // pink/magenta: R&B high, G low
}
const magentaPct = (magenta / (d.length / 4)) * 100;
const detIssues = [];
if (magentaPct > 1.5) detIssues.push(`stray magenta/pink in ${magentaPct.toFixed(1)}% of the frame (leftover chroma-key)`);

// ---- AI judge (strict) ----
const key = process.env.GEMINI_API_KEY;
let ai = { issues: [], score: null, summary: 'AI judge skipped (no key)' };
if (key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt =
    'You are a STRICT senior game-designer doing visual QA on a GAMEPLAY screenshot of a tropical-' +
    'jungle flying collectible game. Hunt for DEFECTS and report each: is the bird/parrot upright ' +
    'and flying forward (NOT upside-down or nose-diving)? Are collectible/tree sprites clean cutouts ' +
    '(no coloured background boxes)? Any visible texture SEAMS or mirrored tiling on the ground? ' +
    'Stray pink/magenta blotches? Floating or wrongly-scaled objects? Be harsh: 5 = flawless. ' +
    'Respond ONLY JSON: {"score": <integer 1-5>, "issues": ["..."], "summary": "<one sentence>"}.';
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
    ai = { model, ...JSON.parse(json.candidates[0].content.parts[0].text) };
  } catch {
    // AI judge is a failure point — when it's down, do NOT fail; the deterministic gate decides.
    ai = { issues: [], score: null, summary: `AI judge unavailable (HTTP ${res.status}) — deterministic checks used`, unavailable: true };
  }
}

const issues = [...detIssues, ...(ai.issues || [])];
const verdict = {
  ok: issues.length === 0, // deterministic OR AI issue fails it — code is the floor, AI adds taste
  score: ai.score,
  issues,
  summary: ai.summary,
  deterministic: { magentaPct: Number(magentaPct.toFixed(1)), issues: detIssues },
  model: ai.model || 'deterministic-only',
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, 'visual-eval.json'), JSON.stringify(verdict, null, 2));
console.log('Visual QA:', JSON.stringify(verdict));
process.exit(verdict.ok ? 0 : 1);
