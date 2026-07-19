// 92-boot-smoke.spec.ts — the app boots to a rendered workbench, cleanly.
//
// Grew out of a temporary boot debugger: instead of sleeping and dumping
// console output, this waits for the titlebar (the last chrome the workbench
// mounts) and FAILS on any uncaught renderer exception during boot.
// console.error lines are reported as warnings but don't fail the run —
// some are benign dev noise; uncaught pageerrors never are.
//
// Run notes (this repo): e2e needs `env -u ELECTRON_RUN_AS_NODE npx
// playwright test` when launched from a VS Code terminal — the extension
// host leaks ELECTRON_RUN_AS_NODE=1, which makes Electron boot as plain
// node ("Process failed to launch").

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname2, '..', '..');

test('boot smoke: workbench renders with no uncaught renderer errors', async () => {
  test.setTimeout(90_000);

  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT_ROOT,
    env: { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0' },
  });

  try {
    const page = await app.firstWindow();

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 500)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 500));
    });

    // The titlebar is part of the final chrome the workbench mounts —
    // waiting for it beats a fixed sleep on every machine speed.
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', {
      state: 'attached',
      timeout: 60_000,
    });

    // Give late Phase-5 activations a beat to surface async boot errors.
    await page.waitForTimeout(2_000);

    if (consoleErrors.length > 0) {
      console.warn(`[boot-smoke] ${consoleErrors.length} console.error line(s) during boot:`);
      for (const line of consoleErrors) console.warn(`  ${line}`);
    }

    expect(pageErrors, 'uncaught renderer exceptions during boot').toEqual([]);
  } finally {
    await app.close().catch(() => { /* window may already be gone */ });
  }
});
