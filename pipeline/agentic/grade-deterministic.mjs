/**
 * Deterministic sprite grader - the judge that is ALWAYS right because it's just math.
 *
 * Principle (the user's, and correct): the AI judge handles taste, but it must never be the sole
 * arbiter. Anything an LLM could be "unsure" about that code CAN measure, code should measure. This
 * checks the things that make a sprite a usable game cutout - and would have caught the opaque
 * pink-background bug instantly (it's literally "the background isn't transparent"):
 *   - transparency ratio  (there is a real transparent background, not an opaque box)
 *   - subject coverage     (not empty, not filling the whole frame)
 *   - rough centering      (the subject sits near the middle)
 *   - interior holes       (the chroma-key did not punch transparent gaps INSIDE the subject)
 * It runs BEFORE the AI judge (cheap, deterministic gate) and is also the FALLBACK verdict when the
 * AI judge is unavailable/rate-limited - so we degrade to deterministic, never to "guess".
 *
 * Thresholds are passed in (config-as-data): run.mjs reads them from agents.config.json, so tuning a
 * gate is a versioned config edit, not a code change.
 */

import { Jimp } from 'jimp';

const DEFAULTS = { maxHolePct: 0.4 };

export async function gradeSprite(buffer, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const img = await Jimp.read(buffer);
  const { data, width: W, height: H } = img.bitmap;
  const total = W * H;
  let transparent = 0;
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  let opaque = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = data[(y * W + x) * 4 + 3];
      if (a < 24) {
        transparent++;
      } else {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const transRatio = transparent / total;
  const coverage = opaque / total;
  const cx = opaque ? (minX + maxX) / 2 / W : 0.5;
  const cy = opaque ? (minY + maxY) / 2 / H : 0.5;

  // Interior holes: flood-fill the transparent region from the BORDER inward; any transparent pixel
  // the flood can't reach is enclosed by the subject = a hole the chroma-key wrongly punched out.
  const isT = (p) => data[p * 4 + 3] < 24;
  const visited = new Uint8Array(total);
  const stack = [];
  const seed = (x, y) => {
    const p = y * W + x;
    if (!visited[p] && isT(p)) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }
  let holes = 0;
  for (let p = 0; p < total; p++) if (isT(p) && !visited[p]) holes++;
  const holePct = (holes / total) * 100;

  const issues = [];
  if (transRatio < 0.15) issues.push('background is not transparent (opaque box behind the sprite)');
  if (coverage < 0.04) issues.push('sprite is almost empty');
  if (coverage > 0.92) issues.push('subject fills the whole frame (no clean cutout)');
  if (Math.abs(cx - 0.5) > 0.32 || Math.abs(cy - 0.5) > 0.36) issues.push('subject is off-centre');
  if (holePct > cfg.maxHolePct)
    issues.push(`sprite has interior holes (${holePct.toFixed(1)}% of frame): chroma-key removed pixels inside the subject`);

  return {
    ok: issues.length === 0,
    issues,
    transparencyPct: Math.round(transRatio * 100),
    coveragePct: Math.round(coverage * 100),
    holePct: Number(holePct.toFixed(2)),
  };
}
