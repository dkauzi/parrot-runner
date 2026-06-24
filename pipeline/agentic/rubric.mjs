/**
 * The grading rubric, as data + an Anthropic tool schema.
 *
 * This is the judgment half of the pipeline (Seepia's "Agent B grades Agent A"), expressed once
 * so both the LLM judge (structured tool-use output) and the mock judge score against the same
 * criteria. Mirrors pipeline/grade.md.
 */

export const CRITERIA = [
  { key: 'reads_at_scale', label: 'Recognisable at in-game sprite size' },
  { key: 'silhouette', label: 'Clean outline against a busy jungle background' },
  { key: 'on_theme', label: 'Fits the tropical-jungle playable-ad look' },
  { key: 'palette', label: 'Saturation/lighting consistent with the other assets' },
  { key: 'transparency', label: 'Edges clean, no halo or leftover background' },
];

export const MAX_SCORE = CRITERIA.length * 5; // 25

/** Anthropic tool definition: forces a structured, schema-valid verdict (no free-text parsing). */
export function judgeTool() {
  const properties = { reasoning: { type: 'string', description: 'One or two sentences.' } };
  for (const c of CRITERIA) {
    properties[c.key] = { type: 'integer', description: `${c.label} (1=poor, 5=excellent)` };
  }
  return {
    name: 'grade',
    description: 'Grade a generated game sprite against the rubric. Score each criterion 1-5.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required: [...CRITERIA.map((c) => c.key), 'reasoning'],
    },
  };
}

/** The instruction text paired with the image. The judge reviews as a senior GAME DESIGNER —
 *  evaluating game feel and readability at speed, not just whether the art is pretty. */
export function judgePrompt(asset) {
  const lines = CRITERIA.map((c) => `- ${c.key}: ${c.label}`).join('\n');
  return (
    `You are a SENIOR GAME DESIGNER reviewing an AI-generated "${asset}" collectible for a fast ` +
    `tropical-jungle auto-runner. The player flies forward and must INSTANTLY recognise and grab ` +
    `it — at small size, in motion, against a busy jungle background. Judge GAME FEEL and ` +
    `readability, not prettiness: does it read at a glance, pop from the background, and look like ` +
    `a desirable thing to collect?\n\n` +
    `Score each criterion from 1 (poor) to 5 (excellent):\n${lines}\n\n` +
    `Call the grade tool with integer scores and a brief reasoning. Be a strict critic.`
  );
}

/** Validate a verdict's shape + compute total. Returns { ok, total, weak[], error? }. */
export function scoreVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') return { ok: false, error: 'verdict not an object' };
  let total = 0;
  const weak = [];
  for (const c of CRITERIA) {
    const v = verdict[c.key];
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      return { ok: false, error: `criterion ${c.key} not an integer 1-5 (got ${v})` };
    }
    total += v;
    if (v < 3) weak.push(c.key);
  }
  return { ok: true, total, weak };
}
