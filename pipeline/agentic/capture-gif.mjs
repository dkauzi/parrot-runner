#!/usr/bin/env node
/**
 * Capture an animated GIF of the built game playing, for the dashboard.
 *
 * Launches the real playable, starts a run, grabs a series of frames, and encodes them into a small
 * looping GIF (committed to pipeline/agentic/game.gif so the published dashboard can embed it). A
 * moving picture of the end product beats a static screenshot.
 *
 * Run:  node pipeline/agentic/capture-gif.mjs   (needs the built dist/)
 */

import { chromium } from '@playwright/test';
import { Jimp } from 'jimp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const W = 340;
const H = 191;
const FRAMES = 18;
const DELAY = 80; // ms per frame

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('file://' + join(ROOT, 'dist', 'index.html'), { waitUntil: 'load' });
await page.click('#start-btn').catch(() => {}); // begin a run (user gesture)
await page.waitForTimeout(400);

const gif = GIFEncoder();
for (let i = 0; i < FRAMES; i++) {
  const png = await page.screenshot();
  const img = await Jimp.read(png);
  img.resize({ w: W, h: H });
  const rgba = new Uint8Array(img.bitmap.data);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, W, H, { palette, delay: DELAY });
  await page.waitForTimeout(DELAY);
}
gif.finish();
await browser.close();

writeFileSync(join(HERE, 'game.gif'), Buffer.from(gif.bytes()));
console.log(`GIF written: pipeline/agentic/game.gif (${FRAMES} frames, ${W}x${H})`);
