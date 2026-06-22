/**
 * The judge (the "Agent B" that grades the artwork).
 *
 * Plain-language: this scores a sprite against the rubric and returns a structured verdict.
 *   - `anthropicJudge` sends the image to Claude (vision) and forces a clean, structured score via
 *     tool-use, so we never have to parse free text. Activates automatically when an API key is set.
 *   - `mockJudge` produces a deterministic score offline, so the pipeline still runs with no key.
 * Either way the rest of the system gets the same verdict shape — another swappable adapter.
 *
 * Model selection lives in config (default claude-opus-4-8). Cheaper judges are a config change:
 *   claude-opus-4-8  $5/$25 per MTok   (default)
 *   claude-sonnet-4-6 $3/$15
 *   claude-haiku-4-5  $1/$5
 */

import { judgeTool, judgePrompt, CRITERIA } from './rubric.mjs';

const PRICING = {
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

/** Retry transient API failures (429/5xx) with exponential backoff — basic resilience. */
async function fetchWithBackoff(url, options, tries = 4) {
  let delay = 500;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) return res; // non-retryable
    if (attempt === tries) return res;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
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

/** Pick the judge based on config + whether a key is present. */
export function getJudge(provider) {
  return provider === 'anthropic' ? anthropicJudge : mockJudge;
}
