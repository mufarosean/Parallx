/**
 * Toggle (`<details>`) hover-handle diagnostic.
 *
 * Toggles aren't `<ul>`/`<ol>` lists in the HTML sense — they're page
 * containers (`isPageContainer: true`) with a `<summary>` and a content
 * area. They don't share the bullet/numbered/todo list `<li>` hover
 * code path. This spec checks that hovering a stack of toggle blocks
 * correctly moves the handle from one to the next without sticking.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';

test.describe('Toggle hover handle', () => {

  test('handle follows cursor across stacked toggle blocks', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // 3 stacked toggles.
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed?.commands.setContent({
        type: 'doc',
        content: [1, 2, 3].map((n) => ({
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: `Toggle ${n}` }] },
            { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: `body ${n}` }] }] },
          ],
        })),
      });
    });
    await page.waitForTimeout(300);

    // Get each toggle's bounding rect + a sensible hover X (inside the
    // toggle's content area, not the editor margin).
    const rects = await page.evaluate(() => {
      const toggles = Array.from(document.querySelectorAll<HTMLElement>('.tiptap [data-type="details"], .tiptap details'));
      return toggles.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          midY: r.top + r.height / 2,
          hoverX: r.left + 20,
        };
      });
    });
    expect(rects.length).toBe(3);

    const handleTops: number[] = [];
    for (const r of rects) {
      await page.mouse.move(r.hoverX, r.midY);
      await page.waitForTimeout(200);
      const handleY = await page.evaluate(() => {
        const h = document.querySelector<HTMLElement>('.drag-handle:not(.hide)');
        return h ? h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2 : null;
      });
      handleTops.push(handleY ?? -1);
    }
    console.log('rects:', JSON.stringify(rects));
    console.log('handleTops:', JSON.stringify(handleTops));

    // Each hover should land the handle within ±40px of the toggle's mid.
    for (let i = 0; i < 3; i++) {
      expect(handleTops[i]).toBeGreaterThanOrEqual(rects[i].top - 8);
      expect(handleTops[i]).toBeLessThanOrEqual(rects[i].bottom + 8);
    }
  });
});
