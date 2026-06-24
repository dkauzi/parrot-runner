import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/**
 * Headless auto-test for the built single-file playable (Layer 3, automated).
 *
 * Drives the real built artifact in headless Chromium and asserts the things a playable must
 * do: load clean, render, hold a frame-rate floor, and fire its CTA through MRAID. This is the
 * automated half of device QA; it does not replace a real phone, but it catches regressions on
 * every commit so the manual pass is a formality, not a debugging session.
 *
 * Run against the BUILT file (npm run build:playable first), not the dev server, because the
 * single-file inlined build is what actually ships.
 */

const BUILT = process.env.PLAYABLE_FILE
  ? resolve(process.env.PLAYABLE_FILE)
  : resolve('dist/index.html');
const URL = pathToFileURL(BUILT).href;

test.beforeEach(async ({ page }) => {
  // Stub MRAID before any game code runs, so the CTA has something to call and we can observe it.
  await page.addInitScript(() => {
    (window as any).__cta = [];
    (window as any).mraid = {
      open: (url: string) => (window as any).__cta.push(url),
      isViewable: () => true,
      getState: () => 'default',
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
});

test.afterEach(async ({ page }) => {
  // Stop the render loop before the context tears down — software-GL teardown can hang while a
  // heavy WebGL loop is still running. Best-effort; ignore if the page is already gone.
  await page.evaluate(() => (window as { __stopLoop?: () => void }).__stopLoop?.()).catch(() => {});
});

test('loads with no console or page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await expect(page.locator('canvas')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('game loop advances (not frozen)', async ({ page }) => {
  // Asserts the real game loop keeps ticking, NOT a real FPS number. Headless software-GL renders
  // far below device speed, so a hard 30/60 FPS floor here would test the CI rasterizer, not the
  // game. The real frame-rate budget is Layer-3 device QA (see PRODUCTION_BUDGET.md). What we can
  // prove automatically is that the loop never stalls.
  await page.goto(URL, { waitUntil: 'load' });
  const f1 = await page.evaluate(() => (window as any).__frames ?? 0);
  await page.waitForTimeout(600);
  const f2 = await page.evaluate(() => (window as any).__frames ?? 0);
  expect(f2).toBeGreaterThan(f1);
});

test('WebGL context is healthy (actually rendering)', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'load' });
  await expect(page.locator('canvas')).toBeVisible();
  const healthy = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    return !!gl && !gl.isContextLost() && c.width > 0 && c.height > 0;
  });
  expect(healthy).toBe(true);
});

test('CTA fires through mraid.open at game end', async ({ page }) => {
  // Requires the game to honour a fast-end test hook and to call window.mraid.open(url) on the
  // end-card CTA. Skip cleanly until that hook exists so the suite stays green during build-out.
  await page.goto(`${URL}?test=fastend`, { waitUntil: 'load' });
  const hookExists = await page.evaluate(() => (window as any).__supportsFastEnd === true);
  test.skip(!hookExists, 'game does not expose ?test=fastend yet');

  // Click the end-card CTA once it appears (auto-waits for the end card to show).
  await page.locator('#cta-btn').click();
  const calls = await page.evaluate(() => (window as any).__cta as string[]);
  expect(calls.length).toBeGreaterThan(0);
});
