import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npm --prefix frontend run build && go run . -open=false',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
