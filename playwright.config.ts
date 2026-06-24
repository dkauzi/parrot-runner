import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the BUILT single-file playable (dist/index.html) headlessly. Run `npm run build:playable`
 * first. Mobile viewport by default, because a playable is mobile-first.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // Serial: each test runs a full WebGL game, and software-GL (swiftshader) in CI does not handle
  // several live WebGL contexts at once - parallel workers starve each other and time out.
  fullyParallel: false,
  workers: 1,
  // The rigged 3D parrot renders far slower under software-GL (CI) than on a real GPU, so give each
  // test generous headroom; the loop is verified by the game's own frame counter, not wall-clock FPS.
  timeout: 90000,
  // JSON results feed the dashboard's "Game tests" panel; list reporter for the console.
  reporter: [['list'], ['json', { outputFile: 'pipeline/agentic/out/e2e-results.json' }]],
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
