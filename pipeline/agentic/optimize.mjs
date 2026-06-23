#!/usr/bin/env node
/**
 * Sprite optimizer — the bridge from "raw AI art" to "game-ready sprite".
 *
 * Plain-language: image models (DALL-E, Midjourney, gpt-image, etc.) output large images
 * (often 1024px, sometimes opaque, sometimes with messy margins). The game needs small, square,
 * transparent sprites that pass our asset gate. This takes whatever art you drop in `assets/raw/`
 * and produces a clean 256x256 transparent PNG in `assets/sprites/` that the game auto-loads.
 *
 * This is how the brief's "AI-generated collectible + tree" requirement is met end to end:
 *   1. Generate art from the versioned prompts in prompts/ (any image tool).
 *   2. Save as assets/raw/parrot.png, assets/raw/fruit.png, assets/raw/tree.png.
 *   3. `npm run pipeline:optimize`  ->  game-ready sprites, gated automatically.
 *
 * Run: npm run pipeline:optimize
 */

import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import { validateBuffer } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const RAW = join(ROOT, 'assets', 'raw');
const OUT = join(ROOT, 'assets', 'sprites');
const SIZE = 256;

async function optimizeOne(file) {
  const img = await Jimp.read(join(RAW, file));
  img.autocrop(); // trim flat/transparent margins so the subject fills the frame
  img.contain({ w: SIZE, h: SIZE }); // fit into a square, keep aspect, transparent padding
  const buffer = await img.getBuffer('image/png');
  const name = basename(file, extname(file)) + '.png';
  const problems = validateBuffer(buffer);
  if (problems.length) return { name, ok: false, problems };
  writeFileSync(join(OUT, name), buffer);
  return { name, ok: true, bytes: buffer.length };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let files;
  try {
    files = readdirSync(RAW).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  } catch {
    console.error(`No assets/raw/ folder. Create it and drop AI art (parrot.png, fruit.png, tree.png).`);
    process.exit(1);
  }
  if (!files.length) {
    console.log('No images in assets/raw/. Drop AI-generated art there (named parrot.*, fruit.*, tree.*).');
    process.exit(0);
  }

  let failed = 0;
  for (const f of files) {
    const r = await optimizeOne(f);
    if (r.ok) {
      console.log(`OK    ${f} -> assets/sprites/${r.name}  (${(r.bytes / 1024).toFixed(0)}KB, ${SIZE}x${SIZE})`);
    } else {
      failed++;
      console.log(`FAIL  ${f}: ${r.problems.join('; ')}`);
    }
  }
  console.log(`\n${files.length - failed}/${files.length} optimized into assets/sprites/. The game auto-loads them.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
