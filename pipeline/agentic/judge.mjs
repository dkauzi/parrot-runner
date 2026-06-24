/**
 * The judge (the "Agent B" that grades the artwork).
 *
 * Plain-language: this scores a sprite against the rubric and returns a structured verdict.
 *   - `anthropicJudge` sends the image to Claude (vision) and forces a clean, structured score via
 *     tool-use, so we never have to parse free text. Activates automatically when an API key is set.
 *   - `mockJudge` produces a deterministic score offline, so the pipeline still runs with no key.
 * Either way the rest of the system gets the same verdict shape - another swappable adapter.
 *
 * Model selection lives in config (default claude-opus-4-8). Cheaper judges are a config change:
 *   claude-opus-4-8  $5/$25 per MTok   (default)
 *   claude-sonnet-4-6 $3/$15
 *   claude-haiku-4-5  $1/$5
 */

import { Jimp } from 'jimp';
import { judgeTool, judgePrompt, CRITERIA } from './rubric.mjs';

/** Downscale the image the judge sees: a grader doesn't need full res, and fewer pixels = fewer
 *  tokens = friendlier to free-tier rate limits. Returns base64 PNG. */
async function smallBase64(buffer, max = 128) {
  const img = await Jimp.read(buffer);
  img.scaleToFit({ w: max, h: max });
  return (await img.getBuffer('image/png')).toString('base64');
}

const PRICING = {
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

/** Retry transient API failures with backoff. 429 (rate limit) waits longer, since free tiers
 *  meter per-minute; 5xx uses a short backoff. Non-retryable errors return immediately. */
async function fetchWithBackoff(url, options, tries = 3) {
  let res;
  for (let attempt = 1; attempt <= tries; attempt++) {
    res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) return res; // non-retryable
    if (attempt === tries) return res;
    const wait = res.status === 429 ? 15000 * attempt : 800 * attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
  return res;
}

/** Real LLM judge: vision input + forced tool-use for a structured verdict. */
export async function anthropicJudge({ buffer, asset, model, apiKey }) {
  const body = {
    model,
    max_tokens: 1024,
    tools: [judgeTool()],
    tool_choice: { type: 'tool', name: 'grade' }, // force a structured verdict
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: buffer.toString('base64') },
          },
          { type: 'text', text: judgePrompt(asset) },
        ],
      },
    ],
  };

  const res = await fetchWithBackoff('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, reason: `api ${res.status}`, provider: 'anthropic', model };
  }
  const json = await res.json();
  if (json.stop_reason === 'refusal') {
    return { ok: false, reason: 'model refused', provider: 'anthropic', model };
  }
  const block = (json.content || []).find((b) => b.type === 'tool_use' && b.name === 'grade');
  if (!block) return { ok: false, reason: 'no structured verdict returned', provider: 'anthropic', model };

  const usage = json.usage || {};
  const [pin, pout] = PRICING[model] || [0, 0];
  const costUsd = ((usage.input_tokens || 0) / 1e6) * pin + ((usage.output_tokens || 0) / 1e6) * pout;
  return { ok: true, verdict: block.input, provider: 'anthropic', model, costUsd };
}

/**
 * FREE real vision judge via Google Gemini (generous free tier).
 *
 * Plain-language: same job as the Claude judge - look at the sprite, score it against the rubric -
 * but using Google's free model. Asks for JSON back so we never parse free text. Activates when
 * GEMINI_API_KEY is set. Default model gemini-2.0-flash (override with GEMINI_MODEL).
 */
export async function geminiJudge({ buffer, asset, model, apiKey }) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const shape = `{${CRITERIA.map((c) => `"${c.key}": <integer 1-5>`).join(', ')}, "reasoning": "<string>"}`;
  const data = await smallBase64(buffer);
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: 'image/png', data } },
          { text: `${judgePrompt(asset)}\nRespond ONLY with JSON of exactly this shape: ${shape}` },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };

  const res = await fetchWithBackoff(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, reason: `api ${res.status}`, provider: 'gemini', model };
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, reason: 'no content returned', provider: 'gemini', model };
  let verdict;
  try {
    verdict = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'non-JSON verdict', provider: 'gemini', model };
  }
  return { ok: true, verdict, provider: 'gemini', model, costUsd: 0 }; // free tier
}

/** Offline judge: deterministic scores so the pipeline runs with no API key. */
export async function mockJudge({ buffer, asset }) {
  // Derive stable pseudo-scores from the image bytes so re-runs are repeatable.
  let h = 0;
  for (let i = 0; i < buffer.length; i += 997) h = (h + buffer[i]) & 0xffff;
  const verdict = { reasoning: `mock grade for ${asset}` };
  CRITERIA.forEach((c, i) => {
    verdict[c.key] = 3 + (((h >> i) ^ (h >> (i + 3))) & 1) + ((h >> (i + 1)) & 1); // 3..5
  });
  return { ok: true, verdict, provider: 'mock', model: 'mock', costUsd: 0 };
}

/** Pick the judge based on config. Swappable adapter - add a provider here, nothing else moves. */
export function getJudge(provider) {
  if (provider === 'anthropic') return anthropicJudge;
  if (provider === 'gemini') return geminiJudge;
  return mockJudge;
}
