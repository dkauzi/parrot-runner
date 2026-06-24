/**
 * Tiny PNG toolkit (zero dependencies).
 *
 * Plain-language: this file does two jobs.
 *   1. `encodePngRGBA` turns raw pixels into a real .png file in memory. The mock image
 *      "generator" uses it so the pipeline produces genuine, valid sprites with no internet,
 *      no API key, and no extra libraries — so anyone can run the whole thing for free.
 *   2. `validateBuffer` is the automatic quality gate: before a sprite is allowed through, it
 *      checks the file is a real PNG, is square, has transparency, and is under the size budget.
 *      Same rules as pipeline/validate.mjs, but checked on the in-memory image before it's saved.
 */

import { deflateSync, crc32 } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 150 * 1024;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode width x height RGBA bytes into a PNG (color type 6 = has transparency). */
export function encodePngRGBA(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per channel
  ihdr.writeUInt8(6, 9); // RGBA
  // bytes 10-12 (compression/filter/interlace) stay 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // per-scanline filter byte: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Quality gate for a "scene" asset (the opaque jungle background): JPEG/PNG, under budget.
 *  Backgrounds are full images, so the square/transparent sprite rules don't apply. */
export function validateScene(buf) {
  const fails = [];
  if (buf.length > 350 * 1024) fails.push(`size ${(buf.length / 1024).toFixed(0)}KB over 350KB`);
  if (buf.length < 4 * 1024) fails.push('suspiciously small / not a real image');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf.subarray(0, 8).equals(SIG);
  if (!isJpeg && !isPng) fails.push('not a JPEG or PNG');
  return fails;
}

/** Quality gate on an in-memory PNG. Returns a list of problems (empty = passed). */
export function validateBuffer(buf) {
  const fails = [];
  if (buf.length > MAX_BYTES) fails.push(`size ${(buf.length / 1024).toFixed(0)}KB over 150KB`);
  if (!buf.subarray(0, 8).equals(SIG)) {
    fails.push('not a valid PNG');
    return fails;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  if (colorType !== 6 && colorType !== 4) fails.push('no transparency channel');
  if (width !== height) fails.push(`not square (${width}x${height})`);
  return fails;
}
