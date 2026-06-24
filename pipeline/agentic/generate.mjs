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
  // "scene" assets (the jungle background) are full opaque images — no chroma-key, landscape,
  // saved as compact JPEG. This is the AI-vs-deterministic split in action: the BACKGROUND is a
  // creative/judgment task (great for AI), while the game logic stays plain code.
  if (asset === 'background') return pollinationsScene(prompt, attempt);

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

  // ADAPTIVE chroma-key: sample the 4 corners to learn the ACTUAL background colour the image
  // model produced (it rarely hits pure #FF00FF), then key out everything close to it. This is far
  // more robust than a fixed magenta threshold — it handles pink/magenta/white/grey backgrounds.
  const d = img.bitmap.data;
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + (W - 1)) * 4];
  let br = 0;
  let bg = 0;
  let bb = 0;
  for (const c of corners) {
    br += d[c];
    bg += d[c + 1];
    bb += d[c + 2];
  }
  br /= 4;
  bg /= 4;
  bb /= 4;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
    if (dist < 70) {
      d[i + 3] = 0; // background
    } else if (dist < 130) {
      d[i + 3] = Math.round(d[i + 3] * ((dist - 70) / 60)); // soft edge
    }
  }
  img.autocrop(); // trim the now-transparent border
  img.contain({ w: SIZE, h: SIZE }); // square, keep aspect, transparent padding
  const buffer = await img.getBuffer('image/png');
  const after = await thumb(img.clone()); // "after": the finished, transparent sprite
  return { buffer, provider: 'pollinations', preview: { before, after } };
}

/** Generate a full opaque scene image (background / ground texture), compact JPEG, landscape.
 *  Prompt-led so different scene assets (background vs ground) are driven by their prompt files. */
async function pollinationsScene(prompt, attempt) {
  const full = `${prompt}\nPolished vivid mobile-game art, rich detail and depth, no characters, no text, no UI.`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}` +
    `?width=1024&height=576&nologo=true&model=flux&seed=${attempt}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pollinations request failed: ${res.status}`);
  const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));
  img.cover({ w: 1024, h: 576 }); // exact 16:9, fill
  const preview = { before: await thumb(img.clone()), after: await thumb(img.clone()) };
  const buffer = await img.getBuffer('image/jpeg', { quality: 72 }); // small opaque backdrop
  return { buffer, provider: 'pollinations', preview };
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
