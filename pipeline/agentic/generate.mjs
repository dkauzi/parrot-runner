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
import { Jimp } from 'jimp';

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
 * FREE real image generation via Pollinations.ai — no API key, no cost.
 *
 * Plain-language: this asks a free online image AI for the artwork. Sprites need a transparent
 * background, and free image models don't produce transparency, so we use an old trick: ask for
 * the subject on a solid magenta background, then delete every magenta pixel here (a "chroma
 * key", like a weather-presenter green screen). The result is a transparent sprite — for free.
 */
export async function pollinationsGenerate(asset, prompt, attempt) {
  const full =
    `${prompt}\nA single ${asset}, centered, isolated on a solid flat magenta #FF00FF ` +
    `background, no shadow, flat game-sprite style.`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}` +
    `?width=512&height=512&nologo=true&model=flux&seed=${attempt}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`pollinations request failed: ${res.status}`);
  const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));

  // Chroma-key: turn magenta pixels transparent.
  const d = img.bitmap.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] > 150) d[i + 3] = 0;
  }
  img.autocrop(); // trim the now-transparent border
  img.contain({ w: SIZE, h: SIZE }); // square, keep aspect, transparent padding
  return { buffer: await img.getBuffer('image/png'), provider: 'pollinations' };
}

/**
 * Adapter selector. 'mock' (offline, free) and 'pollinations' (free, real AI, needs internet).
 * A paid image API drops in the same way — provider selection is a config/env change, not a
 * rewrite. Set IMAGE_PROVIDER=pollinations to generate real art.
 */
export function getImageProvider(name) {
  if (name === 'mock') return mockGenerate;
  if (name === 'pollinations') return pollinationsGenerate;
  throw new Error(`Unknown image provider "${name}". Wire it up in generate.mjs.`);
}
