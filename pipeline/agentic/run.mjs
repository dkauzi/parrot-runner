#!/usr/bin/env node
/**
 * The orchestrator — the agentic loop that turns prompts into approved sprites.
 *
 * Plain-language for stakeholders: this is the assembly line.
 *   1. GENERATE  an image from the versioned prompt            (Agent A)
 *   2. VALIDATE  it against hard rules (PNG, square, transparent, size)  -- automatic gate
 *   3. JUDGE     it against the quality rubric                 (Agent B, the LLM)
 *   4. DECIDE    accept, or send feedback back to step 1 and retry
 *   5. ESCALATE  to a human if it can't pass after N tries     (human stays the judge)
 * Every attempt is logged so the dashboard can show exactly what happened and what it cost.
 *
 * Repeatable: one command (`npm run pipeline`) runs the whole thing the same way every time.
 * Changeable: the model is a config value; the image and judge providers are swappable adapters
 *   (see generate.mjs / judge.mjs). When an API changes, you edit ONE adapter, not the pipeline.
 *
 * Usage:
 *   node pipeline/agentic/run.mjs                 # all assets, mock providers (no key needed)
 *   node pipeline/agentic/run.mjs --asset fruit   # one asset
 *   node pipeline/agentic/run.mjs --promote       # also copy approved sprites into the game
 *   ANTHROPIC_API_KEY=... node pipeline/agentic/run.mjs   # use the real Claude judge
 */

import { mkdirSync, writeFileSync, appendFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBuffer } from './png.mjs';
import { getImageProvider } from './generate.mjs';
import { getJudge } from './judge.mjs';
import { scoreVerdict, MAX_SCORE } from './rubric.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// ---- Config: the single place to change behaviour (model selection, thresholds, providers) ----
const config = {
  assets: ['parrot', 'fruit', 'tree'],
  imageProvider: process.env.IMAGE_PROVIDER || 'mock', // 'pollinations' = free real AI art
  // Judge auto-selects by which key is present: Claude (paid) > Gemini (free) > mock (offline).
  judgeProvider: process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : 'mock',
  judgeModel: process.env.JUDGE_MODEL || 'claude-opus-4-8', // cheaper: claude-haiku-4-5
  threshold: Number(process.env.GRADE_THRESHOLD || 18), // accept at >= 18/25
  minCriterion: 3, // and no single criterion below 3
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
  outDir: join(HERE, 'out'),
  runsDir: join(HERE, 'runs'),
  gameSpritesDir: join(ROOT, 'assets', 'sprites'),
};

// ---- Prompt as code: read the versioned generation prompt for an asset ----
function readPrompt(asset) {
  try {
    const md = readFileSync(join(ROOT, 'prompts', `${asset}.md`), 'utf8');
    const fenced = md.match(/```([\s\S]*?)```/); // first fenced block = the prompt text
    return (fenced ? fenced[1] : md).trim();
  } catch {
    return `A ${asset} sprite, tropical jungle style, transparent background.`;
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}

async function run() {
  mkdirSync(config.outDir, { recursive: true });
  mkdirSync(config.runsDir, { recursive: true });

  const only = arg('--asset');
  const promote = !!arg('--promote');
  const assets = only && typeof only === 'string' ? [only] : config.assets;

  const generate = getImageProvider(config.imageProvider);
  const judge = getJudge(config.judgeProvider);
  // Each provider gets its own key + model. Adding a provider does not change this shape.
  const judgeModel =
    config.judgeProvider === 'gemini' ? process.env.GEMINI_MODEL || 'gemini-1.5-flash' : config.judgeModel;
  const judgeApiKey =
    config.judgeProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(config.runsDir, `run-${runId}.jsonl`);
  const summary = [];

  console.log(
    `Pipeline run ${runId}  |  image=${config.imageProvider}  judge=${config.judgeProvider}` +
      ` (${judgeModel})  threshold=${config.threshold}/${MAX_SCORE}\n`
  );

  for (const asset of assets) {
    const prompt = readPrompt(asset);
    let feedback = '';
    let accepted = false;
    let lastVerdict = null;
    let attemptsUsed = 0;
    let costUsd = 0;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      attemptsUsed = attempt;
      const started = Date.now();

      // STAGE 1: generate (network providers can fail transiently -> log and retry, don't crash)
      let buffer;
      try {
        ({ buffer } = await generate(asset, prompt + feedback, attempt));
      } catch (err) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'generate', accepted: false,
          error: err.message, latencyMs: Date.now() - started,
        });
        feedback += `\nGeneration failed (${err.message}); retrying.`;
        continue;
      }

      // STAGE 2: deterministic gate
      const vfails = validateBuffer(buffer);
      if (vfails.length) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'validate', accepted: false,
          valid: false, problems: vfails, latencyMs: Date.now() - started,
        });
        feedback += `\nFix: ${vfails.join('; ')}.`;
        continue;
      }

      // STAGE 3: LLM judge
      const result = await judge({ buffer, asset, model: judgeModel, apiKey: judgeApiKey });
      costUsd += result.costUsd || 0;
      if (!result.ok) {
        // Malformed/refused verdict -> escalate to a human (safety: never guess).
        logLine(logPath, {
          runId, asset, attempt, stage: 'judge', accepted: false,
          valid: true, humanReview: true, reason: result.reason,
          provider: result.provider, model: result.model, latencyMs: Date.now() - started,
        });
        break;
      }

      const scored = scoreVerdict(result.verdict);
      if (!scored.ok) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'judge', accepted: false,
          valid: true, humanReview: true, reason: scored.error,
          provider: result.provider, model: result.model, latencyMs: Date.now() - started,
        });
        break;
      }

      lastVerdict = result.verdict;
      const pass = scored.total >= config.threshold && scored.weak.length === 0;
      logLine(logPath, {
        runId, asset, attempt, stage: 'judge', accepted: pass,
        valid: true, total: scored.total, max: MAX_SCORE, weak: scored.weak,
        scores: result.verdict, provider: result.provider, model: result.model,
        costUsd: result.costUsd || 0, latencyMs: Date.now() - started,
      });

      if (pass) {
        const outFile = join(config.outDir, `${asset}.png`);
        writeFileSync(outFile, buffer);
        if (promote) {
          copyFileSync(outFile, join(config.gameSpritesDir, `${asset}.png`));
        }
        accepted = true;
        break;
      }
      // STAGE 4: Agent A fixes per Agent B's feedback, then retries.
      feedback += `\nImprove (was ${scored.total}/${MAX_SCORE}, weak: ${scored.weak.join(', ') || 'none'}): ${result.verdict.reasoning}`;
    }

    const total = lastVerdict ? scoreVerdict(lastVerdict).total : null;
    summary.push({ asset, accepted, attempts: attemptsUsed, total, costUsd });
    const status = accepted ? 'ACCEPTED' : 'NEEDS HUMAN';
    console.log(
      `  ${asset.padEnd(7)} ${status.padEnd(11)} ` +
        `${total ?? '-'}/${MAX_SCORE}  attempts=${attemptsUsed}  $${costUsd.toFixed(4)}`
    );
  }

  // Persist a machine-readable summary the dashboard reads.
  const summaryPath = join(config.runsDir, `run-${runId}.summary.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      { runId, config: { judgeProvider: config.judgeProvider, judgeModel: config.judgeModel, threshold: config.threshold }, summary },
      null,
      2
    )
  );
  const accepted = summary.filter((s) => s.accepted).length;
  console.log(
    `\n${accepted}/${summary.length} approved automatically. Log: ${logPath}\n` +
      `Build the dashboard with: npm run pipeline:dashboard`
  );
}

function logLine(path, record) {
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
