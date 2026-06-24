#!/usr/bin/env node
/**
 * Simulate the ad-network performance webhook.
 *
 * In production the ad network posts one record per real session: which variant was shown, whether
 * the user clicked the CTA, whether they installed, and how long they played. This writes exactly
 * that feed (out/perf-webhook.jsonl) with realistic per-variant behaviour, so the collector can be
 * pointed at it instead of local Playwright runs - proving the "one-line swap" is real: same shape,
 * real-user KPIs (CTR, install rate, playtime), same dashboard panels.
 *
 * The numbers are simulated, not real, but the SHAPE and the path are identical to live.
 * Run:  node pipeline/agentic/simulate-webhook.mjs --sessions 600
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SESSIONS = Number(arg('sessions', 2500)); // enough volume for stable rates

// Per-variant real-user behaviour profiles (probabilities + playtime seconds). Reproducible via a
// seeded RNG so the dashboard is stable between runs. Rush converts harder but plays shorter; zen
// plays longer but converts less - the kind of real trade-off the loop exists to surface.
const PROFILES = {
  rush: { ctr: 0.092, install: 0.031, playMean: 17, playSd: 6 },
  classic: { ctr: 0.061, install: 0.018, playMean: 22, playSd: 7 },
  zen: { ctr: 0.044, install: 0.01, playMean: 29, playSd: 8 },
};

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// box-muller for playtime spread
const gauss = (rng, mean, sd) => {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.max(1, mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
};

const lines = [];
let seed = 1337;
for (const [variant, p] of Object.entries(PROFILES)) {
  const rng = mulberry32((seed += 9973));
  for (let i = 0; i < SESSIONS; i++) {
    const playtimeS = Math.round(gauss(rng, p.playMean, p.playSd));
    const clicked = rng() < p.ctr;
    const installed = clicked && rng() < p.install / p.ctr; // installs are a subset of clicks
    lines.push(
      JSON.stringify({
        variant,
        clicked,
        installed,
        playtimeS,
        // these mirror window.__telemetry so the feed is shape-compatible with the local hook
        score: Math.round(gauss(rng, p.playMean * 6, p.playMean * 2)),
        pickups: Math.max(0, Math.round(gauss(rng, p.playMean / 6, 2))),
        source: 'simulated-ad-webhook',
        at: new Date().toISOString(),
      })
    );
  }
}
writeFileSync(join(OUT, 'perf-webhook.jsonl'), lines.join('\n') + '\n');
console.log(`Simulated ad-network feed: ${lines.length} sessions -> out/perf-webhook.jsonl`);
