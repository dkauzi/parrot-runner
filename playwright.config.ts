import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the BUILT single-file playable (dist/index.html) headlessly. Run `npm run build:playable`
 * first. Mobile viewport by default, because a playable is mobile-first.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    headless: true,
    // Software GL so WebGL renders in CI, plus flags to stop headless from throttling the loop.
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }],
});
