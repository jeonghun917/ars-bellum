import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // A local Chromium can be named with PW_CHROMIUM_PATH; CI uses the one `playwright install` puts in place.
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  projects: [
    // The 3D battle needs WebGL, which a runner without a GPU only has through SwiftShader.
    {
      name: 'webgl',
      testMatch: '**/m2-*.spec.mjs',
      use: {
        launchOptions: {
          executablePath: process.env.PW_CHROMIUM_PATH || undefined,
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
    // Everything else draws with a 2D canvas. Under SwiftShader its frames stall for seconds at a time
    // (measured: about 7 frames a second in a 2D fight, 59 without it), which slows the battle clock.
    { name: 'default', testIgnore: '**/m2-*.spec.mjs' },
  ],
  webServer: {
    command: `node tests/support/static-server.mjs .`,
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: false,
    env: { PORT: String(port) },
  },
});
