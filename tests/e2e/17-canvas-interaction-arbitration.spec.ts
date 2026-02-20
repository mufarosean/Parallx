import { sharedTest as test, expect, setupCanvasPage, setContent } from './fixtures';
import type { Page } from '@playwright/test';

function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

test.describe('Canvas Interaction Arbitration', () => {

  test('range selection deterministically dismisses slash menu', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [p('')]);

    const editor = page.locator('.tiptap');
    await editor.click();
    await page.keyboard.type('/');

    const slashMenu = page.locator('.canvas-slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 3000 });

    await page.evaluate(() => {
      (window as any).__tiptapEditor.commands.setTextSelection({ from: 1, to: 2 });
    });
    await page.waitForTimeout(150);

    await expect(slashMenu).toBeHidden();
  });

  test('drag-handle action targets nested inner block (not wrapper)', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);

    await setContent(page, [
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            content: [
              {
                type: 'callout',
                attrs: { emoji: 'lightbulb' },
                content: [
                  {
                    type: 'details',
                    attrs: { open: true },
                    content: [
                      { type: 'detailsSummary', content: [{ type: 'text', text: 'Toggle Summary' }] },
                      {
                        type: 'detailsContent',
                        content: [
                          {
                            type: 'blockquote',
                            content: [
                              p('Inner Target'),
                              p('Sibling Line'),
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'column',
            content: [p('Other Column')],
          },
        ],
      },
    ]);

    const inner = page.locator('p', { hasText: 'Inner Target' }).first();
    await inner.scrollIntoViewIfNeeded();
    await inner.hover({ force: true });
    await page.waitForTimeout(300);

    const handle = page.locator('.drag-handle');
    await expect(handle).toBeVisible({ timeout: 3000 });
    await handle.click({ force: true });

    const actionHeader = page.locator('.block-action-header');
    await expect(actionHeader).toHaveText('Text');

    const duplicateItem = page.locator('.block-action-item', { hasText: 'Duplicate' }).first();
    await duplicateItem.click();
    await page.waitForTimeout(250);

    const counts = await page.evaluate(() => {
      const json = (window as any).__tiptapEditor.getJSON();
      let innerTargetCount = 0;
      let calloutCount = 0;
      let detailsCount = 0;
      let quoteCount = 0;

      function walk(node: any) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'callout') calloutCount++;
        if (node.type === 'details') detailsCount++;
        if (node.type === 'blockquote') quoteCount++;
        if (node.type === 'paragraph' && node.content?.[0]?.text === 'Inner Target') {
          innerTargetCount++;
        }
        (node.content || []).forEach(walk);
      }

      walk(json);
      return { innerTargetCount, calloutCount, detailsCount, quoteCount };
    });

    expect(counts.innerTargetCount).toBe(2);
    expect(counts.calloutCount).toBe(1);
    expect(counts.detailsCount).toBe(1);
    expect(counts.quoteCount).toBe(1);
  });
});
