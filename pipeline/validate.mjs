#!/usr/bin/env node
/**
 * Asset validation gate (the deterministic half of generate -> validate -> grade).
 *
 * This is the "schema validation before downstream systems" principle applied honestly to a
 * game: an AI-generated sprite must clear hard, machine-checkable rules before it is allowed
 * into the build. Fail loud here, at the gate, not at runtime in front of a player.
 *
 * Deliberately ZERO dependencies. PNG dimensions and channel layout are read straight from
 * the IHDR header, so this runs in CI with nothing installed. It is the right size for three
 * assets; it is NOT an agent framework, and a three-asset job does not need one.
 *
 * Usage:  node pipeline/validate.mjs <assets-dir>
 * Exit:   0 = all pass, 1 = at least one failure (use as a CI / pre-commit gate).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// --- Budget (keep in sync with PRODUCTION_BUDGET.md) ---
const MAX_BYTES = 150 * 1024;   // < 150 KB per sprite after compression
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read width, height, and whether the PNG carries an alpha channel, from the IHDR chunk. */
function readPngHeader(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return null; // not a PNG
  // IHDR starts at byte 16: width(4), height(4), bitDepth(1), colorType(1)
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  // colorType 6 = truecolor + alpha, 4 = grayscale + alpha -> has a transparency channel
  const hasAlpha = colorType === 6 || colorType === 4;
  return { width, height, hasAlpha };
}

function validate(file) {
  const fails = [];
  const bytes = statSync(file).size;
  if (bytes > MAX_BYTES) fails.push(`size ${(bytes / 1024).toFixed(0)} KB > 150 KB budget`);

  const header = readPngHeader(readFileSync(file));
  if (!header) {
    fails.push('not a valid PNG');
    return fails;
  }
  if (!header.hasAlpha) fails.push('no alpha channel (sprite must have transparency)');
  if (header.width !== header.height) {
    fails.push(`not square (${header.width}x${header.height})`);
  }
  return fails;
}

const dir = process.argv[2] || 'src/assets';
let failed = 0;
const pngs = readdirSync(dir).filter((f) => extname(f).toLowerCase() === '.png');

if (pngs.length === 0) {
  // Procedural placeholders are valid during build-out; there is simply nothing to gate yet.
  console.log(`No PNG sprites in ${dir} yet (using procedural placeholders). `
    + `Drop AI-generated PNGs here to gate them.`);
  process.exit(0);
}

for (const name of pngs) {
  const problems = validate(join(dir, name));
  if (problems.length === 0) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`);
    for (const p of problems) console.log(`        - ${p}`);
  }
}

console.log(`\n${pngs.length - failed}/${pngs.length} assets passed.`);
process.exit(failed > 0 ? 1 : 0);
