/**
 * Diagnostic: Enter / Shift+Enter / Turn Into behaviors inside containers.
 *
 * For each case we set a doc programmatically, place the cursor at a
 * meaningful spot inside an open toggle (and analogous containers),
 * press a key (or invoke turn-into), and snapshot the resulting doc
 * tree so we can catalog what works and what's broken.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';
import type { Page } from '@playwright/test';

async function setDoc(page: Page, doc: unknown): Promise<void> {
  await page.evaluate((d) => {
    const ed = (window as any).__tiptapEditor;
    ed?.commands.setContent(d as any);
  }, doc);
  await page.waitForTimeout(150);
}

async function getJson(page: Page): Promise<any> {
  return page.evaluate(() => {
    const ed = (window as any).__tiptapEditor;
    return ed?.getJSON();
  });
}

async function placeCursorAtEndOfText(page: Page, text: string): Promise<void> {
  const ok = await page.evaluate((t) => {
    const ed = (window as any).__tiptapEditor;
    const view = ed.view;
    let target: number | null = null;
    view.state.doc.descendants((node: any, pos: number) => {
      if (target !== null) return false;
      if (node.isText && (node.text || '').includes(t)) {
        target = pos + (node.text || '').length;
        return false;
      }
      return true;
    });
    if (target == null) return false;
    ed.chain().focus().setTextSelection(target).run();
    return true;
  }, text);
  if (!ok) throw new Error(`text not found: ${text}`);
  await page.waitForTimeout(80);
}

function summarizeDoc(json: any, depth = 0): string {
  if (!json) return '<null>';
  const indent = '  '.repeat(depth);
  const type = json.type;
  const text = json.text ? `:"${json.text.slice(0, 30)}"` : '';
  const lines = [`${indent}${type}${text}`];
  if (Array.isArray(json.content)) {
    for (const c of json.content) lines.push(summarizeDoc(c, depth + 1));
  }
  return lines.join('\n');
}

test.describe('Canvas container behaviors — Enter / Shift+Enter / Turn Into', () => {

  test('Enter at end of last paragraph in open toggle', async ({
    window: page, electronApp, workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setDoc(page, {
      type: 'doc',
      content: [
        {
          type: 'details', attrs: { open: true },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
            { type: 'detailsContent', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'LAST' }] },
            ] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'AFTER' }] },
      ],
    });

    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
    });

    await placeCursorAtEndOfText(page, 'LAST');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const after = await getJson(page);
    console.log('--- ENTER at end of last paragraph in open toggle ---');
    console.log(summarizeDoc(after));
    expect(after).toBeTruthy();
  });

  test('Shift+Enter at end of last paragraph in open toggle', async ({
    window: page, electronApp, workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await setDoc(page, {
      type: 'doc',
      content: [
        {
          type: 'details', attrs: { open: true },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
            { type: 'detailsContent', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'LAST' }] },
            ] },
          ],
        },
      ],
    });
    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
    });
    await placeCursorAtEndOfText(page, 'LAST');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    const after = await getJson(page);
    console.log('--- SHIFT+ENTER at end of last paragraph in open toggle ---');
    console.log(summarizeDoc(after));
    expect(after).toBeTruthy();
  });

  test('Turn paragraph inside toggle into bulletList', async ({
    window: page, electronApp, workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await setDoc(page, {
      type: 'doc',
      content: [{
        type: 'details', attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
          { type: 'detailsContent', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'PARA' }] },
          ] },
        ],
      }],
    });
    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
    });
    await placeCursorAtEndOfText(page, 'PARA');
    // Programmatic turn-into to confirm the transform itself works
    // regardless of UI plumbing.
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed.chain().focus().toggleBulletList().run();
    });
    await page.waitForTimeout(200);
    const after = await getJson(page);
    console.log('--- Turn paragraph in toggle into bulletList ---');
    console.log(summarizeDoc(after));
    expect(after).toBeTruthy();
  });

  test('Enter on EMPTY list item inside toggle (outdent or new paragraph?)', async ({
    window: page, electronApp, workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await setDoc(page, {
      type: 'doc',
      content: [{
        type: 'details', attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
          { type: 'detailsContent', content: [
            { type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph' }] },
            ] },
          ] },
        ],
      }],
    });
    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
      const ed = (window as any).__tiptapEditor;
      // Place cursor at the empty list item's paragraph
      const view = ed.view;
      let target: number | null = null;
      view.state.doc.descendants((node: any, pos: number) => {
        if (target !== null) return false;
        if (node.type.name === 'listItem' && node.textContent === '') {
          target = pos + 2; // inside the paragraph
          return false;
        }
        return true;
      });
      if (target != null) {
        const sel = view.state.selection.constructor;
        const tr = view.state.tr.setSelection(sel.near(view.state.doc.resolve(target!)));
        view.dispatch(tr);
      }
    });
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const after = await getJson(page);
    console.log('--- Enter on empty list item inside toggle ---');
    console.log(summarizeDoc(after));
    expect(after).toBeTruthy();
  });
});
