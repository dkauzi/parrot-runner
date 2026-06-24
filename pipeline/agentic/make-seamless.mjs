#!/usr/bin/env node
/**
 * Make the AI ground texture TRULY seamless (no mirror, no kaleidoscope).
 * Offset-and-blend: shift the image by half a tile with wrap-around so the original border-seams
 * move to the centre, then feather-heal the resulting centre cross with a local blur. The new
 * borders are now continuous, so the texture tiles with zero visible seam.
 *
 * Deterministic image processing - no AI. Keeps the raw AI output as ground.raw.jpg for the
 * before/after gallery. Run:  node pipeline/agentic/make-seamless.mjs
 */
import { Jimp } from 'jimp';
import { copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets', 'ground.jpg');
const RAW = join(ROOT, 'assets', 'ground.raw.jpg');

copyFileSync(SRC, RAW); // preserve the raw AI output (before/after provenance)
const src = await Jimp.read(SRC);
const W = src.bitmap.width;
const H = src.bitmap.height;
const hw = W >> 1;
const hh = H >> 1;
const s = src.bitmap.data;

// 1. offset by half a tile (wrap) -> borders become continuous, seams collapse to a centre cross
const out = src.clone();
const o = out.bitmap.data;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = (x + hw) % W;
    const sy = (y + hh) % H;
    const di = (y * W + x) * 4;
    const si = (sy * W + sx) * 4;
    o[di] = s[si];
    o[di + 1] = s[si + 1];
    o[di + 2] = s[si + 2];
    o[di + 3] = s[si + 3];
  }
}

// 2. feather-heal the centre cross with a local blur (1 at the seam -> 0 at band edge)
const blur = out.clone().blur(9);
const b = blur.bitmap.data;
const band = Math.round(W * 0.1);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.min(Math.abs(x - hw), Math.abs(y - hh)); // distance to nearest cross line
    if (d >= band) continue;
    const w = 1 - d / band;
    const di = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) o[di + c] = Math.round(o[di + c] * (1 - w) + b[di + c] * w);
  }
}

await out.write(SRC);
console.log(`Seamless ground written: assets/ground.jpg (${W}x${H}); raw kept as ground.raw.jpg`);
