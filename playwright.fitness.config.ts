import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the M84 / SR-4 system fitness harness.
 *
 * Sequential, single worker, generous timeouts, no retries (a flaky baseline
 * is meaningless). Reporter is `line` only — the structured output is the
 * per-module JSON files written by `tests/fitness/_shared/reportWriter.ts`.
 *
 * Invoked through `scripts/run-fitness.mjs` (the composer), which sets
 * `PARALLX_FITNESS_OUT` to a tmp directory before launching playwright.
 */
export default defineConfig({
  testDir: './tests/fitness',
  testMatch: /.*\.fitness\.ts$/,
  timeout: 240_000,
  retries: 0,
  workers: 1,
  reporter: [['line']],
  use: {
    trace: 'off',
  },
});
