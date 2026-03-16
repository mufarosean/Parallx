import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { openChatPanel, openFolderViaMenu, waitForRagReady } from './ai-eval-fixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const TARGET_FOLDER = process.env.PARALLX_BOOTSTRAP_DIAG_FOLDER
  || 'C:\\Users\\mchit\\OneDrive\\Documents\\Archive\\School\\Top Scholar';

async function exists(targetPath: string): Promise<boolean> {
  return !!(await fs.stat(targetPath).catch(() => null));
}

async function waitForWorkspaceArtifacts(folderPath: string, timeoutMs: number): Promise<{
  parallxDir: boolean;
  identity: boolean;
  dataDb: boolean;
}> {
  const start = Date.now();
  const parallxDirPath = path.join(folderPath, '.parallx');
  const identityPath = path.join(parallxDirPath, 'workspace-identity.json');
  const dataDbPath = path.join(parallxDirPath, 'data.db');

  while (Date.now() - start < timeoutMs) {
    const state = {
      parallxDir: await exists(parallxDirPath),
      identity: await exists(identityPath),
      dataDb: await exists(dataDbPath),
    };
    if (state.parallxDir && state.identity && state.dataDb) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return {
    parallxDir: await exists(parallxDirPath),
    identity: await exists(identityPath),
    dataDb: await exists(dataDbPath),
  };
}

test.describe.serial('Workspace bootstrap diagnostic', () => {
  test('creates workspace artifacts and reaches RAG readiness on first open', async () => {
    const folderStat = await fs.stat(TARGET_FOLDER).catch(() => null);
    expect(folderStat?.isDirectory()).toBe(true);

    const parallxDirPath = path.join(TARGET_FOLDER, '.parallx');
    const identityPath = path.join(parallxDirPath, 'workspace-identity.json');
    const dataDbPath = path.join(parallxDirPath, 'data.db');

    const before = {
      parallxDir: await exists(parallxDirPath),
      identity: await exists(identityPath),
      dataDb: await exists(dataDbPath),
    };

    console.log(`[BootstrapDiag] Before open: ${JSON.stringify(before)}`);

    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PARALLX_TEST_MODE: '1',
        PARALLX_RENDERER_PORT: '0',
      },
    });

    try {
      const page = await app.firstWindow();
      await openFolderViaMenu(app, page, TARGET_FOLDER);

      const after = await waitForWorkspaceArtifacts(TARGET_FOLDER, 120_000);
      console.log(`[BootstrapDiag] After open: ${JSON.stringify(after)}`);

      expect(after.parallxDir).toBe(true);
      expect(after.identity).toBe(true);
      expect(after.dataDb).toBe(true);

      await openChatPanel(page);
      await waitForRagReady(page, 120_000);
    } finally {
      await app.close().catch(() => {});
    }
  });
});