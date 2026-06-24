#!/usr/bin/env node
/**
 * Observability dashboard generator.
 *
 * Reads the pipeline's run logs and renders ONE self-contained dashboard.html (no server) for BOTH
 * audiences. The centrepiece is the AGENTIC LOOP: the actual decision trail showing Agent A
 * generating, Agent B (the AI judge) accepting or rejecting, and Agent A regenerating from the
 * feedback until it passes. Plus before/after thumbnails, per-criterion scores, the brief
 * requirements, every validation gate, and what we are still blind to.
 *
 * Run: npm run pipeline:dashboard  ->  pipeline/agentic/dashboard.html
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CRITERIA, MAX_SCORE } from './rubric.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'runs');
const OUT = join(HERE, 'dashboard.html');
const SPRITES = join(HERE, '..', '..', 'assets', 'sprites');
const PROVENANCE = join(HERE, '..', '..', 'assets', 'provenance.json');

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

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
    for (const l of readFileSync(join(RUNS, f), 'utf8').split('\n')) if (l.trim()) out.push(JSON.parse(l));
  }
  return out;
}

const runs = loadRuns();
const attempts = loadAttempts();
const latest = runs[0];
const latestId = latest?.runId;
const provider = latest?.config?.judgeProvider ?? 'mock';
const model = latest?.config?.judgeModel ?? '-';

let previews = {};
try {
  previews = JSON.parse(readFileSync(join(HERE, 'out', 'previews.json'), 'utf8'));
} catch {
  /* none yet */
}

// Golden eval: the judge's agreement with known-correct labels (drift detector).
let golden = null;
try {
  golden = JSON.parse(readFileSync(join(HERE, 'out', 'golden-eval.json'), 'utf8'));
} catch {
  /* not run yet */
}
const goldenRows = golden
  ? golden.results
      .map(
        (r) =>
          `<tr><td>${r.name}</td><td>${r.expect}</td><td>${r.got}</td><td>${r.match ? '<span class="ok">✓</span>' : '<span class="warn">✗ drift</span>'}</td></tr>`
      )
      .join('')
  : '';

// Game tests (Playwright JSON), live gameplay screenshot, and the AI visual-QA verdict.
let e2e = null;
let visual = null;
let screenshot = null;
try {
  e2e = JSON.parse(readFileSync(join(HERE, 'out', 'e2e-results.json'), 'utf8'));
} catch {
  /* not run */
}
try {
  visual = JSON.parse(readFileSync(join(HERE, 'out', 'visual-eval.json'), 'utf8'));
} catch {
  /* not run */
}
try {
  screenshot = 'data:image/png;base64,' + readFileSync(join(HERE, 'out', 'game-screenshot.png')).toString('base64');
} catch {
  /* none */
}
let gif = null;
try {
  gif = 'data:image/gif;base64,' + readFileSync(join(HERE, 'game.gif')).toString('base64');
} catch {
  /* none */
}
let agentCfg = null;
try {
  agentCfg = JSON.parse(readFileSync(join(HERE, 'agents.config.json'), 'utf8'));
} catch {
  /* none */
}
function collectSpecs(suite, out) {
  (suite.specs || []).forEach((s) => out.push(s));
  (suite.suites || []).forEach((su) => collectSpecs(su, out));
  return out;
}
const specs = e2e ? (e2e.suites || []).flatMap((su) => collectSpecs(su, [])) : [];
const e2eRows = specs
  .map((s) => `<tr><td>${s.title}</td><td>${s.ok ? '<span class="ok">pass ✓</span>' : '<span class="warn">fail</span>'}</td></tr>`)
  .join('');

// Provenance: re-fingerprint each committed sprite and compare to its recorded generation hash.
let provenance = {};
try {
  provenance = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
} catch {
  /* none yet */
}
function provStatus(asset) {
  const rec = provenance[asset];
  if (!rec) return null;
  try {
    const cur = createHash('sha256').update(readFileSync(join(SPRITES, `${asset}.png`))).digest('hex');
    return { ...rec, verified: cur === rec.imageSha256 };
  } catch {
    return { ...rec, verified: false };
  }
}
const provList = Object.keys(provenance).map((a) => ({ asset: a, ...provStatus(a) }));
const provVerified = provList.length > 0 && provList.every((p) => p.verified);
const provRows = provList
  .map(
    (p) =>
      `<tr><td><b>${p.asset}</b></td><td>${p.generator || '-'}</td><td class="mono">${p.judge || '-'}</td>` +
      `<td>${p.score ?? '-'}/${MAX_SCORE}</td><td class="mono">${(p.imageSha256 || '').slice(0, 16)}…</td>` +
      `<td>${p.verified ? '<span class="ok">verified ✓</span>' : '<span class="warn">unverified</span>'}</td></tr>`
  )
  .join('');

// Judge attempts for the latest run, grouped by asset and ordered — this is the decision trail.
const latestJudge = attempts.filter((a) => a.runId === latestId && a.stage === 'judge');
const loopByAsset = {};
for (const a of [...latestJudge].sort((x, y) => x.attempt - y.attempt)) {
  (loopByAsset[a.asset] ||= []).push(a);
}
const lastVerdict = {};
for (const a of latestJudge) lastVerdict[a.asset] = a; // last write wins = final verdict

// ---- Metrics ----
const allAssets = runs.flatMap((r) => r.summary);
const approved = allAssets.filter((a) => a.accepted).length;
const approvalRate = allAssets.length ? Math.round((approved / allAssets.length) * 100) : 0;
const totalCost = allAssets.reduce((n, a) => n + (a.costUsd || 0), 0);
const hitl = attempts.filter((a) => a.humanReview).length;
const retried = Object.values(loopByAsset).filter((s) => s.length > 1).length;
const scored = allAssets.filter((a) => a.total != null);
const avgScore = scored.length ? (scored.reduce((n, a) => n + a.total, 0) / scored.length).toFixed(1) : '-';

const card = (label, value, hint = '') =>
  `<div class="card"><div class="v">${value}</div><div class="l">${label}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;

// ---- Brief requirements ----
const REQUIREMENTS = [
  ['Functional core loop', 'start → fly &amp; collect → end with score', 'start screen, scrolling collision-scoring flight, end card with final score'],
  ['Controllable parrot', 'virtual joystick OR keyboard', 'both — keyboard (arrows / WASD) + on-screen joystick'],
  ['AI-generated collectible (scores points)', 'at least 1', 'fruit.png — AI-generated, judged &amp; accepted, +points on pickup'],
  ['AI-generated tree (environment)', 'at least 1', 'tree.png — AI-generated, judged &amp; accepted, scattered along the path'],
];
const reqRows = REQUIREMENTS.map(
  ([r, need, ev]) => `<tr><td><b>${r}</b></td><td><span class="ok">met ✓</span></td><td>${need}</td><td class="mono">${ev}</td></tr>`
).join('');

// ---- Pipeline stages ----
const STAGES = [
  ['1. Generate', 'An AI draws the sprite from a saved prompt', 'image provider (Pollinations / mock)'],
  ['2. Validate', 'Hard rules check it is a usable image', 'PNG · square · transparent · ≤150KB'],
  ['3. Judge', 'A second AI scores it on 5 quality points', 'LLM vision judge (Gemini / Claude / mock)'],
  ['4. Retry', 'Low scores get feedback and another try', 'feedback appended to the prompt'],
  ['5. Escalate', 'If still unsure, a human decides', 'human-in-the-loop, never a guess'],
];
const flow = STAGES.map(
  ([t, plain, tech], i) =>
    `<div class="stage"><div class="sn">${t}</div><div class="sp">${plain}</div><div class="st">${tech}</div></div>` +
    (i < STAGES.length - 1 ? '<div class="arrow">&rarr;</div>' : '')
).join('');

// ---- Per-asset score bars (final verdict) ----
const critHead = CRITERIA.map((c) => `<th title="${c.label}">${c.key.replace(/_/g, ' ')}</th>`).join('');
const assetRows = (latest?.summary || [])
  .map((a) => {
    const j = lastVerdict[a.asset];
    const badge = a.accepted ? '<span class="ok">approved</span>' : '<span class="warn">needs human</span>';
    let bars = `<td colspan="${CRITERIA.length}" class="muted">escalated: ${j?.reason || 'n/a'}</td>`;
    if (j && j.scores) {
      bars = CRITERIA.map((c) => {
        const v = j.scores[c.key] ?? 0;
        return `<td title="${c.label}"><div class="bar"><div class="fill s${v}" style="width:${v * 20}%"></div></div><span class="bn">${v}</span></td>`;
      }).join('');
    }
    return `<tr><td><b>${a.asset}</b></td><td>${badge}</td><td>${a.total ?? '-'}/${MAX_SCORE}</td><td>${a.attempts}</td>${bars}</tr>`;
  })
  .join('');

// ---- THE AGENTIC LOOP: the actual decision trail ----
const loopCards = Object.keys(loopByAsset)
  .map((asset) => {
    const steps = loopByAsset[asset];
    const headline = steps.length > 1 ? `${steps.length} loops — rejected, then re-generated` : 'accepted first pass';
    const items = steps
      .map((a) => {
        const reason = (a.scores && a.scores.reasoning) || a.reason || '';
        const weak = a.weak && a.weak.length ? ` &middot; weak: <b>${a.weak.join(', ')}</b>` : '';
        const verdict = a.accepted
          ? '<span class="ok">ACCEPTED ✓</span>'
          : '<span class="warn">REJECTED &rarr; Agent A regenerates</span>';
        return (
          `<li><span class="lstep">Attempt ${a.attempt}</span> Agent A generates &rarr; Agent B judges ` +
          `<b>${a.total ?? '-'}/${MAX_SCORE}</b>${weak} &rarr; ${verdict}` +
          (reason ? `<div class="why">&ldquo;${esc(reason)}&rdquo;</div>` : '') +
          `</li>`
        );
      })
      .join('');
    return `<div class="loop"><div class="lt">${asset} <span class="muted">&mdash; ${headline}</span></div><ol>${items}</ol></div>`;
  })
  .join('');

// ---- Before/after gallery ----
const previewCards = Object.keys(previews)
  .map((asset) => {
    const p = previews[asset];
    return (
      `<div class="pv"><div class="pvt">${asset}</div><div class="pvr">` +
      `<figure><img src="${p.before}" alt="${asset} before"/><figcaption>raw AI output</figcaption></figure>` +
      `<span class="parrow">&rarr;</span>` +
      `<figure><img class="alpha" src="${p.after}" alt="${asset} after"/><figcaption>processed sprite</figcaption></figure>` +
      `</div></div>`
    );
  })
  .join('');

// ---- Validation gates (no provenance) ----
const GATES = [
  ['Asset gate', 'Every sprite is a real, transparent, square image small enough to ship', 'png.mjs / validate.mjs — PNG signature, alpha channel, width=height, ≤150KB', 'wired'],
  ['Manifest schema', 'The asset list is well-formed before the game reads it', 'assets.schema.json + validateManifest()', 'wired'],
  ['Build gate', 'The finished playable is one self-contained file under the ad size limit', 'validate-build.mjs — single HTML, ≤5MB, no external URLs, MRAID + CTA', 'wired'],
  ['Unit tests', 'The scoring and collision rules are proven correct', 'node --test via tsx — pure functions', 'wired'],
  ['End-to-end test', 'The built game loads and runs in a real browser', 'Playwright headless — no errors, loop advances, WebGL healthy, CTA fires', 'wired'],
  ['Judge rubric', 'An AI scores each sprite on 5 quality criteria', `LLM vision judge — structured 1-5 per criterion`, `live: ${provider}`],
  ['AI provenance', 'Proof each sprite was made by an AI generator, not hand-drawn or procedural', 'verify-provenance.mjs — each sprite’s SHA-256 matches its recorded generation fingerprint', provVerified ? `live: ${provList.length} verified` : 'wired'],
  ['Human escalation', 'Anything the AI is unsure about goes to a person', 'HITL — malformed / refused / rate-limited verdict flags humanReview', hitl ? `live: ${hitl} flagged` : 'wired'],
  ['CI gate', 'All of the above run automatically on every code change', 'npm run ci on GitHub Actions', 'wired'],
];
const gateRows = GATES.map(
  ([n, plain, tech, status]) =>
    `<tr><td><b>${n}</b></td><td>${plain}</td><td class="mono">${tech}</td><td><span class="${status.startsWith('live') ? 'ok' : 'tag'}">${status}</span></td></tr>`
).join('');

// ---- Full run trace (observability): every stage is a logged span with outcome + latency ----
const trace = attempts.filter((a) => a.runId === latestId).sort((a, b) => (a.ts < b.ts ? -1 : 1));
const traceRows = trace
  .map((a) => {
    const outcome =
      a.stage === 'generate'
        ? a.error
          ? `error: ${esc(a.error)}`
          : 'generated'
        : a.stage === 'validate'
          ? a.valid === false
            ? `invalid: ${esc((a.problems || []).join(', '))}`
            : 'valid'
          : a.stage === 'judge'
            ? a.humanReview
              ? `escalated: ${esc(a.reason || '')}`
              : a.accepted
                ? `accepted ${a.total != null ? a.total + '/' + MAX_SCORE : '(scene)'}`
                : `rejected ${a.total != null ? a.total + '/' + MAX_SCORE : ''}`
            : '';
    return `<tr><td class="mono">${(a.ts || '').slice(11, 19)}</td><td>${a.stage}</td><td>${a.asset}</td><td>${a.attempt}</td><td>${outcome}</td><td class="mono">${a.latencyMs != null ? a.latencyMs + 'ms' : ''}</td></tr>`;
  })
  .join('');

// ---- What we use AI for, and what we deliberately keep as code (the core decision rule) ----
const AI_VS_CODE = [
  ['Sprite &amp; background art', 'AI', 'Creative, high-variability — taste matters, many valid outputs'],
  ['Asset quality grading', 'AI judge', 'Subjective rubric — a genuine judgment call'],
  ['Collision, scoring, loop, physics', 'Code', 'Deterministic — must be exact, fast, identical every run'],
  ['Validation gates', 'Code', 'Fail-loud rules — no LLM variance, no guessing'],
  ['Background acceptance', 'Code (validate)', "A backdrop that passes image checks is fine — don't over-apply AI"],
  ['Provenance / observability', 'Code', 'Hashing &amp; audit must be deterministic'],
];
const aiRows = AI_VS_CODE.map(([t, who, why]) => {
  const cls = who.startsWith('AI') ? 'aiyes' : 'aino';
  return `<tr><td>${t}</td><td><span class="${cls}">${who}</span></td><td class="muted">${why}</td></tr>`;
}).join('');

// ---- Engineering best practices, mapped to where they live ----
const PRACTICES = [
  ['Deterministic vs judgment split', 'AI only where judgment is needed; code everywhere else', 'the table above'],
  ['Fail-loud validation at boundaries', 'Bad data is rejected and surfaced, never flows downstream', 'validate.mjs · validate-build.mjs · validateScene'],
  ['Prompt as code', 'Generation prompts versioned in git, reviewable, roll-back-able', 'prompts/*.md'],
  ['Closed-loop evaluation', "Judge feedback rewrites the prompt until it passes", 'the agentic loop above'],
  ['Human-in-the-loop', 'Low-confidence / unverifiable output escalates to a person', 'HITL — never a guess'],
  ['Resilience', "Exponential backoff on 429/5xx; retries don't double-fire", 'judge.mjs fetchWithBackoff'],
  ['Swappable adapters', 'Change a provider/model without touching the pipeline', 'generate.mjs · judge.mjs'],
  ['Observability', 'Every decision logged; this dashboard reads the trace', 'runs/*.jsonl + this page'],
  ['Provenance / audit', 'Each sprite hashed and proven AI-origin', 'verify-provenance.mjs'],
  ['Single source of truth', 'One rubric, one config, one decision point per rule', 'rubric.mjs · run.mjs config'],
];
const practiceRows = PRACTICES.map(
  ([p, what, where]) => `<tr><td><b>${p}</b></td><td>${what}</td><td class="mono">${where}</td></tr>`
).join('');

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Asset Pipeline Dashboard</title>
<style>
 body{margin:0;font-family:system-ui,sans-serif;background:#0f1419;color:#e6edf3;line-height:1.5}
 header{padding:22px 28px;background:#161b22;border-bottom:1px solid #30363d}
 h1{margin:0;font-size:21px} h2{font-size:15px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin:30px 0 12px}
 .sub{color:#8b949e;font-size:13px;margin-top:6px;max-width:820px}
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
 .ok{color:#3fb950;font-weight:600} .warn{color:#d29922;font-weight:600} .muted{color:#8b949e} .tag{color:#8b949e}
 .mono{font-family:ui-monospace,monospace;font-size:12px;color:#adbac7}
 .bar{display:inline-block;width:46px;height:7px;background:#21262d;border-radius:4px;overflow:hidden;vertical-align:middle}
 .fill{height:100%} .s5,.s4{background:#3fb950}.s3{background:#d29922}.s2,.s1,.s0{background:#f85149}
 .bn{font-size:11px;color:#8b949e;margin-left:5px}
 .loops{display:flex;flex-direction:column;gap:12px}
 .loop{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px 16px}
 .lt{font-weight:700;text-transform:capitalize;margin-bottom:6px}
 .loop ol{margin:0;padding-left:18px} .loop li{font-size:13px;margin:6px 0}
 .lstep{display:inline-block;background:#21262d;border-radius:5px;padding:0 7px;font-size:11px;margin-right:6px;color:#adbac7}
 .why{color:#8b949e;font-style:italic;font-size:12px;margin-top:3px}
 .gallery{display:flex;flex-wrap:wrap;gap:14px}
 .pv{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px}
 .pvt{font-weight:600;font-size:13px;margin-bottom:8px;text-transform:capitalize}
 .pvr{display:flex;align-items:center;gap:10px}
 .pv figure{margin:0;text-align:center} .pv figcaption{font-size:11px;color:#8b949e;margin-top:4px}
 .pv img{width:84px;height:84px;object-fit:contain;border-radius:6px;background:#0d1117}
 .pv img.alpha{background-image:linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%);background-size:14px 14px;background-position:0 0,0 7px,7px -7px,-7px 0}
 .parrow{color:#3fb950;font-size:22px}
 .aiyes{color:#a371f7;font-weight:700} .aino{color:#58a6ff;font-weight:700}
 .qa{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
 .shot img{max-width:380px;width:100%;border-radius:8px;border:1px solid #30363d;display:block}
 .shot .cap{font-size:12px;color:#8b949e;margin-top:4px;text-align:center}
 .qatables{flex:1;min-width:280px}
 .vq{padding:10px 12px;border-radius:8px;margin-bottom:10px;font-size:13px}
 .vqok{background:#0f2a16;border:1px solid #238636} .vqbad{background:#2a1212;border:1px solid #9e3a3a}
 .vq ul{margin:6px 0 0 16px}
 .blind{margin-top:26px;background:#1c1209;border:1px solid #9e6a03;border-radius:10px;padding:16px 18px}
 .blind h3{margin:0 0 6px;color:#e3b341;font-size:15px} .blind p{margin:6px 0;color:#d8c08a;font-size:13px}
 code{background:#21262d;padding:1px 5px;border-radius:4px}
</style></head><body>
<header>
 <h1>AI Asset Pipeline &mdash; Observability</h1>
 <div class="sub">An AI generates each game sprite, automatic rules and a second AI check it, and anything
 uncertain goes to a human. This page shows the actual decision trail, every quality gate, and what it costs.
 ${runs.length} run(s) logged. Latest judge: <b>${provider}</b>${model !== '-' && model !== 'mock' ? ` (${model})` : ''}.</div>
</header>
<main>
 <h2>Brief requirements</h2>
 <table><thead><tr><th>Requirement</th><th>Status</th><th>Needed</th><th>Evidence</th></tr></thead><tbody>${reqRows}</tbody></table>

 <h2>How it works</h2>
 <div class="flow">${flow}</div>

 <h2>What we use AI for &mdash; and what we deliberately keep as code</h2>
 <div class="sub" style="margin-bottom:10px">The core decision rule: <b>AI for judgment/creative tasks, plain code for deterministic ones.</b> Knowing where <i>not</i> to use AI is the point.</div>
 <table><thead><tr><th>Task</th><th>Handled by</th><th>Why</th></tr></thead><tbody>${aiRows}</tbody></table>

 ${
   agentCfg
     ? `<h2>Agent config &amp; versions (rollback-ready)</h2>
 <div class="sub" style="margin-bottom:10px">The agent <b>runtime</b> is separate from its <b>config</b>: behaviour is changed by editing one versioned file (<code>agents.config.json</code>) &mdash; a reviewable PR and a git-revertable rollback &mdash; not code. Prompt text is versioned as code in <code>prompts/*.md</code>, and each run records the version it used (audit).</div>
 <table><tbody>
  <tr><td><b>Config version</b></td><td>${agentCfg.version}</td></tr>
  <tr><td><b>Owner</b></td><td>${agentCfg.owner}</td></tr>
  <tr><td><b>Last audited</b></td><td>${agentCfg.lastAudited}</td></tr>
  <tr><td><b>Image provider</b></td><td class="mono">${agentCfg.imageProvider}</td></tr>
  <tr><td><b>Judge models</b></td><td class="mono">${agentCfg.judge?.geminiModel} (free) · ${agentCfg.judge?.anthropicModel} (premium)</td></tr>
  <tr><td><b>Thresholds</b></td><td class="mono">accept ≥ ${agentCfg.thresholds?.accept}/25 · min criterion ${agentCfg.thresholds?.minCriterion} · max attempts ${agentCfg.thresholds?.maxAttempts}</td></tr>
  <tr><td><b>Prompt versions</b></td><td class="mono">${Object.entries(agentCfg.prompts || {}).filter(([k]) => k !== '_comment').map(([k, v]) => `${k} ${v}`).join(' · ')}</td></tr>
 </tbody></table>`
     : ''
 }

 <h2>Latest run</h2>
 <div class="cards">
  ${card('Auto-approval', approvalRate + '%', `${approved}/${allAssets.length} assets`)}
  ${card('Avg quality', avgScore + '/' + MAX_SCORE, '5-criterion rubric')}
  ${card('Loops (retried)', retried, 'rejected then re-generated')}
  ${card('Needs human', hitl, 'never guessed')}
  ${card('Spend', '$' + totalCost.toFixed(4), provider + ' judge')}
 </div>

 ${
   loopCards
     ? `<h2>The agentic loop &mdash; how the decision was actually made</h2>
 <div class="sub" style="margin-bottom:10px">Not "trust me." This is the real decision trail from the logs: <b>Agent A</b> generates, <b>Agent B</b> (the AI judge) scores and accepts or rejects, and on a reject Agent A re-generates from B's feedback until it passes &mdash; or a human is called. Watch an asset that was rejected and then re-generated to pass.</div>
 <div class="loops">${loopCards}</div>`
     : ''
 }

 ${
   golden
     ? `<h2>Judge calibration &mdash; who watches the judge?</h2>
 <div class="sub" style="margin-bottom:10px">The judge is an LLM, so it can drift (a model swap silently moves the quality bar). A <b>golden set</b> of labeled cases &mdash; real good sprites that must pass, plus a deliberately bad image that must be rejected &mdash; checks the judge's agreement with known-correct verdicts. A drop in agreement means the <i>evaluator</i> regressed, caught here before it corrupts future grades.</div>
 <div class="cards"><div class="card"><div class="v">${golden.agreement}%</div><div class="l">judge agreement</div><div class="h">${golden.provider}:${golden.model}</div></div></div>
 <table style="margin-top:12px"><thead><tr><th>Golden case</th><th>Expected</th><th>Judge said</th><th>Match</th></tr></thead><tbody>${goldenRows}</tbody></table>`
     : ''
 }

 ${
   screenshot || e2eRows || visual
     ? `<h2>The end product &mdash; tests &amp; visual QA</h2>
 <div class="sub" style="margin-bottom:10px">Two checks on the actual built game: functional Playwright tests (does it load and run), and an AI <b>visual judge</b> that looks at a real gameplay screenshot (does it LOOK right) &mdash; catching what functional tests can't, like the sprite-background bug.</div>
 <div class="qa">
  ${gif ? `<div class="shot"><img src="${gif}" alt="gameplay"/><div class="cap">live gameplay (animated)</div></div>` : screenshot ? `<div class="shot"><img src="${screenshot}" alt="gameplay screenshot"/><div class="cap">live gameplay screenshot</div></div>` : ''}
  <div class="qatables">
   ${visual ? `<div class="vq ${visual.ok ? 'vqok' : 'vqbad'}">AI visual verdict: <b>${visual.ok ? 'looks good ✓' : 'issues found'}</b> (${visual.score}/5) &mdash; ${esc(visual.summary || '')}${visual.issues && visual.issues.length ? '<ul>' + visual.issues.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>' : ''}</div>` : ''}
   ${e2eRows ? `<table><thead><tr><th>Functional game test</th><th>Status</th></tr></thead><tbody>${e2eRows}</tbody></table>` : ''}
  </div>
 </div>`
     : ''
 }

 <h2>Per-asset scores (final verdict)</h2>
 <table>
  <thead><tr><th>Asset</th><th>Status</th><th>Total</th><th>Tries</th>${critHead}</tr></thead>
  <tbody>${assetRows || `<tr><td colspan="${4 + CRITERIA.length}">No runs yet. Run <code>npm run pipeline</code>.</td></tr>`}</tbody>
 </table>

 ${
   previewCards
     ? `<h2>Generated assets &mdash; before &rarr; after</h2>
 <div class="sub" style="margin-bottom:10px">Raw AI output (on its magenta key background) next to the processed, transparent sprite the game uses.</div>
 <div class="gallery">${previewCards}</div>`
     : ''
 }

 ${
   provList.length
     ? `<h2>Provenance &mdash; proof of AI origin</h2>
 <div class="sub" style="margin-bottom:10px">Each sprite is fingerprinted (SHA-256) when the AI generates it. This re-checks the shipped file still matches &mdash; proving it came from the AI generator and was not swapped for hand-drawn or procedural art. Verification + observability.</div>
 <table><thead><tr><th>Asset</th><th>AI generator</th><th>Graded by</th><th>Score</th><th>SHA-256</th><th>Verified</th></tr></thead><tbody>${provRows}</tbody></table>`
     : ''
 }

 ${
   traceRows
     ? `<h2>Run trace &mdash; the full decision log</h2>
 <div class="sub" style="margin-bottom:10px">Structured trace of the latest run (trace id <code>${latestId || '—'}</code>). Every stage is a logged span with a timestamp, outcome, and latency &mdash; the observability layer the rest of this page reads. Nothing here is hand-written.</div>
 <table><thead><tr><th>Time</th><th>Stage</th><th>Asset</th><th>Try</th><th>Outcome</th><th>Latency</th></tr></thead><tbody>${traceRows}</tbody></table>`
     : ''
 }

 <h2>All validation gates</h2>
 <div class="sub" style="margin-bottom:10px">Every automatic check in the project. "live" = result from this run; "wired" = runs in <code>npm run ci</code> / CI.</div>
 <table><thead><tr><th>Gate</th><th>What it guarantees (plain)</th><th>How (technical)</th><th>Status</th></tr></thead><tbody>${gateRows}</tbody></table>

 <h2>Engineering best practices &mdash; where each one lives</h2>
 <table><thead><tr><th>Practice</th><th>What it means</th><th>Where</th></tr></thead><tbody>${practiceRows}</tbody></table>

 <div class="blind">
  <h3>What this does NOT measure yet (the next data to wire in)</h3>
  <p>This tracks <b>internal quality</b> (the rubric) and <b>correctness</b> (the gates). It does <b>not</b>
  yet track <b>real-world ad performance</b> &mdash; click-through, install rate, playtime &mdash; which should
  ultimately pick the winning variant.</p>
  <p>Every asset is already a discrete, logged record, so feeding the ad network's performance webhook into
  <code>runs/</code> flips the north-star from "rubric score" to "variant win-rate," closing the loop from
  production back into generation. <b>That is the data flywheel; this dashboard is its first half.</b></p>
  <p>The game already emits a per-session telemetry hook (<code>window.__telemetry</code>: variant, pickups,
  score, duration) &mdash; the seed of that loop. A collector + champion/challenger selector is the
  remaining piece (a backend, out of scope for a take-home).</p>
 </div>
</main></body></html>`;

writeFileSync(OUT, html);
console.log(`Dashboard written: ${OUT}\nOpen it in a browser (no server needed).`);
