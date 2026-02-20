/**
 * E2E tests: Block Handles â€” Plus (+) button and Block Action Menu.
 *
 * Tests the two Notion-style block handle features:
 *
 * 1. Plus (+) button â€” appears left of the drag handle on hover.
 *    Click adds a block below and opens the slash menu.
 *
 * 2. Block Action Menu â€” clicking the 6-dot drag handle opens a context menu:
 *    - Turn Into submenu (convert between block types)
 *    - Color submenu (text and background colors)
 *    - Duplicate (clone block)
 *    - Delete (remove block)
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent, getDocStructure, getDocJSON, hoverBlockByIndex, openBlockActionMenu } from './fixtures';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

test.describe('Block Handles â€” Plus Button and Action Menu', () => {

  // â”€â”€ Plus Button Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('plus button appears alongside drag handle on hover', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('divider block shows drag handle and plus affordance', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'After divider' }] },
    ]);

    await hoverBlockByIndex(window, 0);

    const dragHandle = window.locator('.drag-handle');
    const addBtn = window.locator('.block-add-btn');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });
    await expect(addBtn).toBeVisible({ timeout: 3_000 });

    // Plus should work on divider just like any block and insert below it.
    await window.evaluate(() => {
      const btn = document.querySelector('.block-add-btn');
      if (!btn) throw new Error('No plus button');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await window.waitForTimeout(300);

    const structure = await getDocStructure(window);
    expect(structure[0]).toBe('horizontalRule');
    expect(structure).toContain('p:/');
  });

  test('divider uses row-height layout for centered handle alignment', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'After divider' }] },
    ]);

    const dividerMetrics = await window.evaluate(() => {
      const hr = document.querySelector('.canvas-tiptap-editor hr');
      if (!hr) return null;
      const styles = getComputedStyle(hr);
      return {
        height: styles.height,
        marginTop: styles.marginTop,
        marginBottom: styles.marginBottom,
      };
    });

    expect(dividerMetrics).toEqual({
      height: '24px',
      marginTop: '2px',
      marginBottom: '2px',
    });
  });

  test('plus button click inserts paragraph below and triggers slash menu', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
    ]);

    // Hover first block
    await hoverBlockByIndex(window, 0);

    // Click the plus button via dispatchEvent â€” the editor overlay covers the
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

  // â”€â”€ Block Action Menu Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('clicking drag handle opens block action menu', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('drag handle remains clickable for paragraph below an image block', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Test image' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph after image' }] },
    ]);

    await openBlockActionMenu(window, 1);

    const actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });
    await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
  });

  test('image blocks use normalized top spacing for alignment', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Test image' } },
      { type: 'paragraph', attrs: { backgroundColor: 'rgba(70,160,230,0.2)' }, content: [{ type: 'text', text: 'Color block' }] },
    ]);

    const marginTop = await window.evaluate(() => {
      const img = document.querySelector('.canvas-tiptap-editor img');
      if (!img) return null;
      return getComputedStyle(img).marginTop;
    });

    expect(marginTop).toBe('2px');
  });

  test('drag handles remain clickable across mixed block types', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading block' }] },
      { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Test image' } },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote block' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      { type: 'mathBlock', attrs: { latex: 'x^2 + y^2 = z^2' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Final paragraph' }] },
    ]);

    // Validate that we can reliably click handles for multiple targets even
    // when different neighboring block DOM structures are present.
    await openBlockActionMenu(window, 0);
    let actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });
    await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();

    // Close via handle toggle
    const dragHandle = window.locator('.drag-handle');
    await dragHandle.click({ force: true });
    await window.waitForTimeout(180);

    await openBlockActionMenu(window, 2); // quote
    actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });
    await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();

    await dragHandle.click({ force: true });
    await window.waitForTimeout(180);

    await openBlockActionMenu(window, 5);
    actionMenu = window.locator('.block-action-menu');
    await expect(actionMenu).toBeVisible({ timeout: 3_000 });
    await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
  });

  test('clicking drag handle again closes the menu', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('drag-handle gesture does not open bubble formatting menu', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Drag handle should not trigger formatting bubble menu.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
    ]);

    await hoverBlockByIndex(window, 0);
    const dragHandle = window.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });

    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    if (handleBox) {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      await window.mouse.move(startX, startY);
      await window.mouse.down();
      await window.mouse.move(startX + 50, startY + 16, { steps: 4 });
      await window.mouse.up();
      await window.waitForTimeout(220);
    }

    const bubble = window.locator('.canvas-bubble-menu');
    await expect(bubble).not.toBeVisible();
  });

  // â”€â”€ Turn Into Submenu Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('Turn Into submenu appears on hover', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ heading 1', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ bullet list', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ 3 columns', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Split this block' }] },
    ]);

    await openBlockActionMenu(window, 0);

    const turnInto = window.locator('.block-action-menu .block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    await window.waitForTimeout(300);

    const turnIntoSubmenu = window.locator('.block-action-submenu:not(.block-color-submenu)');
    await expect(turnIntoSubmenu.locator('.block-action-item', { hasText: '2 columns' })).toBeVisible();
    await expect(turnIntoSubmenu.locator('.block-action-item', { hasText: '3 columns' })).toBeVisible();
    await expect(turnIntoSubmenu.locator('.block-action-item', { hasText: '4 columns' })).toBeVisible();

    const threeCols = turnIntoSubmenu.locator('.block-action-item', { hasText: '3 columns' });
    await threeCols.click();
    await window.waitForTimeout(300);

    const doc = await getDocJSON(window);
    expect(doc.content[0].type).toBe('columnList');
    expect(doc.content[0].content.length).toBe(3);
    expect(doc.content[0].content[0].type).toBe('column');
    expect(doc.content[0].content[0].content[0].type).toBe('paragraph');
    expect(doc.content[0].content[0].content[0].content?.[0]?.text).toBe('Split this block');
  });

  test('Turn Into: heading â†’ paragraph', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ callout', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('callout icon is clickable and updates icon selection', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      {
        type: 'callout',
        attrs: { emoji: 'lightbulb' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Icon me' }] }],
      },
    ]);

    const icon = window.locator('.canvas-callout .canvas-callout-emoji').first();
    await expect(icon).toBeVisible({ timeout: 3_000 });

    await icon.click();
    const picker = window.locator('.canvas-icon-picker');
    await expect(picker).toBeVisible({ timeout: 3_000 });

    const targetIcon = picker.locator('.canvas-icon-btn[title="rocket"]').first();
    await targetIcon.click();
    await window.waitForTimeout(200);

    await expect(picker).not.toBeVisible();

    const doc = await getDocJSON(window);
    const callout = doc.content?.[0];
    expect(callout?.type).toBe('callout');
    expect(callout?.attrs?.emoji).toBe('rocket');
  });

  test('Turn Into: paragraph â†’ code block', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  // â”€â”€ Color Submenu Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('Color submenu appears on hover with text and background colors', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

    // Click "Blue background" via dispatchEvent â€” the panel tab bar sits atop
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

    // Check that block-level backgroundColor attribute was applied (not text highlight)
    const hasBg = await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) return false;
      const json = editor.getJSON();
      return json.content?.[0]?.attrs?.backgroundColor != null;
    });
    expect(hasBg).toBe(true);
  });

  // â”€â”€ Duplicate Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('Duplicate creates a copy of the block', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  // â”€â”€ Delete Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('Delete removes the block', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  // â”€â”€ Block Action Menu Header Label Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('block action menu shows correct label for different block types', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  // â”€â”€ Turn Into with Multiple Block Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  test('Turn Into: paragraph â†’ quote', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ to-do list', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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

  test('Turn Into: paragraph â†’ numbered list', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
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
