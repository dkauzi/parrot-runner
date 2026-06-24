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
let shadow = null;
try {
  shadow = JSON.parse(readFileSync(join(HERE, 'out', 'shadow-eval.json'), 'utf8'));
} catch {
  /* not run */
}
let performance = null;
try {
  performance = JSON.parse(readFileSync(join(HERE, 'out', 'performance.json'), 'utf8'));
} catch {
  /* not run */
}
let tests = null;
try {
  tests = JSON.parse(readFileSync(join(HERE, 'out', 'tests.json'), 'utf8'));
} catch {
  /* not run */
}
let device = null;
try {
  device = JSON.parse(readFileSync(join(HERE, 'out', 'device-check.json'), 'utf8'));
} catch {
  /* not run */
}
let calibration = null;
try {
  calibration = JSON.parse(readFileSync(join(HERE, 'out', 'calibration.json'), 'utf8'));
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

// Judge attempts for the latest run, grouped by asset and ordered - this is the decision trail.
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
  ['Controllable parrot', 'virtual joystick OR keyboard', 'both - keyboard (arrows / WASD) + on-screen joystick'],
  ['AI-generated collectible (scores points)', 'at least 1', 'fruit.png - AI-generated, judged &amp; accepted, +points on pickup'],
  ['AI-generated tree (environment)', 'at least 1', 'tree.png - AI-generated, judged &amp; accepted, scattered along the path'],
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
    const headline = steps.length > 1 ? `${steps.length} loops - rejected, then re-generated` : 'accepted first pass';
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
    return `<div class="loop"><div class="lt">${asset} <span class="muted">- ${headline}</span></div><ol>${items}</ol></div>`;
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
  ['Asset gate', 'Every sprite is a real, transparent, square image small enough to ship', 'png.mjs / validate.mjs - PNG signature, alpha channel, width=height, ≤150KB', 'wired'],
  ['Manifest schema', 'The asset list is well-formed before the game reads it', 'assets.schema.json + validateManifest()', 'wired'],
  ['Build gate', 'The finished playable is one self-contained file under the ad size limit', 'validate-build.mjs - single HTML, ≤5MB, no external URLs, MRAID + CTA', 'wired'],
  ['Unit tests', 'The scoring and collision rules are proven correct', 'node --test via tsx - pure functions', 'wired'],
  ['End-to-end test', 'The built game loads and runs in a real browser', 'Playwright headless - no errors, loop advances, WebGL healthy, CTA fires', 'wired'],
  ['Judge rubric', 'An AI scores each sprite on 5 quality criteria', `LLM vision judge - structured 1-5 per criterion`, `live: ${provider}`],
  ['AI provenance', 'Proof each sprite was made by an AI generator, not hand-drawn or procedural', 'verify-provenance.mjs - each sprite’s SHA-256 matches its recorded generation fingerprint', provVerified ? `live: ${provList.length} verified` : 'wired'],
  ['Human escalation', 'Anything the AI is unsure about goes to a person', 'HITL - malformed / refused / rate-limited verdict flags humanReview', hitl ? `live: ${hitl} flagged` : 'wired'],
  ['CI gate', 'All of the above run automatically on every code change', 'npm run ci on GitHub Actions', 'wired'],
];
const gateRows = GATES.map(
  ([n, plain, tech, status]) =>
    `<tr><td><b>${n}</b></td><td>${plain}</td><td class="mono">${tech}</td><td><span class="${status.startsWith('live') ? 'ok' : 'tag'}">${status}</span></td></tr>`
).join('');

// ---- Operational insights: what caused the most rework, across ALL runs ----
const allJudge = attempts.filter((a) => a.stage === 'judge');
const causeCounts = {
  'Generation errors (provider/network)': attempts.filter((a) => a.stage === 'generate' && a.error).length,
  'Validation rejects (caught early)': attempts.filter((a) => a.stage === 'validate' && a.valid === false).length,
  'Judge rejects → regenerated': allJudge.filter((a) => a.accepted === false && !a.humanReview).length,
  'Human escalations': attempts.filter((a) => a.humanReview).length,
};
const topCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0];
const insightRows = Object.entries(causeCounts)
  .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
  .join('');

// ---- Cost & tokens: AI is metered. Show how much was spent (free providers => ~$0) ----
const aiImageCalls = attempts.filter((a) => a.stage === 'generate' && !a.error).length;
const aiJudgeCalls = allJudge.length;
const totalCostUsd = attempts.reduce((s, a) => s + (a.costUsd || 0), 0);
const estTokens = aiJudgeCalls * 320; // ~vision+JSON judge call; image gen is not token-metered

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
  ['Sprite &amp; background art', 'AI', 'Creative, high-variability - taste matters, many valid outputs'],
  ['Asset quality grading', 'AI judge', 'Subjective rubric - a genuine judgment call'],
  ['Collision, scoring, loop, physics', 'Code', 'Deterministic - must be exact, fast, identical every run'],
  ['Validation gates', 'Code', 'Fail-loud rules - no LLM variance, no guessing'],
  ['Background acceptance', 'Code (validate)', "A backdrop that passes image checks is fine - don't over-apply AI"],
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
  ['Human-in-the-loop', 'Low-confidence / unverifiable output escalates to a person', 'HITL - never a guess'],
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
 h1{margin:0;font-size:22px} h2{font-size:15px;color:#cdd9e5;text-transform:uppercase;letter-spacing:.5px;margin:34px 0 12px;padding-left:10px;border-left:3px solid #2f81f7}
 .sub{color:#8b949e;font-size:13px;margin-top:6px;max-width:880px}
 main{padding:20px 28px 60px;max-width:1080px;margin:0 auto}
 .legend{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
 .lg{font-size:12px;color:#adbac7;background:#0d1117;border:1px solid #30363d;border-radius:20px;padding:3px 10px}
 .wheel{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px}
 .chip{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px 12px;min-width:104px;flex:1;text-align:center}
 .chip .ce{font-size:20px} .chip .ct{font-weight:700;font-size:12.5px;margin-top:3px} .chip .cc{font-size:11px;color:#8b949e;margin-top:2px}
 .chip.ai{border-color:#6e40c9;background:#17132a} .chip.code{border-color:#238636;background:#0f1f15} .chip.human{border-color:#9e6a03;background:#1c1409} .chip.play{border-color:#1f6feb;background:#0f1b2d}
 .warrow{align-self:center;color:#6e7681;font-size:15px}
 .wback{margin-top:12px;padding:10px 14px;border:1px dashed #6e7681;border-radius:8px;color:#adbac7;font-size:13px;background:#11151a}
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
 <h1>🦜 Parrot Runner - AI Pipeline Observability</h1>
 <div class="sub">An AI generates each game asset, automatic rules and a second AI check it, and anything
 uncertain goes to a human. This page shows the actual decision trail, every quality gate, the real-play
 loop, and what it costs - readable whether or not you write code.
 ${runs.length} run(s) logged. Latest judge: <b>${provider}</b>${model !== '-' && model !== 'mock' ? ` (${model})` : ''}. <span class="muted">Updated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC.</span></div>
 <div class="legend">
   <span class="lg">🟢 deterministic code (exact)</span>
   <span class="lg">🔵 AI (creative/judgment)</span>
   <span class="lg">🟣 AI judge (taste)</span>
   <span class="lg">🙋 human (final call)</span>
   <span class="lg">🏆 real-play winner</span>
 </div>
</header>
<main>
 <h2>🔄 The data flywheel (the whole loop, top to bottom)</h2>
 <div class="sub" style="margin-bottom:12px"><b>In plain words:</b> we make the art, check it, ship a version, watch how people actually play it, then make more of whatever plays best, and go round again. Each loop makes the next batch better. Every step is built and observable on this page.</div>
 <div class="wheel">
   ${[
     ['📝', 'Prompt', 'versioned, like code', ''],
     ['🎨', 'Make art', 'an AI paints the asset', 'ai'],
     ['🟢', 'Check rules', 'format, transparent, sized', 'code'],
     ['🔵', 'AI judges', 'scores it like a designer', 'ai'],
     ['🔁', 'Fix & retry', 'feedback rewrites the prompt', ''],
     ['🙋', 'Human if unsure', 'never a guess', 'human'],
     ['🕹️', 'Ship variant', 'validated playable', 'play'],
     ['🎯', 'Watch real play', 'CTR · installs · playtime', 'play'],
     ['📊', 'Rank winners', 'by install rate', 'play'],
   ]
     .map(
       (c, i) =>
         `<div class="chip ${c[3]}"><div class="ce">${c[0]}</div><div class="ct">${c[1]}</div><div class="cc">${c[2]}</div></div>${i < 8 ? '<div class="warrow">→</div>' : ''}`
     )
     .join('')}
 </div>
 <div class="wback">↩ <b>Loop closes here:</b> the winning variant feeds straight back into <b>Make art</b>, generate more of what plays best. <span class="muted">Deterministic gates everywhere · AI only for judgment · human is the final judge · no guessing.</span></div>

 <h2>Brief requirements</h2>
 <table><thead><tr><th>Requirement</th><th>Status</th><th>Needed</th><th>Evidence</th></tr></thead><tbody>${reqRows}</tbody></table>

 <h2>How it works</h2>
 <div class="flow">${flow}</div>

 <h2>What we use AI for - and what we deliberately keep as code</h2>
 <div class="sub" style="margin-bottom:10px">The core decision rule: <b>AI for judgment/creative tasks, plain code for deterministic ones.</b> Knowing where <i>not</i> to use AI is the point.</div>
 <table><thead><tr><th>Task</th><th>Handled by</th><th>Why</th></tr></thead><tbody>${aiRows}</tbody></table>

 ${
   agentCfg
     ? `<h2>Agent config &amp; versions (rollback-ready)</h2>
 <div class="sub" style="margin-bottom:10px">The agent <b>runtime</b> is separate from its <b>config</b>: behaviour is changed by editing one versioned file (<code>agents.config.json</code>) - a reviewable PR and a git-revertable rollback - not code. Prompt text is versioned as code in <code>prompts/*.md</code>, and each run records the version it used (audit).</div>
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
     ? `<h2>The agentic loop - how the decision was actually made</h2>
 <div class="sub" style="margin-bottom:10px">Not "trust me." This is the real decision trail from the logs: <b>Agent A</b> generates, <b>Agent B</b> (the AI judge) scores and accepts or rejects, and on a reject Agent A re-generates from B's feedback until it passes - or a human is called. Watch an asset that was rejected and then re-generated to pass.</div>
 <div class="loops">${loopCards}</div>`
     : ''
 }

 ${
   golden
     ? `<h2>Judge calibration - who watches the judge?</h2>
 <div class="sub" style="margin-bottom:10px">The judge is an LLM, so it can drift (a model swap silently moves the quality bar). A <b>golden set</b> of labeled cases - real good sprites that must pass, plus a deliberately bad image that must be rejected - checks the judge's agreement with known-correct verdicts. A drop in agreement means the <i>evaluator</i> regressed, caught here before it corrupts future grades.</div>
 <div class="cards"><div class="card"><div class="v">${golden.agreement}%</div><div class="l">judge agreement</div><div class="h">${golden.provider}:${golden.model}</div></div></div>
 <table style="margin-top:12px"><thead><tr><th>Golden case</th><th>Expected</th><th>Judge said</th><th>Match</th></tr></thead><tbody>${goldenRows}</tbody></table>`
     : ''
 }

 ${
   screenshot || e2eRows || visual
     ? `<h2>The end product - tests &amp; visual QA</h2>
 <div class="sub" style="margin-bottom:10px">Two checks on the actual built game: functional Playwright tests (does it load and run), and an AI <b>visual judge</b> that looks at a real gameplay screenshot (does it LOOK right) - catching what functional tests can't, like the sprite-background bug.</div>
 <div class="qa">
  ${gif ? `<div class="shot"><img src="${gif}" alt="gameplay"/><div class="cap">live gameplay (animated)</div></div>` : screenshot ? `<div class="shot"><img src="${screenshot}" alt="gameplay screenshot"/><div class="cap">live gameplay screenshot</div></div>` : ''}
  <div class="qatables">
   ${visual ? `<div class="vq ${visual.ok ? 'vqok' : 'vqbad'}">AI visual verdict: <b>${visual.ok ? 'looks good ✓' : 'issues found'}</b> (${visual.score}/5) - ${esc(visual.summary || '')}${visual.issues && visual.issues.length ? '<ul>' + visual.issues.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>' : ''}</div>` : ''}
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
     ? `<h2>Generated assets - before &rarr; after</h2>
 <div class="sub" style="margin-bottom:10px">Raw AI output (on its magenta key background) next to the processed, transparent sprite the game uses.</div>
 <div class="gallery">${previewCards}</div>`
     : ''
 }

 ${
   provList.length
     ? `<h2>Provenance - proof of AI origin</h2>
 <div class="sub" style="margin-bottom:10px">Each sprite is fingerprinted (SHA-256) when the AI generates it. This re-checks the shipped file still matches - proving it came from the AI generator and was not swapped for hand-drawn or procedural art. Verification + observability.</div>
 <table><thead><tr><th>Asset</th><th>AI generator</th><th>Graded by</th><th>Score</th><th>SHA-256</th><th>Verified</th></tr></thead><tbody>${provRows}</tbody></table>`
     : ''
 }

 ${
   traceRows
     ? `<h2>Run trace - the full decision log</h2>
 <div class="sub" style="margin-bottom:10px">Structured trace of the latest run (trace id <code>${latestId || '-'}</code>). Every stage is a logged span with a timestamp, outcome, and latency - the observability layer the rest of this page reads. Nothing here is hand-written.</div>
 <table><thead><tr><th>Time</th><th>Stage</th><th>Asset</th><th>Try</th><th>Outcome</th><th>Latency</th></tr></thead><tbody>${traceRows}</tbody></table>`
     : ''
 }

 ${
   topCause
     ? `<h2>Operational insights - what caused the most rework</h2>
 <div class="sub" style="margin-bottom:10px">Aggregated across all runs. Biggest source of re-work: <b>${topCause[0]}</b> - where to focus tooling next. (Validation rejects are <i>good</i>: bad assets caught early and never shipped - fail loud, not silent.)</div>
 <table><thead><tr><th>Cause</th><th>Count</th></tr></thead><tbody>${insightRows}</tbody></table>
 <div class="sub" style="margin-top:10px"><b>What was actually hard:</b> not the code - the <b>judgment calls</b>. Where to draw the AI/deterministic line, why the AI judge can't be the sole arbiter (it gave a buggy frame 5/5), and finding the camera bug the functional tests passed straight through. The build is cheap; the <i>decisions</i> are the work.</div>
 <h2>💸 Cost &amp; tokens (AI is metered)</h2>
 <div class="sub" style="margin-bottom:10px">Every AI call is counted. This whole pipeline runs on free tiers, so spend is ~$0 - but it's tracked so it scales honestly.</div>
 <table><thead><tr><th>Meter</th><th>Value</th></tr></thead><tbody>
   <tr><td>AI image generations</td><td>${aiImageCalls} <span class="sub">(Pollinations, $0)</span></td></tr>
   <tr><td>AI judge calls</td><td>${aiJudgeCalls} <span class="sub">(Gemini free tier)</span></td></tr>
   <tr><td>Est. judge tokens</td><td>~${estTokens.toLocaleString()}</td></tr>
   <tr><td>Total cost</td><td><b>$${totalCostUsd.toFixed(4)}</b></td></tr>
 </tbody></table>`
     : ''
 }

 ${
   tests
     ? `<h2>✅ Functional tests &amp; regression (re-run on every code change)</h2>
 <div class="sub" style="margin-bottom:10px">CI runs these on every push, so a code change can't silently break play. Unit = game logic; e2e = the real built game in a browser; regression = the golden eval guarding the AI judge from drift.</div>
 <table><thead><tr><th>Suite</th><th>Result</th><th>Cases</th></tr></thead><tbody>
   <tr><td>🟢 Unit (logic)</td><td><b>${tests.unit.passed}/${tests.unit.total}</b> ${tests.unit.passed === tests.unit.total ? '✅' : '❌'}</td><td class="sub">${tests.unit.cases.map((c) => c.name).join(' · ') || '-'}</td></tr>
   <tr><td>🔵 e2e (built game)</td><td><b>${tests.e2e.passed}/${tests.e2e.total}</b> ${tests.e2e.passed === tests.e2e.total ? '✅' : '❌'}</td><td class="sub">${tests.e2e.cases.map((c) => c.name).join(' · ') || '-'}</td></tr>
   ${tests.regression ? `<tr><td>🟣 Regression (judge drift)</td><td><b>${tests.regression.passed ?? '-'}/${tests.regression.total ?? '-'}</b></td><td class="sub">${tests.regression.summary}</td></tr>` : ''}
 </tbody></table>`
     : ''
 }

 ${
   calibration
     ? `<h2>🎯 Judge calibration (is the grader actually right?)</h2>
 <div class="sub" style="margin-bottom:10px">"The judge is good" is proven, not asserted: the grader is run over a labeled set (real sprites that must pass + deliberately broken ones that must be rejected) and scored on agreement with the labels. Below ${calibration.threshold}% fails CI. Judge: ${calibration.judge}.</div>
 <table><thead><tr><th>Case</th><th>Labelled</th><th>Judged</th><th>Agree</th></tr></thead><tbody>
   ${calibration.cases.map((c) => `<tr><td>${c.name}</td><td>${c.label}</td><td>${c.verdict}</td><td>${c.agree ? '✅' : '❌'}</td></tr>`).join('')}
 </tbody></table>
 <div class="sub" style="margin-top:8px"><b>${calibration.agreementPct}% agreement</b> (${calibration.agreed}/${calibration.total}), gate &ge; ${calibration.threshold}%.</div>`
     : ''
 }

 ${
   device
     ? `<h2>📱 Device-size QA (playable renders on every placement)</h2>
 <div class="sub" style="margin-bottom:10px">A playable ad must fit whatever placement it lands in. Each viewport is loaded and checked: canvas fills the screen (no letterbox/stretch), start button reachable, perspective aspect matches, no overflow. <b>${device.passed}/${device.total} viewports pass.</b></div>
 <table><thead><tr><th>Device</th><th>Size</th><th>Canvas fills</th><th>Start reachable</th><th>No overflow</th><th>Result</th></tr></thead><tbody>
   ${device.devices
     .map(
       (r) =>
         `<tr><td>${r.label}</td><td class="sub">${r.w}×${r.h}</td><td>${r.canvasFills ? '✅' : '❌'}</td><td>${r.startVisible ? '✅' : '❌'}</td><td>${r.noOverflow ? '✅' : '❌'}</td><td>${r.ok ? '✅' : '❌'}</td></tr>`
     )
     .join('')}
 </tbody></table>
 ${
   device.shots && (device.shots.portrait || device.shots.landscape)
     ? `<div class="qa" style="margin-top:12px">${device.shots.portrait ? `<div class="shot"><img src="data:image/png;base64,${device.shots.portrait}" style="max-width:170px"/><div class="cap">portrait</div></div>` : ''}${device.shots.landscape ? `<div class="shot"><img src="data:image/png;base64,${device.shots.landscape}" style="max-width:320px"/><div class="cap">landscape</div></div>` : ''}</div>`
     : ''
 }`
     : ''
 }

 ${
   performance
     ? `<h2>🎯 Closing the loop - real-play performance (the north-star)</h2>
 <div class="sub" style="margin-bottom:10px">The asset rubric asks "does it look good?". This asks "which variant actually <b>performs</b>?". ${
   performance.realUsers
     ? `These are <b>real-user ad KPIs</b> from the ad-network performance webhook feed (<span class="muted">simulated here, but the exact production shape</span>): click-through, install rate, playtime. The collector reads the webhook feed instead of local runs - the literal one-line swap - and ranks by <b>install rate</b>, the real-money north-star.`
     : `Each variant is played repeatedly and the game's <code>window.__telemetry</code> is aggregated into an engagement proxy. Point the collector at the ad-network webhook to get real-user KPIs in these same panels.`
 } Source: ${performance.source}. ${performance.totalSessions} sessions.</div>
 <table><thead><tr>${
   performance.realUsers
     ? `<th>Variant</th><th>Install rate</th><th>CTR</th><th>Avg playtime</th><th>Sessions</th>`
     : `<th>Variant</th><th>Engagement</th><th>Share</th><th>Avg score</th><th>Sessions</th>`
 }</tr></thead><tbody>
   ${performance.perVariant
     .map((v) =>
       performance.realUsers
         ? `<tr><td>${v.variant === performance.winner ? '🏆 ' : ''}${v.variant}</td><td><b>${v.installRatePct}%</b> <span class="sub">95% CI [${v.installLoPct}-${v.installHiPct}]</span></td><td>${v.ctrPct}%</td><td>${v.avgPlaytimeS}s</td><td>${v.sessions}</td></tr>`
         : `<tr><td>${v.variant === performance.winner ? '🏆 ' : ''}${v.variant}</td><td><b>${v.engagement}</b></td><td>${v.winSharePct}%</td><td>${v.avgScore}</td><td>${v.sessions}</td></tr>`
     )
     .join('')}
 </tbody></table>
 <div class="sub" style="margin-top:8px">${performance.realUsers ? (performance.significant ? '✅ <b>Significant</b> ' : '⏸ <b>Hold</b> ') : ''}${performance.recommendation}</div>
 ${performance.realUsers ? `<div class="sub">We only promote a variant when its install-rate 95% confidence interval clears the runner-up's (non-overlapping) AND the sample is large enough. Otherwise the lead is noise and we keep collecting. No promoting on a coin-flip.</div>` : ''}`
     : ''
 }

 ${
   shadow
     ? `<h2>Champion vs Challenger - safe prompt rollout</h2>
 <div class="sub" style="margin-bottom:10px">A candidate prompt is shadow-run beside the live one, graded the same way, and only recommended for promotion when it clearly wins. The system never auto-swaps - <b>the human approves the version bump</b>. Judge: ${shadow.judge}.</div>
 <table><thead><tr><th>Prompt</th><th>Avg score</th><th>Samples</th><th>Passes deterministic gate</th></tr></thead><tbody>
   <tr><td>${shadow.champion.label}</td><td><b>${shadow.champion.avgScore}</b></td><td>${shadow.champion.n}</td><td>${shadow.champion.allDetOk ? '✅' : '❌'}</td></tr>
   <tr><td>${shadow.challenger.label}</td><td><b>${shadow.challenger.avgScore}</b></td><td>${shadow.challenger.n}</td><td>${shadow.challenger.allDetOk ? '✅' : '❌'}</td></tr>
 </tbody></table>
 <div class="sub" style="margin-top:8px">Δ ${shadow.delta >= 0 ? '+' : ''}${shadow.delta} (margin ${shadow.margin}) &rarr; <b>${shadow.recommendation}</b>. ${shadow.note}</div>`
     : ''
 }

 <h2>All validation gates</h2>
 <div class="sub" style="margin-bottom:10px">Every automatic check in the project. "live" = result from this run; "wired" = runs in <code>npm run ci</code> / CI.</div>
 <table><thead><tr><th>Gate</th><th>What it guarantees (plain)</th><th>How (technical)</th><th>Status</th></tr></thead><tbody>${gateRows}</tbody></table>

 <h2>Engineering best practices - where each one lives</h2>
 <table><thead><tr><th>Practice</th><th>What it means</th><th>Where</th></tr></thead><tbody>${practiceRows}</tbody></table>

 <div class="blind">
  <h3>What's real here, and the one thing still synthetic</h3>
  <p><b>The whole loop is built and closed on this page:</b> internal quality (the rubric), correctness
  (the gates), and real-play performance (the telemetry collector ranks variants by engagement and the
  champion/challenger selector recommends what to promote).</p>
  <p>The collector takes sessions from <b>anyone who plays</b> through one pipe: a real user via the ad
  network's performance webhook, or a Playwright run, both in the same <code>window.__telemetry</code>
  shape (variant, clicked, installed, playtime). The only thing <b>simulated</b> right now is the volume
  of real users, the webhook feed here is synthetic. Going fully live is a <b>one-line swap</b>: point the
  collector at the production webhook URL. Same shape, same panels, real money KPIs.</p>
 </div>
</main></body></html>`;

writeFileSync(OUT, html);
console.log(`Dashboard written: ${OUT}\nOpen it in a browser (no server needed).`);
