#!/usr/bin/env node
/**
 * Close the loop — turn real play into the north-star.
 *
 * The game emits window.__telemetry on every run (variant, score, pickups, duration). This plays
 * each VARIANT headless N times, reads that telemetry, and aggregates per-variant PERFORMANCE. That
 * flips the system's success metric from "asset rubric score" (does it look good?) to "which variant
 * actually performs in play?" — the data flywheel: production telemetry feeds back into which
 * variant the generate->grade pipeline should make more of. Here it's local Playwright runs; in
 * production it's the ad-network's performance webhook landing in the same shape.
 *
 * Run:  node pipeline/agentic/collect-telemetry.mjs --n 4   (needs the built dist/)
 */
import { chromium } from '@playwright/test';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const VARIANTS = ['classic', 'rush', 'zen'];
const RUNS = Number(arg('n', 4));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const runs = [];
for (const variant of VARIANTS) {
  for (let i = 0; i < RUNS; i++) {
    await page.goto(`file://${join(ROOT, 'dist', 'index.html')}?variant=${variant}&test=fastend`, {
      waitUntil: 'load',
    });
    // fast-end auto-plays then sets window.__telemetry on the end card — wait for it.
    const t = await page
      .waitForFunction(() => window.__telemetry, null, { timeout: 8000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    if (t) {
      runs.push(t);
      appendFileSync(join(OUT, 'telemetry-log.jsonl'), JSON.stringify(t) + '\n');
    }
  }
}
await browser.close();

// ---- aggregate per variant ----
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const perVariant = VARIANTS.map((v) => {
  const r = runs.filter((x) => x.variant === v);
  const avgScore = Math.round(mean(r.map((x) => x.score)));
  const avgPickups = +mean(r.map((x) => x.pickups)).toFixed(1);
  const avgDurationS = +mean(r.map((x) => x.durationS)).toFixed(1);
  // engagement = the play-quality signal we optimise for (score + collection density)
  const engagement = avgScore + avgPickups * 5;
  return { variant: v, runs: r.length, avgScore, avgPickups, avgDurationS, engagement };
});
const totalEng = perVariant.reduce((s, v) => s + v.engagement, 0) || 1;
perVariant.forEach((v) => (v.winSharePct = Math.round((v.engagement / totalEng) * 100)));
perVariant.sort((a, b) => b.engagement - a.engagement);
const winner = perVariant[0];

const performance = {
  source: 'local playwright runs (stand-in for the ad-network performance webhook)',
  metric: 'engagement = avgScore + avgPickups×5',
  totalRuns: runs.length,
  perVariant,
  winner: winner ? winner.variant : null,
  recommendation: winner
    ? `Generate more variants in the "${winner.variant}" direction; it leads on real play (${winner.winSharePct}% engagement share).`
    : 'No telemetry collected.',
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, 'performance.json'), JSON.stringify(performance, null, 2));
console.log(
  `Collected ${runs.length} runs. Winner: ${performance.winner} ` +
    `(${perVariant.map((v) => `${v.variant}:${v.engagement}`).join(', ')})`
);
