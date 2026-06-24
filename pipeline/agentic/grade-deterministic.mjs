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
 * It runs BEFORE the AI judge (cheap, deterministic gate) and is also the FALLBACK verdict when the
 * AI judge is unavailable/rate-limited - so we degrade to deterministic, never to "guess".
 */

import { Jimp } from 'jimp';

export async function gradeSprite(buffer) {
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

  const issues = [];
  if (transRatio < 0.15) issues.push('background is not transparent (opaque box behind the sprite)');
  if (coverage < 0.04) issues.push('sprite is almost empty');
  if (coverage > 0.92) issues.push('subject fills the whole frame (no clean cutout)');
  if (Math.abs(cx - 0.5) > 0.32 || Math.abs(cy - 0.5) > 0.36) issues.push('subject is off-centre');

  return {
    ok: issues.length === 0,
    issues,
    transparencyPct: Math.round(transRatio * 100),
    coveragePct: Math.round(coverage * 100),
  };
}
