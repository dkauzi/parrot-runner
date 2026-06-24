#!/usr/bin/env node
/**
 * Close the loop - turn play into the north-star.
 *
 * Two sources, ONE aggregation - that is the whole point: going from synthetic to real users is a
 * source swap, not a rewrite.
 *   --source playwright  (default): play each variant headless, read window.__telemetry.
 *   --source webhook              : read out/perf-webhook.jsonl, the SAME shape the ad network posts
 *                                   per real session (variant, clicked, installed, playtime, ...).
 * With webhook data we get true ad KPIs (CTR, install rate, playtime) and rank variants by install
 * rate; with Playwright we rank by an engagement proxy. Same code, same panels, same performance.json.
 *
 * Run:  node pipeline/agentic/collect-telemetry.mjs --source webhook
 */
import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
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
const SOURCE = arg('source', 'playwright');
const RUNS = Number(arg('n', 4));

// ---- gather sessions (the only part that differs by source) ----
let sessions = [];
if (SOURCE === 'webhook') {
  // The one-line swap: read the ad-network feed instead of running the game. The SAME endpoint
  // accepts a session from ANYONE who plays - a real user via the ad network, or a Playwright run -
  // so we also fold in any local telemetry. One pipe, many sources.
  const feed = readFileSync(join(OUT, 'perf-webhook.jsonl'), 'utf8').trim().split('\n');
  sessions = feed.filter(Boolean).map((l) => JSON.parse(l));
  try {
    const local = readFileSync(join(OUT, 'telemetry-log.jsonl'), 'utf8').trim().split('\n');
    for (const l of local.filter(Boolean)) sessions.push({ ...JSON.parse(l), source: 'playwright' });
  } catch {
    /* no local telemetry yet */
  }
} else {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  for (const variant of VARIANTS) {
    for (let i = 0; i < RUNS; i++) {
      await page.goto(`file://${join(ROOT, 'dist', 'index.html')}?variant=${variant}&test=fastend`, {
        waitUntil: 'load',
      });
      const t = await page
        .waitForFunction(() => window.__telemetry, null, { timeout: 8000 })
        .then((h) => h.jsonValue())
        .catch(() => null);
      if (t) {
        sessions.push(t);
        appendFileSync(join(OUT, 'telemetry-log.jsonl'), JSON.stringify(t) + '\n');
      }
    }
  }
  await browser.close();
}

// ---- aggregate per variant (identical for both sources) ----
const hasAds = sessions.some((s) => 'clicked' in s);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (n, d) => (d ? +((n / d) * 100).toFixed(2) : 0);
// Wilson 95% confidence interval for a proportion - honest about noise at low rates / small n.
const wilson = (k, n) => {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [+(Math.max(0, (centre - half) / den) * 100).toFixed(2), +(Math.min(1, (centre + half) / den) * 100).toFixed(2)];
};
const MIN_SAMPLE = 1000; // do not call a winner on thin data
const perVariant = VARIANTS.map((v) => {
  const r = sessions.filter((x) => x.variant === v);
  const avgScore = Math.round(mean(r.map((x) => x.score || 0)));
  const avgPickups = +mean(r.map((x) => x.pickups || 0)).toFixed(1);
  const row = { variant: v, sessions: r.length, avgScore, avgPickups };
  if (hasAds) {
    const ad = r.filter((x) => 'clicked' in x); // CTR/install measured over ad-tracked sessions
    const installs = ad.filter((x) => x.installed).length;
    row.adSessions = ad.length;
    row.ctrPct = pct(ad.filter((x) => x.clicked).length, ad.length);
    row.installRatePct = pct(installs, ad.length);
    [row.installLoPct, row.installHiPct] = wilson(installs, ad.length); // 95% CI on install rate
    row.avgPlaytimeS = +mean(r.map((x) => x.playtimeS || x.durationS || 0)).toFixed(1);
    row.engagement = row.installRatePct; // real money KPI is the north-star when we have it
  } else {
    row.avgPlaytimeS = +mean(r.map((x) => x.durationS || 0)).toFixed(1);
    row.engagement = avgScore + avgPickups * 5; // proxy when only local play is available
  }
  return row;
});
const total = perVariant.reduce((s, v) => s + v.engagement, 0) || 1;
perVariant.forEach((v) => (v.winSharePct = Math.round((v.engagement / total) * 100)));
perVariant.sort((a, b) => b.engagement - a.engagement);
const winner = perVariant[0];
const runnerUp = perVariant[1];

// Only call a winner when it is STATISTICALLY real: enough sample, and its install-rate CI lower
// bound clears the runner-up's CI upper bound (non-overlapping). Otherwise it is noise - HOLD.
let significant = false;
if (hasAds && winner && runnerUp) {
  significant = winner.adSessions >= MIN_SAMPLE && winner.installLoPct > runnerUp.installHiPct;
}
const recommendation = !winner
  ? 'No sessions collected.'
  : !hasAds
    ? `Generate more in the "${winner.variant}" direction; it leads on engagement (${winner.winSharePct}% share). [engagement proxy, not significance-tested]`
    : significant
      ? `PROMOTE "${winner.variant}": install rate ${winner.installRatePct}% [${winner.installLoPct}-${winner.installHiPct}%] clears ${runnerUp.variant} [${runnerUp.installLoPct}-${runnerUp.installHiPct}%]. Statistically significant (95% CI, n=${winner.adSessions}).`
      : `HOLD: "${winner.variant}" leads (${winner.installRatePct}%) but the 95% CIs overlap or n<${MIN_SAMPLE} - not yet significant. Keep collecting before promoting.`;

const performance = {
  source: hasAds
    ? 'simulated ad-network performance webhook (real-user shape: CTR, install rate, playtime)'
    : 'local playwright runs (engagement proxy)',
  realUsers: hasAds,
  metric: hasAds ? 'install rate % with 95% Wilson CI (real-money north-star)' : 'engagement = avgScore + avgPickups×5',
  totalSessions: sessions.length,
  perVariant,
  winner: winner ? winner.variant : null,
  significant,
  recommendation,
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, 'performance.json'), JSON.stringify(performance, null, 2));
console.log(
  `[${SOURCE}] ${sessions.length} sessions. Winner: ${performance.winner} ` +
    `(${perVariant.map((v) => `${v.variant}:${v.engagement}`).join(', ')})`
);
