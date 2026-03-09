/**
 * E2E tests: List Block Movement
 *
 * Verifies that list items behave as movable blocks inside the same list.
 * The canvas drop plugin should allow reordering between sibling items for
 * bullet, ordered, and task lists.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';
import type { Page } from '@playwright/test';

type ListType = 'bulletList' | 'orderedList' | 'taskList';

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function listItem(text: string) {
  return { type: 'listItem', content: [paragraph(text)] };
}

function taskItem(text: string) {
  return { type: 'taskItem', attrs: { checked: false }, content: [paragraph(text)] };
}

function makeListDoc(listType: ListType, items: string[]) {
  return [{
    type: listType,
    content: items.map((text) => listType === 'taskList' ? taskItem(text) : listItem(text)),
  }];
}

async function startDragFromTopLevelListItem(page: Page, listType: ListType, itemIndex: number): Promise<void> {
  const selector = listType === 'orderedList'
    ? '.tiptap > ol > li'
    : listType === 'taskList'
      ? '.tiptap > ul[data-type="taskList"] > li'
      : '.tiptap > ul:not([data-type="taskList"]) > li';
  await page.locator(selector).nth(itemIndex).hover();
  await page.waitForTimeout(300);
}

async function getTopLevelListItemRect(page: Page, listType: ListType, itemIndex: number): Promise<{
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}> {
  return page.evaluate(({ kind, index }) => {
    const selector = kind === 'orderedList'
      ? '.tiptap > ol'
      : kind === 'taskList'
        ? '.tiptap > ul[data-type="taskList"]'
        : '.tiptap > ul:not([data-type="taskList"])';
    const listEl = document.querySelector(selector) as HTMLElement | null;
    if (!listEl) throw new Error(`No DOM list found for ${kind}`);
    const items = Array.from(listEl.children).filter((child) => child.tagName === 'LI') as HTMLElement[];
    const item = items[index];
    if (!item) throw new Error(`No list item ${index} found for ${kind}`);
    const rect = item.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }, { kind: listType, index: itemIndex });
}

async function dispatchListDrop(page: Page, x: number, y: number): Promise<{ ok: boolean; info: string[] }> {
  const handle = page.locator('.drag-handle');
  await expect(handle).toBeVisible({ timeout: 3_000 });
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error('No drag handle bounding box');
  }

  return page.evaluate(({ hx, hy, cx, cy }) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return { ok: false, info: ['No editor'] };
    const view = editor.view;
    const dragHandle = document.querySelector('.drag-handle') as HTMLElement | null;
    if (!dragHandle) return { ok: false, info: ['No drag handle'] };
    const info: string[] = [];
    const dataTransfer = new DataTransfer();

    dragHandle.dispatchEvent(new DragEvent('dragstart', {
      clientX: hx,
      clientY: hy,
      dataTransfer,
      bubbles: true,
      cancelable: true,
    }));

    info.push(`afterDragStart=${JSON.stringify({
      hasDragging: !!view.dragging,
      from: view.state.selection.from,
      to: view.state.selection.to,
      type: view.dragging?.slice?.content?.firstChild?.type?.name ?? null,
    })}`);

    const overEvent = new DragEvent('dragover', {
      clientX: cx,
      clientY: cy,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(overEvent);

    const vert = document.querySelector('.column-drop-indicator') as HTMLElement | null;
    const horz = document.querySelector('.canvas-drop-guide') as HTMLElement | null;
    info.push(`afterDragOver=${JSON.stringify({
      prevented: overEvent.defaultPrevented,
      vertVisible: vert?.style.display === 'block',
      horzVisible: horz?.style.display === 'block',
      debug: (globalThis as any).__lastColumnDropDebug ?? null,
    })}`);

    const dropEvent = new DragEvent('drop', {
      clientX: cx,
      clientY: cy,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(dropEvent);
    info.push(`afterDrop=${JSON.stringify({
      prevented: dropEvent.defaultPrevented,
      debug: (globalThis as any).__lastColumnDropDebug ?? null,
    })}`);

    view.dom.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    view.dragging = null;
    view.dom.classList.remove('dragging');

    return { ok: dropEvent.defaultPrevented, info };
  }, {
    hx: handleBox.x + handleBox.width / 2,
    hy: handleBox.y + handleBox.height / 2,
    cx: x,
    cy: y,
  });
}

async function getTopLevelListTexts(page: Page, listType: ListType): Promise<string[]> {
  return page.evaluate((kind) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No editor');
    const doc = editor.getJSON();
    const listNode = (doc.content || []).find((node: any) => node.type === kind);
    if (!listNode) throw new Error(`No top-level ${kind} found in doc`);

    function extractText(node: any): string {
      if (!node) return '';
      if (node.type === 'text') return node.text || '';
      return (node.content || []).map(extractText).join('');
    }

    return (listNode.content || []).map((item: any) => extractText(item).trim());
  }, listType);
}

async function expectListReorder(page: Page, listType: ListType): Promise<void> {
  await setContent(page, makeListDoc(listType, ['Alpha', 'Bravo', 'Charlie']));

  await startDragFromTopLevelListItem(page, listType, 0);
  const targetRect = await getTopLevelListItemRect(page, listType, 1);
  const dragResult = await dispatchListDrop(page, targetRect.left + targetRect.width / 2, targetRect.top + (targetRect.height * 0.75));
  expect(dragResult.ok, dragResult.info.join('\n')).toBe(true);
  await page.waitForTimeout(250);

  await expect.poll(async () => getTopLevelListTexts(page, listType)).toEqual([
    'Bravo',
    'Alpha',
    'Charlie',
  ]);
}

test.describe('List Block Movement', () => {
  test('reorders bullet list items within the same list', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await expectListReorder(page, 'bulletList');
  });

  test('reorders ordered list items within the same list', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await expectListReorder(page, 'orderedList');
  });

  test('reorders task list items within the same list', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await expectListReorder(page, 'taskList');
  });
});