/**
 * Electron launch helper for M84 fitness modules.
 *
 * Thin wrapper around `@playwright/test`'s `_electron.launch()` that
 * mirrors the configuration used by `tests/e2e/fixtures.ts`. The wrapper
 * exists so fitness modules do not depend on test fixtures (which carry
 * test-runner state) and so the launch path is single-sourced for
 * baseline comparisons.
 *
 * Anti-list: this file does NOT modify `electron/main.cjs` or
 * `electron/preload.cjs`. It only invokes the same launch command an
 * end-user would.
 */

import { _electron as electron, type ElectronApplication } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export const ELECTRON_CLOSE_TIMEOUT = 10_000;

/** Create a temporary workspace folder with a small set of sample files. */
export async function createFitnessWorkspace(): Promise<string> {
  const dir = path.join(os.tmpdir(), `parallx-fitness-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), '# Fitness Workspace\n');
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'console.log("fitness");\n');
  await fs.writeFile(path.join(dir, 'docs', 'guide.md'), '# Guide\n');
  return dir;
}

/** Recursively remove a fitness workspace. */
export async function cleanupFitnessWorkspace(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

/**
 * Launch the Electron app in fitness mode and return the ElectronApplication.
 *
 * Mirrors `tests/e2e/fixtures.ts` `electron.launch()` call shape but adds
 * `PARALLX_FITNESS=1` so the runtime can short-circuit anything that is
 * not needed for fitness measurement (currently a no-op flag reserved for
 * future use by the runtime; presence is documented for forward compat).
 */
export async function launchForFitness(): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PARALLX_TEST_MODE: '1',
      PARALLX_FITNESS: '1',
      PARALLX_RENDERER_PORT: '0',
    },
  });
  return app;
}

/** Close an Electron app launched via `launchForFitness`. */
export async function closeFitnessApp(app: ElectronApplication): Promise<void> {
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, ELECTRON_CLOSE_TIMEOUT)),
    ]);
  } catch { /* best effort */ }
}
