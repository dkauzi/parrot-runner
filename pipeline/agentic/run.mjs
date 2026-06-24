#!/usr/bin/env node
/**
 * The orchestrator - the agentic loop that turns prompts into approved sprites.
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
import { createHash } from 'node:crypto';
import { validateBuffer, validateScene } from './png.mjs';
import { getImageProvider } from './generate.mjs';
import { getJudge } from './judge.mjs';
import { scoreVerdict, MAX_SCORE } from './rubric.mjs';
import { gradeSprite } from './grade-deterministic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// Versioned agent config (config-as-data): defaults come from this git-tracked file; env vars
// override at runtime. Changing agent behaviour is a reviewable edit + a git-revertable rollback.
let AGENTS = {};
try {
  AGENTS = JSON.parse(readFileSync(join(HERE, 'agents.config.json'), 'utf8'));
} catch {
  /* fall back to built-in defaults below */
}

// ---- Config: the single place to change behaviour (model selection, thresholds, providers) ----
const config = {
  assets: ['parrot', 'fruit', 'tree'],
  configVersion: AGENTS.version || 'unset',
  imageProvider: process.env.IMAGE_PROVIDER || AGENTS.imageProvider || 'mock',
  // Judge auto-selects by which key is present: Claude (paid) > Gemini (free) > mock (offline).
  judgeProvider: process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : 'mock',
  judgeModel: process.env.JUDGE_MODEL || AGENTS.judge?.anthropicModel || 'claude-opus-4-8',
  geminiModel: process.env.GEMINI_MODEL || AGENTS.judge?.geminiModel || 'gemini-2.5-flash',
  threshold: Number(process.env.GRADE_THRESHOLD || AGENTS.thresholds?.accept || 18),
  minCriterion: AGENTS.thresholds?.minCriterion ?? 3,
  maxAttempts: Number(process.env.MAX_ATTEMPTS || AGENTS.thresholds?.maxAttempts || 3),
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
  const judgeModel = config.judgeProvider === 'gemini' ? config.geminiModel : config.judgeModel;
  const judgeApiKey =
    config.judgeProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(config.runsDir, `run-${runId}.jsonl`);
  const summary = [];
  const provenance = []; // audit record proving each promoted sprite came from an AI generator
  const previews = {}; // before/after thumbnails per asset for the dashboard
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  const dataUri = (buf) => 'data:image/png;base64,' + buf.toString('base64');

  console.log(
    `Pipeline run ${runId}  |  image=${config.imageProvider}  judge=${config.judgeProvider}` +
      ` (${judgeModel})  threshold=${config.threshold}/${MAX_SCORE}\n`
  );

  for (const asset of assets) {
    const prompt = readPrompt(asset);
    // Asset kind drives processing: 'scene' = opaque full image (background, ground texture);
    // 'sprite' = transparent cutout.
    const kind = asset === 'background' || asset === 'ground' ? 'scene' : 'sprite';
    let feedback = '';
    let accepted = false;
    let lastVerdict = null;
    let attemptsUsed = 0;
    let costUsd = 0;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      attemptsUsed = attempt;
      const started = Date.now();

      // STAGE 1: generate (network providers can fail transiently -> log and retry, don't crash)
      let buffer, genProvider, genPreview;
      try {
        const gen = await generate(asset, prompt + feedback, attempt);
        buffer = gen.buffer;
        genProvider = gen.provider;
        genPreview = gen.preview;
      } catch (err) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'generate', accepted: false,
          error: err.message, latencyMs: Date.now() - started,
        });
        feedback += `\nGeneration failed (${err.message}); retrying.`;
        continue;
      }

      // STAGE 2: deterministic gate (kind-appropriate: scene vs sprite)
      const vfails = kind === 'scene' ? validateScene(buffer) : validateBuffer(buffer);
      if (vfails.length) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'validate', accepted: false,
          valid: false, problems: vfails, latencyMs: Date.now() - started,
        });
        feedback += `\nFix: ${vfails.join('; ')}.`;
        continue;
      }

      // The background (scene) is gated DETERMINISTICALLY - a backdrop that passes the image
      // checks is fine; spending an LLM rubric on it would be over-applying AI. The gameplay
      // sprites below get the full LLM judge because their quality is a real judgment call.
      if (kind === 'scene') {
        const outFile = join(config.outDir, `${asset}.jpg`);
        writeFileSync(outFile, buffer);
        previews[asset] = genPreview || { before: dataUri(buffer), after: dataUri(buffer) };
        if (promote) copyFileSync(outFile, join(ROOT, 'assets', `${asset}.jpg`));
        logLine(logPath, {
          runId, asset, attempt, stage: 'judge', accepted: true, valid: true,
          total: null, provider: 'deterministic', model: 'validateScene',
          latencyMs: Date.now() - started,
        });
        accepted = true;
        break;
      }

      // STAGE 2b: DETERMINISTIC quality grade - always runs. Catches opaque-background / empty /
      // off-centre sprites without an LLM (this is what should have caught the pink-box bug), and
      // is the FALLBACK verdict when the AI judge is unavailable.
      const det = await gradeSprite(buffer);
      if (!det.ok) {
        logLine(logPath, {
          runId, asset, attempt, stage: 'validate', accepted: false,
          valid: false, problems: det.issues, latencyMs: Date.now() - started,
        });
        feedback += `\nFix: ${det.issues.join('; ')}.`;
        continue;
      }

      // STAGE 3: LLM judge (taste / game feel)
      const result = await judge({ buffer, asset, model: judgeModel, apiKey: judgeApiKey });
      costUsd += result.costUsd || 0;
      const scored = result.ok ? scoreVerdict(result.verdict) : null;

      if (!result.ok || !scored.ok) {
        // The AI judge is unavailable or unsure -> DEGRADE TO THE DETERMINISTIC VERDICT (it already
        // passed), never to a guess. Accept it, flagged deterministic-only. This is "deterministic
        // judge always": the AI adds taste when it can, but code is the floor that always decides.
        const reason = result.ok ? scored.error : result.reason;
        const outFile = join(config.outDir, `${asset}.png`);
        writeFileSync(outFile, buffer);
        previews[asset] = genPreview || { before: dataUri(buffer), after: dataUri(buffer) };
        if (promote) {
          copyFileSync(outFile, join(config.gameSpritesDir, `${asset}.png`));
          provenance.push({
            asset, generator: genProvider, judge: 'deterministic-fallback', score: null,
            promptSha256: sha(prompt), imageSha256: sha(buffer), runId, generatedAt: new Date().toISOString(),
          });
        }
        logLine(logPath, {
          runId, asset, attempt, stage: 'judge', accepted: true, valid: true, total: null,
          provider: 'deterministic', model: 'gradeSprite',
          reason: `AI judge unavailable/unsure (${reason}); deterministic grade passed`,
          latencyMs: Date.now() - started,
        });
        accepted = true;
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
        const ext = kind === 'scene' ? 'jpg' : 'png';
        const outFile = join(config.outDir, `${asset}.${ext}`);
        writeFileSync(outFile, buffer);
        previews[asset] = genPreview || { before: dataUri(buffer), after: dataUri(buffer) };
        if (promote) {
          // Scene -> assets/background.jpg (the game backdrop); sprites -> assets/sprites/*.png.
          const dest =
            kind === 'scene'
              ? join(ROOT, 'assets', `background.${ext}`)
              : join(config.gameSpritesDir, `${asset}.png`);
          copyFileSync(outFile, dest);
          // Record provenance so the AI origin of this sprite is later verifiable.
          provenance.push({
            asset,
            generator: genProvider, // the AI image provider (e.g. pollinations)
            judge: `${result.provider}:${result.model}`,
            score: scored.total,
            promptSha256: sha(prompt),
            imageSha256: sha(buffer),
            runId,
            generatedAt: new Date().toISOString(),
          });
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

  // Persist the provenance manifest (merged) so committed sprites stay verifiable.
  if (promote && provenance.length) {
    const file = join(ROOT, 'assets', 'provenance.json');
    let existing = {};
    try {
      existing = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* first run */
    }
    for (const p of provenance) existing[p.asset] = p;
    writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
    console.log(`Provenance recorded for ${provenance.length} asset(s) -> assets/provenance.json`);
  }

  // Persist before/after thumbnails for the dashboard (merged, so single-asset runs don't wipe
  // the others).
  if (Object.keys(previews).length) {
    const file = join(config.outDir, 'previews.json');
    let existing = {};
    try {
      existing = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* first run */
    }
    writeFileSync(file, JSON.stringify({ ...existing, ...previews }));
  }

  // Persist a machine-readable summary the dashboard reads.
  const summaryPath = join(config.runsDir, `run-${runId}.summary.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      { runId, config: { configVersion: config.configVersion, judgeProvider: config.judgeProvider, judgeModel: judgeModel, threshold: config.threshold }, summary },
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
