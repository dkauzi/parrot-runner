/**
 * Image generation provider (the "Agent A" that produces a sprite).
 *
 * Plain-language: this is the part that creates the artwork. It is built as a swappable adapter
 * so the rest of the pipeline never cares HOW the image was made:
 *   - `mockGenerate` (default) draws a real, valid sprite locally — no API key, no internet, free.
 *     It lets the whole pipeline run end-to-end for anyone, today.
 *   - A real provider (e.g. an image model API) drops in here later behind the same function
 *     signature; nothing downstream changes. That is the "swap a provider, not the system" design.
 */

import { encodePngRGBA } from './png.mjs';

const SIZE = 256;

/** Stable little hash so each prompt yields a consistent, distinct placeholder. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Produce a sprite PNG buffer for an asset from its prompt.
 * @returns {Promise<{ buffer: Buffer, provider: string }>}
 */
export async function mockGenerate(asset, prompt, attempt) {
  const h = hash(`${asset}|${prompt}|${attempt}`);
  const r = h & 0xff;
  const g = (h >> 8) & 0xff;
  const b = (h >> 16) & 0xff;

  const rgba = Buffer.alloc(SIZE * SIZE * 4); // fully transparent to start
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rad = SIZE * 0.42;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rad * rad) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  }
  return { buffer: encodePngRGBA(SIZE, SIZE, rgba), provider: 'mock' };
}

/**
 * Adapter selector. Today only 'mock' exists; a real image API would register here and be chosen
 * by config — model/provider selection is a config change, not a code change.
 */
export function getImageProvider(name) {
  if (name === 'mock') return mockGenerate;
  throw new Error(`Unknown image provider "${name}". Wire it up in generate.mjs.`);
}
