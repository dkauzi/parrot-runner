#!/usr/bin/env node
/**
 * Playable-build validation gate (Layer 1: automated self-check).
 *
 * Checks a built `dist/` against the load-bearing rules of standard playable-ad architecture,
 * so you catch violations before a network validator (Luna / Google / ironSource) rejects them.
 * Zero dependencies. This is NOT a substitute for the network validators (Layer 2) or device
 * QA (Layer 3); it is the fast pre-flight that makes those pass on the first try.
 *
 * Checks:
 *   1. Single HTML entry        (playables ship as one self-contained file)
 *   2. Total size under cap      (network limit, default 5 MB)
 *   3. No external URLs           (must be self-contained: no http(s):// or //cdn refs)
 *   4. MRAID + CTA hooks present  (mraid.js referenced, mraid.open used for the CTA)  [warn]
 *
 * Usage:  node pipeline/validate-build.mjs <dist-dir>
 * Exit:   0 = pass, 1 = a hard rule failed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MAX_TOTAL_BYTES = 5 * 1024 * 1024;          // 5 MB hard cap (tune per network)
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg']);
// Flag external resource LOADS (src=/href=/css url()), not every URL-shaped string. String
// literals like XML namespaces, library console messages, or the CTA store URL are not loads
// and must not trip the gate, or it cries wolf and gets ignored.
const EXT_RESOURCE = /(?:\bsrc|\bhref)\s*=\s*["']https?:\/\/[^"']+/gi;
const CSS_EXT_URL = /url\(\s*["']?https?:\/\/[^)"']+/gi;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else acc.push({ path: p, size: s.size });
  }
  return acc;
}

const dist = process.argv[2] || 'dist';
let hardFails = 0;
let warns = 0;

let files;
try {
  files = walk(dist);
} catch {
  console.error(`Cannot read build dir "${dist}". Run \`vite build\` first.`);
  process.exit(1);
}

// 1. Single HTML entry
const htmls = files.filter((f) => ['.html', '.htm'].includes(extname(f.path).toLowerCase()));
if (htmls.length === 1) {
  console.log(`PASS  single HTML entry (${htmls[0].path})`);
} else {
  hardFails++;
  console.log(`FAIL  expected 1 HTML entry, found ${htmls.length} (playables ship as one file)`);
}

// 2. Total size
const total = files.reduce((n, f) => n + f.size, 0);
const mb = (total / 1024 / 1024).toFixed(2);
if (total <= MAX_TOTAL_BYTES) {
  console.log(`PASS  total build size ${mb} MB <= 5 MB`);
} else {
  hardFails++;
  console.log(`FAIL  total build size ${mb} MB > 5 MB cap`);
}

// 3. No external URLs (self-contained)
let hasMraidRef = false;
let hasCtaOpen = false;
const offenders = [];
for (const f of files) {
  if (!TEXT_EXT.has(extname(f.path).toLowerCase())) continue;
  const text = readFileSync(f.path, 'utf8');
  if (/mraid\.js|window\.mraid|mraid\??\.open/.test(text)) hasMraidRef = true;
  if (/mraid\??\.open\s*\(/.test(text)) hasCtaOpen = true; // tolerate minified optional-chaining
  const ext = [...text.matchAll(EXT_RESOURCE), ...text.matchAll(CSS_EXT_URL)].map((m) => m[0]);
  if (ext.length) offenders.push({ file: f.path, urls: [...new Set(ext)].slice(0, 5) });
}
if (offenders.length === 0) {
  console.log('PASS  no external URLs (self-contained)');
} else {
  hardFails++;
  console.log('FAIL  external URLs found (playable must be self-contained):');
  for (const o of offenders) console.log(`        ${o.file}: ${o.urls.join(', ')}`);
}

// 4. MRAID + CTA hooks (warn only: optional for the take-home, required for production)
if (hasMraidRef && hasCtaOpen) {
  console.log('PASS  MRAID + mraid.open CTA present');
} else {
  warns++;
  console.log(`WARN  MRAID hooks missing (mraid.js: ${hasMraidRef}, mraid.open: ${hasCtaOpen}) `
    + '- required for a production playable, optional for this assignment');
}

console.log(`\n${hardFails} hard failure(s), ${warns} warning(s).`);
process.exit(hardFails > 0 ? 1 : 0);
