#!/usr/bin/env node
/**
 * Observability dashboard generator.
 *
 * Plain-language for stakeholders: this reads the logs the pipeline produces and builds ONE
 * self-contained web page you can open in a browser (no server, no install). It answers, at a
 * glance: how many sprites were approved automatically, what they scored, how many tries each
 * took, what it cost, and which ones a human still needs to look at.
 *
 * It deliberately also shows what we are BLIND to: this measures internal QUALITY (the rubric),
 * not real-world ad PERFORMANCE (click-through, install rate, playtime). That column is the next
 * data source to wire in — and the architecture is already shaped to ingest it (see the panel).
 *
 * Run: npm run pipeline:dashboard   ->   pipeline/agentic/dashboard.html
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'runs');
const OUT = join(HERE, 'dashboard.html');

function loadRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((f) => f.endsWith('.summary.json'))
    .map((f) => JSON.parse(readFileSync(join(RUNS, f), 'utf8')))
    .sort((a, b) => (a.runId < b.runId ? 1 : -1)); // newest first
}

function loadAttempts() {
  if (!existsSync(RUNS)) return [];
  const lines = [];
  for (const f of readdirSync(RUNS).filter((f) => f.endsWith('.jsonl'))) {
    for (const l of readFileSync(join(RUNS, f), 'utf8').split('\n')) {
      if (l.trim()) lines.push(JSON.parse(l));
    }
  }
  return lines;
}

const runs = loadRuns();
const attempts = loadAttempts();

// ---- Aggregate metrics ----
const allAssets = runs.flatMap((r) => r.summary);
const approved = allAssets.filter((a) => a.accepted).length;
const approvalRate = allAssets.length ? Math.round((approved / allAssets.length) * 100) : 0;
const totalCost = allAssets.reduce((n, a) => n + (a.costUsd || 0), 0);
const hitl = attempts.filter((a) => a.humanReview).length;
const avgScore = (() => {
  const s = allAssets.filter((a) => a.total != null);
  return s.length ? (s.reduce((n, a) => n + a.total, 0) / s.length).toFixed(1) : '-';
})();
const latest = runs[0];

const card = (label, value, hint = '') =>
  `<div class="card"><div class="v">${value}</div><div class="l">${label}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;

const rows = allAssets
  .map((a) => {
    const badge = a.accepted ? '<span class="ok">approved</span>' : '<span class="warn">human review</span>';
    return `<tr><td>${a.asset}</td><td>${badge}</td><td>${a.total ?? '-'}/25</td><td>${a.attempts}</td><td>$${(a.costUsd || 0).toFixed(4)}</td></tr>`;
  })
  .join('');

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Asset Pipeline Dashboard</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0f1419;color:#e6edf3}
  header{padding:20px 28px;background:#161b22;border-bottom:1px solid #30363d}
  h1{margin:0;font-size:20px} .sub{color:#8b949e;font-size:13px;margin-top:4px}
  main{padding:24px 28px;max-width:920px}
  .cards{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:24px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 18px;min-width:130px}
  .card .v{font-size:26px;font-weight:700} .card .l{color:#8b949e;font-size:13px;margin-top:2px}
  .card .h{color:#6e7681;font-size:11px;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #21262d;font-size:14px}
  th{color:#8b949e;font-weight:600} tr:last-child td{border-bottom:none}
  .ok{color:#3fb950;font-weight:600} .warn{color:#d29922;font-weight:600}
  .blind{margin-top:24px;background:#1c1209;border:1px solid #9e6a03;border-radius:10px;padding:16px 18px}
  .blind h3{margin:0 0 6px;color:#e3b341;font-size:15px} .blind p{margin:6px 0;color:#d8c08a;font-size:13px;line-height:1.5}
  code{background:#21262d;padding:1px 5px;border-radius:4px}
</style></head><body>
<header>
  <h1>AI Asset Pipeline &mdash; Observability</h1>
  <div class="sub">Generate &rarr; validate &rarr; judge &rarr; retry &rarr; escalate. ${runs.length} run(s) logged.${latest ? ` Latest: ${latest.judgeProvider ? latest.config.judgeProvider : ''} judge (${latest.config?.judgeModel || ''}).` : ''}</div>
</header>
<main>
  <div class="cards">
    ${card('Auto-approval rate', approvalRate + '%', `${approved}/${allAssets.length} assets`)}
    ${card('Avg quality score', avgScore + '/25', 'rubric, 5 criteria')}
    ${card('Needs human', hitl, 'low-confidence / refused')}
    ${card('Total spend', '$' + totalCost.toFixed(4), 'judge tokens')}
  </div>

  <table>
    <thead><tr><th>Asset</th><th>Status</th><th>Score</th><th>Attempts</th><th>Cost</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No runs yet. Run <code>npm run pipeline</code>.</td></tr>'}</tbody>
  </table>

  <div class="blind">
    <h3>What this does NOT measure yet (the next data to wire in)</h3>
    <p>This dashboard tracks <b>internal quality</b> (the rubric score). It does <b>not</b> yet track
    <b>real-world ad performance</b> &mdash; click-through rate, install rate, or playtime. That is the
    metric that should ultimately decide which variant wins.</p>
    <p>The architecture is already shaped to ingest it: every asset and variant is a discrete, logged
    record. Feed the ad network's performance webhook into <code>runs/</code> and the north-star metric
    flips from "rubric score" to "variant win-rate" &mdash; closing the loop from production back into
    generation. <b>That is the data flywheel; this dashboard is its first half.</b></p>
  </div>
</main></body></html>`;

writeFileSync(OUT, html);
console.log(`Dashboard written: ${OUT}\nOpen it in a browser (no server needed).`);
