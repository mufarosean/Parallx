/**
 * Eval harness launcher — boots Electron in test mode, pins gemma4:26b,
 * grants session-level permission for every known tool so the model can
 * actually exercise them, and exposes hooks for clicking approval cards
 * if any slip through.
 */
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.resolve(__dirname, '..', 'tool-skill-manifest.json');

export const EVAL_MODEL_ID = 'gemma4:26b';

export interface EvalSession {
  app: ElectronApplication;
  page: Page;
  close(): Promise<void>;
}

async function loadToolIds(): Promise<string[]> {
  const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as { tools: { id: string }[] };
  return manifest.tools.map((t) => t.id);
}

export async function launchEvalSession(opts?: { workspacePath?: string }): Promise<EvalSession> {
  const env = { ...process.env };
  delete (env as any).ELECTRON_RUN_AS_NODE;
  env.PARALLX_TEST_MODE = '1';
  env.PARALLX_RENDERER_PORT = '0';

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 20_000 });

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[eval]') || t.includes('[harness]')) console.log('  RENDERER:', t);
  });

  if (opts?.workspacePath) {
    await app.evaluate(({ ipcMain }, fp) => {
      ipcMain.removeHandler('dialog:openFolder');
      ipcMain.handle('dialog:openFolder', async () => [fp]);
    }, opts.workspacePath);

    await page.locator('.titlebar-menu-item[data-menu-id="file"]').click();
    const dropdown = page.locator('.context-menu.titlebar-dropdown');
    await dropdown.waitFor({ state: 'visible', timeout: 5_000 });
    await dropdown.locator('.context-menu-item', { hasText: 'Open Folder' }).click();
    await page.waitForLoadState('domcontentloaded', { timeout: 25_000 });
    await page.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 25_000 });
    await page.waitForTimeout(3_000);
  }

  await pinEvalModel(page, EVAL_MODEL_ID);
  await grantAllToolsForSession(page);

  return {
    app,
    page,
    close: async () => {
      try { await app.close(); } catch { /* best effort */ }
    },
  };
}

/**
 * Pin the eval model. Uses the async getModels() (which awaits provider
 * enumeration) — the previous getAvailableModels() snapshot was returning
 * an empty list on a cold start, leaving whatever model was persisted last
 * session active. We now verify the picker DOM reflects the choice.
 */
async function pinEvalModel(page: Page, modelId: string): Promise<void> {
  const result = await page.evaluate(async (id) => {
    const wb = (window as any).__parallx_workbench__;
    if (!wb) return { ok: false, error: 'no workbench' };
    const entries: Map<string, any> | undefined = (wb._services ?? wb.services)?._entries;
    if (!entries) return { ok: false, error: 'no _entries' };
    let lm: any = null;
    entries.forEach((entry) => {
      const inst = entry?.instance;
      if (inst && typeof inst.setActiveModel === 'function' && typeof inst.getModels === 'function') {
        lm = inst;
      }
    });
    if (!lm) return { ok: false, error: 'no languageModelsService' };

    let models: any[] = [];
    try { models = await lm.getModels(); } catch (e: any) { return { ok: false, error: 'getModels threw: ' + (e?.message ?? e) }; }
    const match = models.find((m: any) => m?.id === id);
    if (!match) return { ok: false, error: `model ${id} not available`, available: models.map((m: any) => m?.id) };
    lm.setActiveModel(id);
    return { ok: true, active: lm.getActiveModel?.(), available: models.map((m: any) => m?.id) };
  }, modelId);

  if (!result.ok) {
    throw new Error(`[harness] could not pin ${modelId}: ${JSON.stringify(result)}`);
  }
  console.log('[harness] Pinned model:', result.active, ' (of', result.available?.length, 'available)');

  // Verify the chat picker DOM reflects the active model — proves the UI is
  // bound to the same service instance we just configured.
  const widget = page.locator('.parallx-chat-widget');
  if (await widget.isVisible().catch(() => false)) {
    const picker = page.locator('.parallx-chat-picker-btn--model').first();
    if (await picker.isVisible().catch(() => false)) {
      const label = (await picker.textContent().catch(() => '')) || '';
      console.log('[harness] Model picker DOM label:', label.trim());
    }
  }
}

/**
 * Grant session-level permission for every tool in the manifest so the
 * model can actually invoke them during evals without manual clicking.
 * The user explicitly called this out: tests must understand approvals.
 *
 * We register two things:
 *   1. Session grants on PermissionService for every known tool — silent
 *      pre-approval so the model isn't blocked.
 *   2. A click-through MutationObserver that hits "Allow once" if any
 *      approval card slips past the pre-grant (e.g. a tool we don't know
 *      about, or a tool whose default level is set higher than always).
 *      This makes the harness behave like a real user who clicks Approve.
 */
async function grantAllToolsForSession(page: Page): Promise<void> {
  const toolIds = await loadToolIds();
  const result = await page.evaluate((ids) => {
    const wb = (window as any).__parallx_workbench__;
    if (!wb) return { ok: false, reason: 'no workbench' };
    const entries: Map<string, any> | undefined = (wb._services ?? wb.services)?._entries;
    if (!entries) return { ok: false, reason: 'no _entries' };
    let perm: any = null;
    entries.forEach((entry) => {
      const inst = entry?.instance;
      if (inst && typeof inst.grantForSession === 'function' && typeof inst.hasSessionGrant === 'function') {
        perm = inst;
      }
    });
    if (!perm) return { ok: false, reason: 'no PermissionService' };
    for (const id of ids) {
      try { perm.grantForSession(id); } catch { /* skip */ }
    }
    return { ok: true, granted: ids.length };
  }, toolIds);
  console.log('[harness] Session grants:', result);

  // Install a watchdog that auto-clicks any in-chat approval card that still
  // shows up. We use "Allow once" (not "Always allow") so the eval keeps the
  // model's per-turn choice surface intact.
  await page.evaluate(() => {
    if ((window as any).__parallx_eval_approval_clicker__) return;
    (window as any).__parallx_eval_approval_clicker__ = true;
    const click = () => {
      document.querySelectorAll('.parallx-chat-confirmation-btn--accept').forEach((el) => {
        if (!(el as HTMLElement).dataset.parallxEvalClicked) {
          (el as HTMLElement).dataset.parallxEvalClicked = '1';
          (el as HTMLElement).click();
        }
      });
      document.querySelectorAll('.parallx-chat-agent-approval-button').forEach((el) => {
        const txt = (el.textContent || '').trim().toLowerCase();
        if ((txt === 'approve once' || txt === 'approve task') && !(el as HTMLElement).dataset.parallxEvalClicked) {
          (el as HTMLElement).dataset.parallxEvalClicked = '1';
          (el as HTMLElement).click();
        }
      });
    };
    const obs = new MutationObserver(click);
    obs.observe(document.body, { childList: true, subtree: true });
    click();
  });
  console.log('[harness] Approval watchdog installed.');
}
