import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a synthetic backend: the analysis service's mock
 * broker plus scripts/dev_worker.py (see scripts/dev-stack.sh). The Vite dev
 * server is started here on its own port so a developer's 5173 instance is
 * untouched. Set E2E_BROWSER_CHANNEL=chrome to use an installed Chrome instead
 * of Playwright's Chromium.
 */
const WS_PORT = Number(process.env.E2E_WS_PORT ?? 9927);
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}/rubintv/ddv/`,
    channel: process.env.E2E_BROWSER_CHANNEL,
    viewport: { width: 1500, height: 950 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
    url: `http://127.0.0.1:${APP_PORT}/rubintv/ddv/`,
    reuseExistingServer: true,
    env: { VITE_DDV_WS_PATH: 'ws', VITE_DDV_WS_PORT: String(WS_PORT) },
    timeout: 60_000,
  },
});
