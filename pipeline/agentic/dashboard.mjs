#!/usr/bin/env node
/**
 * Observability dashboard generator.
 *
 * Reads the pipeline's run logs and renders ONE self-contained dashboard.html (no server) written
 * for BOTH audiences: a plain-language top for non-technical stakeholders, and per-criterion
 * scores + every validation gate for engineers. It shows the whole pipeline and what we are still
 * blind to.
 *
 * Run: npm run pipeline:dashboard  ->  pipeline/agentic/dashboard.html
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITERIA, MAX_SCORE } from './rubric.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'runs');
const OUT = join(HERE, 'dashboard.html');

function loadRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((f) => f.endsWith('.summary.json'))
    .map((f) => JSON.parse(readFileSync(join(RUNS, f), 'utf8')))
    .sort((a, b) => (a.runId < b.runId ? 1 : -1));
}
function loadAttempts() {
  if (!existsSync(RUNS)) return [];
  const out = [];
  for (const f of readdirSync(RUNS).filter((f) => f.endsWith('.jsonl'))) {
    for (const l of readFileSync(join(RUNS, f), 'utf8').split('\n')) {
      if (l.trim()) out.push(JSON.parse(l));
    }
  }
  return out;
}

const runs = loadRuns();
const attempts = loadAttempts();
const latest = runs[0];
const latestId = latest?.runId;
const latestJudge = attempts.filter((a) => a.runId === latestId && a.stage === 'judge');

// Latest verdict per asset (with per-criterion scores when the judge succeeded).
const perAsset = {};
for (const a of latestJudge) perAsset[a.asset] = a;

const allAssets = runs.flatMap((r) => r.summary);
const approved = allAssets.filter((a) => a.accepted).length;
const approvalRate = allAssets.length ? Math.round((approved / allAssets.length) * 100) : 0;
const totalCost = allAssets.reduce((n, a) => n + (a.costUsd || 0), 0);
const hitl = attempts.filter((a) => a.humanReview).length;
const scored = allAssets.filter((a) => a.total != null);
const avgScore = scored.length ? (scored.reduce((n, a) => n + a.total, 0) / scored.length).toFixed(1) : '-';
const provider = latest?.config?.judgeProvider ?? 'mock';
const model = latest?.config?.judgeModel ?? '-';

const card = (label, value, hint = '') =>
  `<div class="card"><div class="v">${value}</div><div class="l">${label}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;

// ---- Pipeline stages (plain + technical) ----
const STAGES = [
  ['1. Generate', 'An AI draws the sprite from a saved prompt', 'image provider adapter (Pollinations / mock)'],
  ['2. Validate', 'Hard rules check it is a usable image', 'PNG · square · transparent · ≤150KB'],
  ['3. Judge', 'A second AI scores it on 5 quality points', 'LLM vision judge (Claude / Gemini / mock)'],
  ['4. Retry', 'Low scores get feedback and another try', 'feedback appended to the prompt'],
  ['5. Escalate', 'If still unsure, a human decides', 'human-in-the-loop, never a guess'],
];
const flow = STAGES.map(
  ([t, plain, tech], i) =>
    `<div class="stage"><div class="sn">${t}</div><div class="sp">${plain}</div><div class="st">${tech}</div></div>` +
    (i < STAGES.length - 1 ? '<div class="arrow">&rarr;</div>' : '')
).join('');

// ---- Per-asset results with per-criterion bars ----
const assetRows = (latest?.summary || [])
  .map((a) => {
    const j = perAsset[a.asset];
    const badge = a.accepted ? '<span class="ok">approved</span>' : '<span class="warn">needs human</span>';
    let bars = '<td colspan="' + CRITERIA.length + '" class="muted">escalated: ' + (j?.reason || 'n/a') + '</td>';
    if (j && j.scores) {
      bars = CRITERIA.map((c) => {
        const v = j.scores[c.key] ?? 0;
        return `<td title="${c.label}"><div class="bar"><div class="fill s${v}" style="width:${v * 20}%"></div></div><span class="bn">${v}</span></td>`;
      }).join('');
    }
    return `<tr><td><b>${a.asset}</b></td><td>${badge}</td><td>${a.total ?? '-'}/${MAX_SCORE}</td><td>${a.attempts}</td>${bars}</tr>`;
  })
  .join('');
const critHead = CRITERIA.map((c) => `<th title="${c.label}">${c.key.replace(/_/g, ' ')}</th>`).join('');

// ---- Every validation gate in the project (the full quality system) ----
const assetGatePass = latestJudge.length > 0 && latestJudge.every((a) => a.valid !== false);
const GATES = [
  ['Asset gate', 'Every sprite is a real, transparent, square image small enough to ship', 'png.mjs / validate.mjs — PNG signature, alpha channel, width=height, ≤150KB', assetGatePass ? 'live: pass' : 'wired'],
  ['Manifest schema', 'The asset list is well-formed before the game reads it', 'assets.schema.json + validateManifest() — required sprites, positive scale/aspect, numeric points', 'wired'],
  ['Build gate', 'The finished playable is one self-contained file under the ad size limit', 'validate-build.mjs — single HTML, ≤5MB, no external URLs, MRAID + CTA present', 'wired'],
  ['Unit tests', 'The scoring and collision rules are proven correct', 'node --test via tsx — pure collision + scoring functions', 'wired'],
  ['End-to-end test', 'The built game actually loads and runs in a real browser', 'Playwright headless — no errors, loop advances, WebGL healthy, CTA fires', 'wired'],
  ['Judge rubric', 'An AI scores each sprite on 5 quality criteria', 'LLM vision judge (Claude / Gemini) or mock — structured 1-5 per criterion', `live: ${provider}`],
  ['Human escalation', 'Anything the AI is unsure about goes to a person, never guessed', 'HITL — malformed / refused / rate-limited verdict sets a humanReview flag', hitl ? `live: ${hitl} flagged` : 'wired'],
  ['CI gate', 'All of the above run automatically on every code change', 'npm run ci on GitHub Actions — unit → asset → build → build-gate → e2e', 'wired'],
];
const gateRows = GATES.map(
  ([n, plain, tech, status]) =>
    `<tr><td><b>${n}</b></td><td>${plain}</td><td class="mono">${tech}</td><td><span class="${status.startsWith('live') ? 'ok' : 'tag'}">${status}</span></td></tr>`
).join('');

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Asset Pipeline Dashboard</title>
<style>
 body{margin:0;font-family:system-ui,sans-serif;background:#0f1419;color:#e6edf3;line-height:1.5}
 header{padding:22px 28px;background:#161b22;border-bottom:1px solid #30363d}
 h1{margin:0;font-size:21px} h2{font-size:15px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin:30px 0 12px}
 .sub{color:#8b949e;font-size:13px;margin-top:6px;max-width:760px}
 main{padding:20px 28px;max-width:1000px}
 .cards{display:flex;flex-wrap:wrap;gap:12px} .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px 16px;min-width:120px}
 .card .v{font-size:24px;font-weight:700} .card .l{color:#8b949e;font-size:12px;margin-top:2px} .card .h{color:#6e7681;font-size:11px;margin-top:3px}
 .flow{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap}
 .stage{flex:1;min-width:150px;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px 14px}
 .sn{font-weight:700;font-size:14px} .sp{font-size:13px;margin:4px 0} .st{font-size:11px;color:#6e7681;font-family:ui-monospace,monospace}
 .arrow{align-self:center;color:#3fb950;font-size:20px}
 table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
 th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #21262d;font-size:13px;vertical-align:middle} th{color:#8b949e;font-weight:600}
 tr:last-child td{border-bottom:none}
 .ok{color:#3fb950;font-weight:600} .warn{color:#d29922;font-weight:600} .muted{color:#6e7681} .tag{color:#8b949e}
 .mono{font-family:ui-monospace,monospace;font-size:12px;color:#adbac7}
 .bar{display:inline-block;width:46px;height:7px;background:#21262d;border-radius:4px;overflow:hidden;vertical-align:middle}
 .fill{height:100%} .s5,.s4{background:#3fb950}.s3{background:#d29922}.s2,.s1,.s0{background:#f85149}
 .bn{font-size:11px;color:#8b949e;margin-left:5px}
 .blind{margin-top:26px;background:#1c1209;border:1px solid #9e6a03;border-radius:10px;padding:16px 18px}
 .blind h3{margin:0 0 6px;color:#e3b341;font-size:15px} .blind p{margin:6px 0;color:#d8c08a;font-size:13px}
 code{background:#21262d;padding:1px 5px;border-radius:4px}
</style></head><body>
<header>
 <h1>AI Asset Pipeline &mdash; Observability</h1>
 <div class="sub">An AI generates each game sprite, automatic rules and a second AI check it, and anything
 uncertain goes to a human. This page shows the whole pipeline, every quality gate, and what it costs.
 ${runs.length} run(s) logged. Latest judge: <b>${provider}</b>${model !== '-' && model !== 'mock' ? ` (${model})` : ''}.</div>
</header>
<main>
 <h2>How it works</h2>
 <div class="flow">${flow}</div>

 <h2>Latest run</h2>
 <div class="cards">
  ${card('Auto-approval', approvalRate + '%', `${approved}/${allAssets.length} assets`)}
  ${card('Avg quality', avgScore + '/' + MAX_SCORE, '5-criterion rubric')}
  ${card('Needs human', hitl, 'never guessed')}
  ${card('Spend', '$' + totalCost.toFixed(4), provider + ' judge')}
 </div>

 <h2>Per-asset scores</h2>
 <table>
  <thead><tr><th>Asset</th><th>Status</th><th>Total</th><th>Tries</th>${critHead}</tr></thead>
  <tbody>${assetRows || `<tr><td colspan="${4 + CRITERIA.length}">No runs yet. Run <code>npm run pipeline</code>.</td></tr>`}</tbody>
 </table>

 <h2>All validation gates</h2>
 <div class="sub" style="margin-bottom:10px">Every automatic check in the project. "live" = result from this run; "wired" = runs in <code>npm run ci</code> / CI.</div>
 <table>
  <thead><tr><th>Gate</th><th>What it guarantees (plain)</th><th>How (technical)</th><th>Status</th></tr></thead>
  <tbody>${gateRows}</tbody>
 </table>

 <div class="blind">
  <h3>What this does NOT measure yet (the next data to wire in)</h3>
  <p>This tracks <b>internal quality</b> (the rubric) and <b>correctness</b> (the gates). It does <b>not</b>
  yet track <b>real-world ad performance</b> &mdash; click-through, install rate, playtime &mdash; which should
  ultimately pick the winning variant.</p>
  <p>Every asset is already a discrete, logged record, so feeding the ad network's performance webhook into
  <code>runs/</code> flips the north-star from "rubric score" to "variant win-rate," closing the loop from
  production back into generation. <b>That is the data flywheel; this dashboard is its first half.</b></p>
 </div>
</main></body></html>`;

writeFileSync(OUT, html);
console.log(`Dashboard written: ${OUT}\nOpen it in a browser (no server needed).`);
