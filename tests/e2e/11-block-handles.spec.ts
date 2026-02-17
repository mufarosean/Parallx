/**
 * E2E tests: Block Handles — Plus (+) button and Block Action Menu.
 *
 * Tests the two Notion-style block handle features:
 *
 * 1. Plus (+) button — appears left of the drag handle on hover.
 *    Click adds a block below and opens the slash menu.
 *
 * 2. Block Action Menu — clicking the 6-dot drag handle opens a context menu:
 *    - Turn Into submenu (convert between block types)
 *    - Color submenu (text and background colors)
 *    - Duplicate (clone block)
 *    - Delete (remove block)
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import type { Page, ElectronApplication } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function setupCanvasPage(
  page: Page,
  electronApp: ElectronApplication,
  wsPath: string,
): Promise<void> {
  await openFolderViaMenu(electronApp, page, wsPath);
  await page.waitForTimeout(2000);

  // Open Canvas sidebar
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });

  // Create a new page
  await page.locator('.canvas-sidebar-add-btn').click();
  await page.waitForSelector('.canvas-node', { timeout: 10_000 });

  // Open the page
  await page.locator('.canvas-node').first().click();
  await page.waitForSelector('.tiptap', { timeout: 10_000 });

  // Wait for tiptap to be fully ready
  await page.waitForTimeout(500);
}

/** Wait for the TipTap editor to be exposed on window (test mode). */
async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
}

/** Set editor content and wait for it to render. */
async function setContent(page: Page, content: any[]): Promise<void> {
  await page.evaluate((c) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No TipTap editor');
    editor.commands.setContent({ type: 'doc', content: c });
  }, content);
  await page.waitForTimeout(300);
}

/** Get the block structure of the document as a string array. */
async function getDocStructure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return [];
    const json = editor.getJSON();
    return (json.content || []).map((node: any) => {
      const type = node.type;
      if (type === 'paragraph') return `p:${node.content?.[0]?.text || ''}`;
      if (type === 'heading') return `h${node.attrs?.level}:${node.content?.[0]?.text || ''}`;
      if (type === 'bulletList') return 'bulletList';
      if (type === 'orderedList') return 'orderedList';
      if (type === 'taskList') return 'taskList';
      if (type === 'blockquote') return 'blockquote';
      if (type === 'codeBlock') return 'codeBlock';
      if (type === 'callout') return 'callout';
      if (type === 'details') return 'details';
      if (type === 'mathBlock') return 'mathBlock';
      return type;
    });
  });
}

/** Hover over a specific block by index to trigger the drag handle to appear. */
async function hoverBlockByIndex(page: Page, index: number): Promise<void> {
  const tiptap = page.locator('.tiptap');
  const blocks = tiptap.locator(':scope > *');
  const block = blocks.nth(index);
  await block.hover();
  await page.waitForTimeout(500);
}

/** Click the drag handle to open the block action menu. */
async function openBlockActionMenu(page: Page, blockIndex: number): Promise<void> {
  await hoverBlockByIndex(page, blockIndex);
  const dragHandle = page.locator('.drag-handle');
  await expect(dragHandle).toBeVisible({ timeout: 3_000 });
  await dragHandle.click();
  await page.waitForTimeout(200);
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Block Handles — Plus Button and Action Menu', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  // ── Plus Button Tests ─────────────────────────────────────────────────────

  test('plus button appears alongside drag handle on hover', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    ]);

    // Hover the first block to trigger handles
    await hoverBlockByIndex(window, 0);

    // Both the drag handle and the plus button should be visible
    const dragHandle = window.locator('.drag-handle');
    const addBtn = window.locator('.block-add-btn');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });
    await expect(addBtn).toBeVisible({ timeout: 3_000 });

    // Plus button should be positioned to the left of the drag handle
    const handleBox = await dragHandle.boundingBox();
    const addBox = await addBtn.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(addBox).toBeTruthy();
    if (handleBox && addBox) {
      expect(addBox.x).toBeLessThan(handleBox.x);
    }
  });

  test('plus button click inserts paragraph below and triggers slash menu', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
    ]);

    // Hover first block
    await hoverBlockByIndex(window, 0);

    // Click the plus button via dispatchEvent — the editor overlay covers the
    // button position, so Playwright's native click is intercepted.
    const addBtn = window.locator('.block-add-btn');
    await expect(addBtn).toBeVisible({ timeout: 3_000 });
    await window.evaluate(() => {
      const btn = document.querySelector('.block-add-btn');
      if (!btn) throw new Error('No plus button');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await window.waitForTimeout(500);

    // A new paragraph with '/' should be inserted, and slash menu should be visible
    const slashMenu = window.locator('.canvas-slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 3_000 });

    // Document should now have 3 blocks (the new paragraph is inserted after the 1st)
    const structure = await getDocStructure(window);
    expect(structure.length).toBe(3);
    // The new paragraph should have the '/' text
    expect(structure[1]).toBe('p:/');

    // Close slash menu by pressing Escape
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
    await expect(slashMenu).not.toBeVisible();
  });

  // ── Block Action Menu Tests ───────────────────────────────────────────────

  test('clicking drag handle opens block action menu', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Test paragraph' }] },
    ]);

    // Open the action menu
    await openBlockActionMenu(window, 0);

    // The menu should be visible
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });

    // It should have menu items: Turn into, Color, Duplicate, Delete
    const turnInto = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
    const color = actionMenu.locator('.block-action-item', { hasText: 'Color' });
    const duplicate = actionMenu.locator('.block-action-item', { hasText: 'Duplicate' });
    const deleteBtn = actionMenu.locator('.block-action-item', { hasText: 'Delete' });

    await expect(turnInto).toBeVisible();
    await expect(color).toBeVisible();
    await expect(duplicate).toBeVisible();
    await expect(deleteBtn).toBeVisible();

    // Header should show the block type
    const header = actionMenu.locator('.block-action-header');
    await expect(header).toHaveText('Text');
  });

  test('clicking drag handle again closes the menu', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Toggle test' }] },
    ]);

    // Open the action menu
    await openBlockActionMenu(window, 0);
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });

    // Click the drag handle again to close
    const dragHandle = window.locator('.drag-handle');
    await dragHandle.click();
    await window.waitForTimeout(200);
    await expect(actionMenu).not.toBeVisible();
  });

  test('clicking outside closes the block action menu', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Outside click test' }] },
    ]);

    await openBlockActionMenu(window, 0);
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });

    // Click on the editor body, away from the menu
    await tiptap.click({ position: { x: 300, y: 300 } });
    await window.waitForTimeout(300);
    await expect(actionMenu).not.toBeVisible();
  });

  // ── Turn Into Submenu Tests ───────────────────────────────────────────────

  test('Turn Into submenu appears on hover', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Turn into test' }] },
    ]);

    await openBlockActionMenu(window, 0);

    // Hover "Turn into"
    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    // Submenu should appear
    const submenu = window.locator('.block-action-submenu').first();
    await expect(submenu).toBeVisible({ timeout: 3_000 });

    // Should have all the block types listed
    const items = submenu.locator('.block-action-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(10); // Text, H1, H2, H3, Bullet, Numbered, Todo, Toggle, Code, Quote, Callout, Equation

    // "Text" should have a checkmark since current block is paragraph
    const textItem = submenu.locator('.block-action-item', { hasText: 'Text' });
    const check = textItem.locator('.block-action-check');
    await expect(check).toBeVisible();
  });

  test('Turn Into: paragraph → heading 1', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Become a heading' }] },
    ]);

    await openBlockActionMenu(window, 0);

    // Hover "Turn into" to show submenu
    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    // Click "Heading 1"
    const submenu = window.locator('.block-action-submenu').first();
    const h1Item = submenu.locator('.block-action-item', { hasText: 'Heading 1' });
    await h1Item.click();
    await window.waitForTimeout(300);

    // Menu should close
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).not.toBeVisible();

    // Block should now be a heading
    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('h1:Become a heading');
  });

  test('Turn Into: paragraph → bullet list', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Become a list' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const bulletItem = submenu.locator('.block-action-item', { hasText: 'Bulleted list' });
    await bulletItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('bulletList');
  });

  test('Turn Into: heading → paragraph', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Was a heading' }] },
    ]);

    const initialStructure = await getDocStructure(window);
    expect(initialStructure[0]).toBe('h2:Was a heading');

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const textItem = submenu.locator('.block-action-item', { hasText: 'Text' });
    await textItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('p:Was a heading');
  });

  test('Turn Into: paragraph → callout', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Become a callout' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const calloutItem = submenu.locator('.block-action-item', { hasText: 'Callout' });
    await calloutItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('callout');
  });

  test('Turn Into: paragraph → code block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'console.log("hello")' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const codeItem = submenu.locator('.block-action-item', { hasText: /^Code$/ });
    await codeItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('codeBlock');
  });

  // ── Color Submenu Tests ───────────────────────────────────────────────────

  test('Color submenu appears on hover with text and background colors', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Color me' }] },
    ]);

    await openBlockActionMenu(window, 0);

    // Hover "Color"
    const colorItem = window.locator('.block-action-menu .block-action-item', { hasText: 'Color' });
    await colorItem.hover();
    await window.waitForTimeout(300);

    // Color submenu should appear
    const colorSubmenu = window.locator('.block-color-submenu');
    await expect(colorSubmenu).toBeVisible({ timeout: 3_000 });

    // Should have "Text color" and "Background color" sections
    const textHeader = colorSubmenu.locator('.block-color-section-header', { hasText: 'Text color' });
    const bgHeader = colorSubmenu.locator('.block-color-section-header', { hasText: 'Background color' });
    await expect(textHeader).toBeVisible();
    await expect(bgHeader).toBeVisible();

    // Should have color items (10 text + 10 bg = 20)
    const colorItems = colorSubmenu.locator('.block-color-item');
    const count = await colorItems.count();
    expect(count).toBe(20);
  });

  test('Color: apply text color to a block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Color this text' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const colorItem = window.locator('.block-action-menu .block-action-item', { hasText: 'Color' });
    await colorItem.hover();
    await window.waitForTimeout(300);

    // Click "Red text"
    const colorSubmenu = window.locator('.block-color-submenu');
    const redItem = colorSubmenu.locator('.block-color-item', { hasText: 'Red text' });
    await redItem.click();
    await window.waitForTimeout(300);

    // Menu should close
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).not.toBeVisible();

    // Check that color mark was applied
    const hasColor = await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) return false;
      const json = editor.getJSON();
      const content = json.content?.[0]?.content;
      return content?.some((n: any) => n.marks?.some((m: any) => m.type === 'textStyle' && m.attrs?.color));
    });
    expect(hasColor).toBe(true);
  });

  test('Color: apply background color to a block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Highlight this' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const colorItem = window.locator('.block-action-menu .block-action-item', { hasText: 'Color' });
    await colorItem.hover();
    await window.waitForTimeout(300);

    // Click "Blue background" via dispatchEvent — the panel tab bar sits atop
    // this item so Playwright's native click is intercepted.
    const colorSubmenu = window.locator('.block-color-submenu');
    await expect(colorSubmenu).toBeVisible({ timeout: 3_000 });
    await window.evaluate(() => {
      const items = document.querySelectorAll('.block-color-submenu .block-color-item');
      const item = [...items].find(el => el.textContent?.includes('Blue background'));
      if (!item) throw new Error('No Blue background item');
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    await window.waitForTimeout(300);

    // Check that highlight mark was applied
    const hasHighlight = await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) return false;
      const json = editor.getJSON();
      const content = json.content?.[0]?.content;
      return content?.some((n: any) => n.marks?.some((m: any) => m.type === 'highlight'));
    });
    expect(hasHighlight).toBe(true);
  });

  // ── Duplicate Tests ───────────────────────────────────────────────────────

  test('Duplicate creates a copy of the block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Original block' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After block' }] },
    ]);

    const initialStructure = await getDocStructure(window);
    expect(initialStructure).toEqual(['p:Original block', 'p:After block']);

    await openBlockActionMenu(window, 0);

    // Click "Duplicate"
    const duplicateBtn = window.locator('.block-action-menu .block-action-item', { hasText: 'Duplicate' });
    await duplicateBtn.click();
    await window.waitForTimeout(300);

    // Menu should close
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).not.toBeVisible();

    // Document should now have 3 blocks with the first duplicated
    const structure = await getDocStructure(window);
    expect(structure).toEqual(['p:Original block', 'p:Original block', 'p:After block']);
  });

  test('Duplicate works on a heading block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const duplicateBtn = window.locator('.block-action-menu .block-action-item', { hasText: 'Duplicate' });
    await duplicateBtn.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure).toEqual(['h1:My Title', 'h1:My Title', 'p:Body text']);
  });

  // ── Delete Tests ──────────────────────────────────────────────────────────

  test('Delete removes the block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Keep this' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Delete this' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Keep this too' }] },
    ]);

    const initialStructure = await getDocStructure(window);
    expect(initialStructure.length).toBe(3);

    // Open menu on the second block (index 1) and delete it
    await openBlockActionMenu(window, 1);

    const deleteBtn = window.locator('.block-action-menu .block-action-item', { hasText: 'Delete' });
    await deleteBtn.click();
    await window.waitForTimeout(300);

    // Menu should close
    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).not.toBeVisible();

    // Only 2 blocks should remain
    const structure = await getDocStructure(window);
    expect(structure).toEqual(['p:Keep this', 'p:Keep this too']);
  });

  test('Delete works on a heading block', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'To be deleted' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Remains' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const deleteBtn = window.locator('.block-action-menu .block-action-item', { hasText: 'Delete' });
    await deleteBtn.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure).toEqual(['p:Remains']);
  });

  // ── Block Action Menu Header Label Tests ──────────────────────────────────

  test('block action menu shows correct label for different block types', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    // Test with a heading
    await setContent(window, [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A heading' }] },
    ]);

    await openBlockActionMenu(window, 0);
    const header = window.locator('.block-action-menu .block-action-header');
    await expect(header).toHaveText('Heading');

    // Close menu by clicking outside (Escape has no handler on this menu)
    await tiptap.click();
    await window.waitForTimeout(300);

    // Test with a code block
    await setContent(window, [
      { type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1;' }] },
    ]);

    await openBlockActionMenu(window, 0);
    await expect(header).toHaveText('Code');
  });

  // ── Turn Into with Multiple Block Types ───────────────────────────────────

  test('Turn Into: paragraph → quote', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'This is wise' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const quoteItem = submenu.locator('.block-action-item', { hasText: 'Quote' });
    await quoteItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('blockquote');
  });

  test('Turn Into: paragraph → to-do list', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'A task' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const todoItem = submenu.locator('.block-action-item', { hasText: 'To-do list' });
    await todoItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('taskList');
  });

  test('Turn Into: paragraph → numbered list', async ({
    window,
    electronApp,
  }) => {
    await setupCanvasPage(window, electronApp, wsPath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'First item' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const submenu = window.locator('.block-action-submenu').first();
    const numberedItem = submenu.locator('.block-action-item', { hasText: 'Numbered list' });
    await numberedItem.click();
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('orderedList');
  });
});
