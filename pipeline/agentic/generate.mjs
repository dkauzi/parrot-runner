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
    `${prompt}\nA single ${asset}, centered, vivid saturated cartoon game sprite, bold clean ` +
    `outline, flat shading, die-cut sticker, no scenery, no text, no shadow, on a perfectly ` +
    `flat solid magenta #FF00FF background.`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}` +
    `?width=768&height=768&nologo=true&model=flux&seed=${attempt}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`pollinations request failed: ${res.status}`);
  const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));

  // "Before" thumbnail: the raw AI output, on its magenta background, prior to any processing.
  const before = await thumb(img.clone());

  // Soft chroma-key with edge despill: fully cut strong magenta, fade the fringe, and pull the
  // purple tint out of edge pixels so there's no halo — much cleaner than a hard threshold.
  const d = img.bitmap.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const magenta = Math.min(r, b) - g; // > 0 when magenta dominates green
    if (magenta > 80) {
      d[i + 3] = 0; // clearly background
    } else if (magenta > 25) {
      const t = (magenta - 25) / 55; // 0..1 across the fringe
      d[i + 3] = Math.round(d[i + 3] * (1 - t)); // fade out
      d[i] = Math.round(r - (r - g) * t * 0.8); // despill red
      d[i + 2] = Math.round(b - (b - g) * t * 0.8); // despill blue
    }
  }
  img.autocrop(); // trim the now-transparent border
  img.contain({ w: SIZE, h: SIZE }); // square, keep aspect, transparent padding
  const buffer = await img.getBuffer('image/png');
  const after = await thumb(img.clone()); // "after": the finished, transparent sprite
  return { buffer, provider: 'pollinations', preview: { before, after } };
}

/** A small data-URI PNG thumbnail for the dashboard's before/after view. */
async function thumb(img) {
  img.scaleToFit({ w: 110, h: 110 });
  return 'data:image/png;base64,' + (await img.getBuffer('image/png')).toString('base64');
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
