import { defineConfig } from '@playwright/test';

/**
 * Separate Playwright config for the AI canvas-interaction eval harness.
 *
 *  - testDir   tests/ai-eval/scenarios
 *  - timeout   5 min per test (real Ollama inference, possibly multi-step)
 *  - workers   1 (serial; Ollama is single-GPU and Electron tests can't parallelize)
 *  - reporter  list to terminal + html for browsable run + JSON for aggregation
 *
 * Run with:
 *   npx playwright test --config playwright.ai-eval.config.ts
 *
 * Model selection via env:
 *   PARALLX_AI_EVAL_MODEL=gemma4:26b   (default)
 *   PARALLX_AI_EVAL_MODEL=gpt-oss:20b
 *
 * Workspace root (per-scenario subfolders are created under this):
 *   PARALLX_AI_EVAL_WORKSPACE_ROOT='D:\Documents\Parallx Workspaces\Testing'
 */
export default defineConfig({
  testDir: './tests/ai-eval/scenarios',
  timeout: 5 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/ai-eval-html' }],
    ['json', { outputFile: 'test-results/ai-eval/playwright-results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
