import { sharedTest as test, expect, setupCanvasPage, setContent } from './fixtures';
import type { Page, Locator } from '@playwright/test';

function p(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

async function getTopLevelLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const json = (window as any).__tiptapEditor.getJSON();
    const labels = (json.content || []).map((node: any) => {
      if (node.type === 'columnList') return `[columnList:${(node.content || []).length}]`;
      return node.content?.[0]?.text || '(empty)';
    });
    return labels.filter((label: string) => label !== '(empty)');
  });
}

async function getColumnLists(page: Page): Promise<string[][][]> {
  return page.evaluate(() => {
    const json = (window as any).__tiptapEditor.getJSON();
    const lists: string[][][] = [];
    for (const node of json.content || []) {
      if (node.type !== 'columnList') continue;
      lists.push((node.content || []).map((col: any) => (col.content || []).map((b: any) => b.content?.[0]?.text || '?')));
    }
    return lists;
  });
}

async function getBlockBox(page: Page, text: string, scope?: Locator) {
  const container = scope ?? page.locator('.tiptap');
  return container.locator('p', { hasText: text }).first().boundingBox();
}

async function dragBlockByText(
  page: Page,
  blockText: string,
  targetX: number,
  targetY: number,
  scope?: Locator,
): Promise<boolean> {
  const container = scope ?? page.locator('.tiptap');
  const block = container.locator('p', { hasText: blockText }).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover({ force: true });
  await page.waitForTimeout(200);

  const handle = page.locator('.drag-handle');
  if (!(await handle.isVisible())) return false;
  const handleBox = await handle.boundingBox();
  if (!handleBox) return false;

  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;

  const result = await page.evaluate(({ hx, hy, tx, ty }) => {
    const dragHandle = document.querySelector('.drag-handle') as HTMLElement | null;
    if (!dragHandle) return false;

    const dt = new DataTransfer();
    dragHandle.dispatchEvent(new DragEvent('dragstart', {
      clientX: hx,
      clientY: hy,
      dataTransfer: dt,
      bubbles: true,
      cancelable: true,
    }));

    const view = (window as any).__tiptapEditor?.view;
    if (!view?.dragging) return false;

    view.dom.dispatchEvent(new DragEvent('dragover', {
      clientX: tx,
      clientY: ty,
      bubbles: true,
      cancelable: true,
    }));

    const dropEvt = new DragEvent('drop', {
      clientX: tx,
      clientY: ty,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(dropEvt);

    view.dom.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    view.dragging = null;
    view.dom.classList.remove('dragging');

    return dropEvt.defaultPrevented;
  }, { hx, hy, tx: targetX, ty: targetY });

  await page.waitForTimeout(250);
  return result;
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__tiptapEditor?.commands?.undo();
  });
  await page.waitForTimeout(250);
}

async function redo(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__tiptapEditor?.commands?.redo();
  });
  await page.waitForTimeout(250);
}

test.describe('Column Drag Undo/Redo Matrix', () => {

  test('Rule 4A: top-level -> top-level reorders and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      p('Top-B'),
      { type: 'columnList', content: [{ type: 'column', content: [p('C1-A')] }, { type: 'column', content: [p('C2-A')] }] },
      p('Top-C'),
    ]);

    const beforeTop = await getTopLevelLabels(page);
    const target = await getBlockBox(page, 'Top-A');
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'Top-C', target!.x + target!.width / 2, target!.y + target!.height * 0.2)).toBe(true);

    const afterTop = await getTopLevelLabels(page);
    expect(afterTop).toEqual(['Top-C', 'Top-A', 'Top-B', '[columnList:2]']);

    await undo(page);
    expect(await getTopLevelLabels(page)).toEqual(beforeTop);

    await redo(page);
    expect(await getTopLevelLabels(page)).toEqual(afterTop);
  });

  test('Rule 4B: top-level -> column move and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('C1-A'), p('C1-B')] },
          { type: 'column', content: [p('C2-A')] },
        ],
      },
      p('Top-B'),
    ]);

    const beforeTop = await getTopLevelLabels(page);
    const beforeLists = await getColumnLists(page);

    const list = page.locator('.canvas-column-list').first();
    const col1 = list.locator('.canvas-column').nth(0);
    const target = await getBlockBox(page, 'C1-A', col1);
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'Top-A', target!.x + target!.width / 2, target!.y + target!.height * 0.75)).toBe(true);

    const afterTop = await getTopLevelLabels(page);
    const afterLists = await getColumnLists(page);
    expect(afterTop).toEqual(['[columnList:2]', 'Top-B']);
    expect(afterLists[0][0]).toEqual(['C1-A', 'Top-A', 'C1-B']);

    await undo(page);
    expect(await getTopLevelLabels(page)).toEqual(beforeTop);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getTopLevelLabels(page)).toEqual(afterTop);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });

  test('Rule 4C: column -> top-level move and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('C1-A')] },
          { type: 'column', content: [p('C2-A'), p('C2-B')] },
        ],
      },
      p('Top-B'),
    ]);

    const beforeTop = await getTopLevelLabels(page);
    const beforeLists = await getColumnLists(page);

    const list = page.locator('.canvas-column-list').first();
    const col2 = list.locator('.canvas-column').nth(1);
    const target = await getBlockBox(page, 'Top-B');
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'C2-B', target!.x + target!.width / 2, target!.y + target!.height * 0.2, col2)).toBe(true);

    const afterTop = await getTopLevelLabels(page);
    const afterLists = await getColumnLists(page);
    expect(afterTop).toEqual(['Top-A', '[columnList:2]', 'C2-B', 'Top-B']);
    expect(afterLists[0][1]).toEqual(['C2-A']);

    await undo(page);
    expect(await getTopLevelLabels(page)).toEqual(beforeTop);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getTopLevelLabels(page)).toEqual(afterTop);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });

  test('Rule 4D: same-column reorder and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('C1-A'), p('C1-B'), p('C1-C')] },
          { type: 'column', content: [p('C2-A')] },
        ],
      },
      p('Top-B'),
    ]);

    const beforeLists = await getColumnLists(page);

    const list = page.locator('.canvas-column-list').first();
    const col1 = list.locator('.canvas-column').nth(0);
    const target = await getBlockBox(page, 'C1-C', col1);
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'C1-A', target!.x + target!.width / 2, target!.y + target!.height * 0.75, col1)).toBe(true);

    const afterLists = await getColumnLists(page);
    expect(afterLists[0][0]).toEqual(['C1-B', 'C1-C', 'C1-A']);

    await undo(page);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });

  test('Rule 4E: cross-column move (same list) and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('C1-A'), p('C1-B')] },
          { type: 'column', content: [p('C2-A'), p('C2-B')] },
        ],
      },
      p('Top-B'),
    ]);

    const beforeLists = await getColumnLists(page);

    const list = page.locator('.canvas-column-list').first();
    const col1 = list.locator('.canvas-column').nth(0);
    const col2 = list.locator('.canvas-column').nth(1);
    const target = await getBlockBox(page, 'C2-B', col2);
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'C1-B', target!.x + target!.width / 2, target!.y + target!.height * 0.2, col1)).toBe(true);

    const afterLists = await getColumnLists(page);
    expect(afterLists[0][0]).toEqual(['C1-A']);
    expect(afterLists[0][1]).toEqual(['C2-A', 'C1-B', 'C2-B']);

    await undo(page);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });

  test('Rule 4F: move across different columnLists and undo/redo', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('L1C1-A'), p('L1C1-B')] },
          { type: 'column', content: [p('L1C2-A')] },
        ],
      },
      p('Top-Mid'),
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p('L2C1-A'), p('L2C1-B')] },
          { type: 'column', content: [p('L2C2-A')] },
        ],
      },
      p('Top-Z'),
    ]);

    const beforeLists = await getColumnLists(page);

    const list1 = page.locator('.canvas-column-list').nth(0);
    const list2 = page.locator('.canvas-column-list').nth(1);
    const sourceCol = list1.locator('.canvas-column').nth(0);
    const targetCol = list2.locator('.canvas-column').nth(0);

    const target = await getBlockBox(page, 'L2C1-A', targetCol);
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'L1C1-A', target!.x + target!.width / 2, target!.y + target!.height * 0.75, sourceCol)).toBe(true);

    const afterLists = await getColumnLists(page);
    expect(afterLists[0][0]).toEqual(['L1C1-B']);
    expect(afterLists[1][0]).toEqual(['L2C1-A', 'L1C1-A', 'L2C1-B']);

    await undo(page);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });

  test('moving out last meaningful block removes placeholder-only source column and rebalances widths', async ({ window: page, electronApp, workspacePath }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await setContent(page, [
      p('Top-A'),
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            attrs: { width: 50 },
            content: [
              p('Move-Me'),
              { type: 'paragraph' },
            ],
          },
          {
            type: 'column',
            attrs: { width: 25 },
            content: [p('Keep-B')],
          },
          {
            type: 'column',
            attrs: { width: 25 },
            content: [p('Keep-C')],
          },
        ],
      },
      p('Top-Z'),
    ]);

    const beforeLists = await getColumnLists(page);

    const list = page.locator('.canvas-column-list').first();
    const sourceCol = list.locator('.canvas-column').nth(0);
    const target = await getBlockBox(page, 'Top-Z');
    expect(target).toBeTruthy();
    expect(await dragBlockByText(page, 'Move-Me', target!.x + target!.width / 2, target!.y + target!.height * 0.2, sourceCol)).toBe(true);

    const afterLists = await getColumnLists(page);
    expect(afterLists[0]).toEqual([
      ['Keep-B'],
      ['Keep-C'],
    ]);

    const afterWidths = await page.evaluate(() => {
      const json = (window as any).__tiptapEditor.getJSON();
      const cl = (json.content || []).find((n: any) => n.type === 'columnList');
      if (!cl) return [];
      return (cl.content || []).map((col: any) => col.attrs?.width ?? null);
    });
    expect(afterWidths).toEqual([null, null]);

    await undo(page);
    expect(await getColumnLists(page)).toEqual(beforeLists);

    await redo(page);
    expect(await getColumnLists(page)).toEqual(afterLists);
  });
});
