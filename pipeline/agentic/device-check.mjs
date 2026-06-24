#!/usr/bin/env node
/**
 * Device-size QA for the playable. A playable ad must render on whatever placement it lands in -
 * tall phones, short landscape, tablets. This loads the BUILT single-file game at common device
 * viewports and checks deterministically that: the WebGL canvas fills the viewport (no letterboxing
 * or stretch), the start button is reachable, the perspective aspect matches the canvas, and nothing
 * overflows horizontally. Captures a portrait + landscape screenshot for the dashboard.
 *
 * Run:  node pipeline/agentic/device-check.mjs   (needs the built dist/)
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const URL = 'file://' + join(ROOT, 'dist', 'index.html');

// Common playable-ad placements (CSS px).
const DEVICES = [
  { label: 'iPhone SE (portrait)', w: 375, h: 667, shot: true },
  { label: 'iPhone 14 (portrait)', w: 390, h: 844 },
  { label: 'Pixel 7 (portrait)', w: 412, h: 915 },
  { label: 'iPhone 14 (landscape)', w: 844, h: 390, shot: true },
  { label: 'iPad (portrait)', w: 768, h: 1024 },
  { label: 'Small landscape', w: 568, h: 320 },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const results = [];
const shots = {};
for (const dev of DEVICES) {
  const page = await browser.newPage({ viewport: { width: dev.w, height: dev.h } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
    const start = document.querySelector('#start-btn');
    const sr = start ? start.getBoundingClientRect() : null;
    const v = window.__view || {};
    return {
      cw: Math.round(r.width),
      ch: Math.round(r.height),
      iw: window.innerWidth,
      ih: window.innerHeight,
      startVisible: !!sr && sr.width > 0 && sr.bottom <= window.innerHeight + 1 && sr.top >= -1,
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      aspectMatch: v.aspect ? Math.abs(v.aspect - v.canvasAspect) < 0.02 : false,
    };
  });
  // canvas should fill the viewport within a 2px tolerance
  const canvasFills = Math.abs(m.cw - m.iw) <= 2 && Math.abs(m.ch - m.ih) <= 2;
  const noOverflow = m.docOverflow <= 1;
  const ok = canvasFills && m.startVisible && noOverflow && m.aspectMatch;
  results.push({ label: dev.label, w: dev.w, h: dev.h, canvasFills, startVisible: m.startVisible, noOverflow, aspectMatch: m.aspectMatch, ok });
  if (dev.shot) shots[dev.w > dev.h ? 'landscape' : 'portrait'] = (await page.screenshot()).toString('base64');
  await page.close();
}
await browser.close();

const report = { devices: results, passed: results.filter((r) => r.ok).length, total: results.length, shots, at: new Date().toISOString() };
writeFileSync(join(OUT, 'device-check.json'), JSON.stringify(report, null, 2));
console.log(`Device check: ${report.passed}/${report.total} viewports OK`);
for (const r of results) if (!r.ok) console.log(`  FAIL ${r.label}:`, JSON.stringify(r));
process.exit(report.passed === report.total ? 0 : 1);
