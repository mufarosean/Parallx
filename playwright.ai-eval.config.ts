/**
 * Playwright config for AI Quality Evaluation tests.
 *
 * Separate from the main playwright.config.ts because:
 *   - Requires a running Ollama instance (real LLM inference)
 *   - Much longer timeouts (2–3 minutes per test for model inference)
 *   - Single worker only (shared Electron instance)
 *   - Produces a quality score report, not just pass/fail
 *
 * Run:
 *   npx playwright test --config=playwright.ai-eval.config.ts
 *   npm run test:ai-eval
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ai-eval',
  timeout: 480_000,          // 8 minutes per test (T11/T12 need file change + re-index + inference)
  retries: 0,                // No retries — we want to see actual quality
  workers: 1,                // Serial execution, one shared Electron app
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
});
