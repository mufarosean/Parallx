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

  test('callout child handle retargets after hovering the callout shell', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);

    await setContent(page, [
      {
        type: 'callout',
        attrs: { emoji: 'lightbulb' },
        content: [
          p('Nested Target'),
          p('Nested Sibling'),
        ],
      },
      p('After Callout'),
    ]);

    const callout = page.locator('.canvas-callout').first();
    const calloutBox = await callout.boundingBox();
    if (!calloutBox) throw new Error('Missing callout bounds');

    await page.mouse.move(calloutBox.x + 8, calloutBox.y + 8);
    await page.waitForTimeout(250);

    const handle = page.locator('.drag-handle');
    await expect(handle).toBeVisible({ timeout: 3000 });

    const inner = page.locator('.canvas-callout p', { hasText: 'Nested Target' }).first();
    const innerBox = await inner.boundingBox();
    if (!innerBox) throw new Error('Missing nested paragraph bounds');

    await page.mouse.move(innerBox.x + 8, innerBox.y + innerBox.height / 2);
    await page.waitForTimeout(250);
    await handle.click({ force: true });

    await expect(page.locator('.block-action-header')).toHaveText('Text');

    const duplicateItem = page.locator('.block-action-item', { hasText: 'Duplicate' }).first();
    await duplicateItem.click();
    await page.waitForTimeout(250);

    const counts = await page.evaluate(() => {
      const json = (window as any).__tiptapEditor.getJSON();
      let nestedTargetCount = 0;
      let calloutCount = 0;

      function walk(node: any) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'callout') calloutCount++;
        if (node.type === 'paragraph' && node.content?.[0]?.text === 'Nested Target') {
          nestedTargetCount++;
        }
        (node.content || []).forEach(walk);
      }

      walk(json);
      return { nestedTargetCount, calloutCount };
    });

    expect(counts.nestedTargetCount).toBe(2);
    expect(counts.calloutCount).toBe(1);
  });

  test('drop guide inside callout content uses the callout lane', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);

    await setContent(page, [
      p('Outside Source'),
      {
        type: 'callout',
        attrs: { emoji: 'lightbulb' },
        content: [
          p('Callout A'),
          p('Callout B'),
        ],
      },
      p('After Callout'),
    ]);

    const source = page.locator('.tiptap p', { hasText: 'Outside Source' }).first();
    await source.hover({ force: true });
    await page.waitForTimeout(250);

    const handle = page.locator('.drag-handle');
    await expect(handle).toBeVisible({ timeout: 3000 });
    const handleBox = await handle.boundingBox();
    const calloutBox = await page.locator('.canvas-callout').first().boundingBox();
    const contentBox = await page.locator('.canvas-callout-content').first().boundingBox();
    const targetBox = await page.locator('.canvas-callout p', { hasText: 'Callout B' }).first().boundingBox();

    if (!handleBox || !calloutBox || !contentBox || !targetBox) {
      throw new Error('Missing drag guide test bounds');
    }

    const result = await page.evaluate(({ hx, hy, tx, ty }) => {
      const handleEl = document.querySelector('.drag-handle') as HTMLElement | null;
      const view = (window as any).__tiptapEditor?.view;
      if (!handleEl || !view) return { ok: false, reason: 'missing handle or view' };

      const dataTransfer = new DataTransfer();
      handleEl.dispatchEvent(new DragEvent('dragstart', {
        clientX: hx,
        clientY: hy,
        dataTransfer,
        bubbles: true,
        cancelable: true,
      }));

      const overEvent = new DragEvent('dragover', {
        clientX: tx,
        clientY: ty,
        dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(overEvent);

      const guide = document.querySelector('.canvas-drop-guide') as HTMLElement | null;
      const content = document.querySelector('.canvas-callout-content') as HTMLElement | null;
      const guideRect = guide?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();

      handleEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
      view.dragging = null;
      view.dom.classList.remove('dragging');

      if (!guide || !guideRect || !contentRect) {
        return {
          ok: false,
          reason: 'missing guide or content rect',
          prevented: overEvent.defaultPrevented,
          guideDisplay: guide?.style.display ?? '',
        };
      }

      return {
        ok: true,
        prevented: overEvent.defaultPrevented,
        guideDisplay: guide.style.display,
        guideLeft: guideRect.left,
        guideRight: guideRect.right,
        contentLeft: contentRect.left,
        contentRight: contentRect.right,
      };
    }, {
      hx: handleBox.x + handleBox.width / 2,
      hy: handleBox.y + handleBox.height / 2,
      tx: calloutBox.x + 8,
      ty: targetBox.y + 2,
    });

    expect(result.ok).toBe(true);
    expect(result.prevented).toBe(true);
    expect(result.guideDisplay).toBe('block');
    expect(result.guideLeft).toBeGreaterThanOrEqual(result.contentLeft - 1);
    expect(result.guideRight).toBeLessThanOrEqual(result.contentRight + 1);
  });
});
