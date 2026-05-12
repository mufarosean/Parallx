/**
 * Canvas helpers for AI eval scenarios.
 *
 * Drives the canvas via the same DOM affordances real users touch, plus the
 * `__tiptapEditor` window hook for reading the currently-open page's content
 * back as TipTap JSON. We intentionally do NOT poke the canvas SQLite db
 * directly: a regression in the UI layer is exactly what we want to catch.
 *
 * Block-id awareness: assertions about edits target paragraphs by their
 * canonical attrs.id. The canvas auto-assigns ids once `canvas.blockIds.enabled`
 * is on (M60 §6.3); in test workspaces it ships enabled by default.
 */
import type { ElectronApplication, Page } from '@playwright/test';

export interface SeedBlock {
  /** Stable block id (assigned via attrs.id). The AI is expected to discover
   *  these ids via read_page rather than guessing. */
  readonly id: string;
  readonly text: string;
}

export interface SeedPage {
  readonly title: string;
  readonly blocks: ReadonlyArray<SeedBlock>;
}

/**
 * The fixture pre-stages `data/last-workspace.json` and boots Parallx
 * directly into the test workspace, so by the time a scenario runs the
 * workbench is already on `.parallx-ready` with the right folder. This
 * helper just waits for the activity bar to be interactive, then returns.
 *
 * (The legacy menu-driven flow was the root cause of "wrong workspace"
 * bugs: triggering File→Open Folder reloads the page and races against
 * our recorder + test hooks.)
 */
export async function openWorkspaceFolder(
  _electronApp: ElectronApplication,
  page: Page,
  _folderPath: string,
): Promise<void> {
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('button.activity-bar-item', { timeout: 15_000 });
  // Small settle for tool activation (canvas registers its activity-bar
  // item during LifecyclePhase.Ready → onStartupFinished).
  await page.waitForFunction(
    () => !!document.querySelector('button.activity-bar-item[data-icon-id="canvas-container"]'),
    { timeout: 30_000 },
  );
}

/** Open the Canvas activity-bar tab if not already active. */
export async function openCanvasSidebar(page: Page): Promise<void> {
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  await canvasBtn.waitFor({ state: 'visible', timeout: 15_000 });
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForTimeout(400);
}

/** Create a brand-new canvas page via the sidebar + button. */
export async function createNewPage(page: Page, title: string): Promise<void> {
  const before = await page.locator('.canvas-node').count();
  await page.locator('.canvas-sidebar-add-btn').click();

  // The add button calls _createPage() directly — no context menu. It
  // creates the page in the DB, refreshes the tree, then auto-opens
  // the page-options popup focused on the title InputBox.
  await page.waitForFunction(
    (prev) => document.querySelectorAll('.canvas-node').length > prev,
    before,
    { timeout: 15_000 },
  );

  const titleInput = page.locator('.canvas-sidebar-page-menu__title-input');
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
  await titleInput.fill(title);
  await page.keyboard.press('Enter');
  // Popup closes on submit; wait for it to detach so we don't race the rename commit.
  await page.locator('.canvas-sidebar-page-menu').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  // Wait for the new node label to reflect the typed title (commit roundtrip).
  await page.locator('.canvas-node-label', { hasText: title }).first().waitFor({ state: 'visible', timeout: 10_000 });
}

/** Click a page row in the canvas sidebar by exact title. */
export async function openPageByTitle(page: Page, title: string): Promise<void> {
  // Click the label specifically rather than the row, to avoid hitting the
  // expand chevron or icon hit area.
  const label = page.locator('.canvas-node-label', { hasText: title }).first();
  await label.waitFor({ state: 'visible', timeout: 10_000 });
  await label.click();
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
  // Brief settle so subsequent setContent runs against the right editor instance.
  await page.waitForTimeout(300);
}

/** Replace the currently-open page's content with the given blocks. */
export async function setPageBlocks(page: Page, blocks: ReadonlyArray<SeedBlock>): Promise<void> {
  await page.evaluate((bs) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No TipTap editor');
    const doc = {
      type: 'doc',
      content: bs.map((b) => ({
        type: 'paragraph',
        attrs: { id: b.id },
        content: b.text ? [{ type: 'text', text: b.text }] : [],
      })),
    };
    editor.commands.setContent(doc, { emitUpdate: true });
  }, blocks as SeedBlock[]);
  await page.waitForTimeout(700);
}

/** Seed multiple pages in one go. Final state: last seeded page is the active page. */
export async function seedPages(page: Page, pages: ReadonlyArray<SeedPage>): Promise<void> {
  for (const p of pages) {
    await createNewPage(page, p.title);
    await openPageByTitle(page, p.title);
    await setPageBlocks(page, p.blocks);
  }
}

/** Get the currently-open page's TipTap JSON. */
export async function getCurrentPageJSON(page: Page): Promise<any> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    return editor ? editor.getJSON() : null;
  });
}

/** Get { id, text } for every top-level paragraph on the open page. */
export async function getCurrentPageBlocks(page: Page): Promise<Array<{ id: string | null; text: string }>> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return [];
    const json = editor.getJSON();
    return (json.content || []).map((node: any) => ({
      id: node.attrs?.id ?? null,
      text: (node.content || []).map((c: any) => c.text ?? '').join(''),
    }));
  });
}
