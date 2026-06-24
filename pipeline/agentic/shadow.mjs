#!/usr/bin/env node
/**
 * Champion vs Challenger - shadow-test a candidate prompt beside the live one.
 *
 * The "run the new thing silently next to the proven thing, compare, promote only when it wins"
 * pattern. Generates N samples from each prompt, grades both the SAME way (deterministic gate +
 * AI judge for taste), and RECOMMENDS promote/hold. It never auto-swaps - the human remains the
 * judge; this just brings evidence. Output feeds the dashboard.
 *
 * Run:  node pipeline/agentic/shadow.mjs --asset fruit --n 3 [--challenger-file p.md]
 *       (offline by default via the mock provider/judge; set GEMINI_API_KEY for the real judge)
 */
import { getImageProvider } from './generate.mjs';
import { gradeSprite } from './grade-deterministic.mjs';
import { getJudge } from './judge.mjs';
import { scoreVerdict, MAX_SCORE } from './rubric.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const asset = arg('asset', 'fruit');
const N = Number(arg('n', 3));

// prompt-as-code: the live (champion) prompt text lives in prompts/<asset>.md (first fenced block)
const fence = (md) => (md.match(/```([\s\S]*?)```/) || [, md])[1].trim();
const championPrompt = fence(readFileSync(join(ROOT, 'prompts', `${asset}.md`), 'utf8'));
const challengerFile = arg('challenger-file', null);
const challengerPrompt = challengerFile
  ? fence(readFileSync(challengerFile, 'utf8'))
  : `${championPrompt} Dramatic rim light, extra glossy, high contrast.`; // demo variant if none given

const provider = getImageProvider(process.env.IMAGE_PROVIDER || 'mock');
const judgeProvider = process.env.JUDGE_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');
const judge = getJudge(judgeProvider);
const judgeModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// One sample -> a 0-100 score. Deterministic gate is the FLOOR (a sprite that fails it is capped);
// the AI judge adds taste on top. Same scoring for both prompts = a fair comparison.
async function scoreOne(prompt, i) {
  const { buffer } = await provider(asset, prompt, i);
  const det = await gradeSprite(buffer);
  let aiNorm = null;
  try {
    const res = await judge({ buffer, asset, model: judgeModel, apiKey: process.env.GEMINI_API_KEY });
    const scored = scoreVerdict(res.verdict);
    if (scored.ok) aiNorm = (scored.total / MAX_SCORE) * 100;
  } catch {
    aiNorm = null; // judge unavailable -> deterministic-only comparison (AI is not the sole arbiter)
  }
  const detScore = det.ok ? 100 : Math.max(0, 100 - det.issues.length * 25);
  const score = aiNorm == null ? detScore : Math.round(Math.min(aiNorm, det.ok ? 100 : 40));
  return { score, detOk: det.ok, issues: det.issues };
}

async function evalPrompt(prompt, label) {
  const samples = [];
  for (let i = 0; i < N; i++) samples.push(await scoreOne(prompt, i));
  const avg = Math.round(samples.reduce((s, x) => s + x.score, 0) / samples.length);
  return { label, n: N, avgScore: avg, allDetOk: samples.every((s) => s.detOk), samples };
}

const champion = await evalPrompt(championPrompt, 'champion (live)');
const challenger = await evalPrompt(challengerPrompt, 'challenger (candidate)');

const MARGIN = 3; // require a clear win, not noise
const delta = challenger.avgScore - champion.avgScore;
const promote = delta >= MARGIN && challenger.allDetOk;
const verdict = {
  asset,
  judge: judgeProvider === 'gemini' && process.env.GEMINI_API_KEY ? judgeModel : `${judgeProvider} (deterministic-only)`,
  champion,
  challenger,
  delta,
  margin: MARGIN,
  recommendation: promote ? 'PROMOTE challenger' : 'HOLD champion',
  note: 'Recommendation only - a human approves the prompt-version bump (human remains the judge).',
  at: new Date().toISOString(),
};
writeFileSync(join(OUT, 'shadow-eval.json'), JSON.stringify(verdict, null, 2));
console.log(
  `Shadow [${asset}] champion ${champion.avgScore} vs challenger ${challenger.avgScore} ` +
    `(Δ${delta >= 0 ? '+' : ''}${delta}, judge=${verdict.judge}) -> ${verdict.recommendation}`
);
