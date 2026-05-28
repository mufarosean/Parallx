/**
 * Reproduces the user's screenshot: an open toggle containing a
 * task list, then a paragraph inside the toggle. Hovers below the
 * last task item to see which block the handle anchors to.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';

test.describe('Toggle with task list — handle anchor diagnostic', () => {

  test('hovering below last task item in open toggle resolves to inner block', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // Build the structure from the user's screenshot.
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed?.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'details',
            attrs: { open: true },
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: 'Road Safety' }] },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'taskList',
                    content: [
                      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spare Tire' }] }] },
                      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Portable Battery Charger' }] }] },
                      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Portable Drill' }] }] },
                    ],
                  },
                  { type: 'paragraph', content: [{ type: 'text', text: '/bul' }] },
                ],
              },
            ],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'Sunday, June 14th' }] },
        ],
      });
    });
    await page.waitForTimeout(400);

    // Force the <details> element to actually be open.
    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
    });
    await page.waitForTimeout(200);

    // Measure positions of every block inside the toggle.
    const map = await page.evaluate(() => {
      const tiptap = document.querySelector('.tiptap');
      const details = document.querySelector<HTMLElement>('.tiptap details, .tiptap [data-type="details"]');
      const summary = document.querySelector<HTMLElement>('.tiptap details summary, .tiptap [data-type="detailsSummary"]');
      const content = document.querySelector<HTMLElement>('.tiptap [data-type="detailsContent"]');
      const taskList = document.querySelector<HTMLElement>('.tiptap ul[data-type="taskList"]');
      const tasks = taskList ? Array.from(taskList.querySelectorAll<HTMLElement>(':scope > li')) : [];
      const trailingP = document.querySelector<HTMLElement>('.tiptap [data-type="detailsContent"] > p:last-of-type');
      const rect = (el: Element | null) => el ? el.getBoundingClientRect() : null;
      return {
        tiptap: rect(tiptap),
        details: rect(details),
        summary: rect(summary),
        content: rect(content),
        tasks: tasks.map(rect),
        trailingP: rect(trailingP),
      };
    });
    console.log('layout:', JSON.stringify(map, null, 2));

    // Full user journey: hover the toggle title FIRST (so the handle
    // anchors to the details container), then move down past Portable
    // Drill. The bug only manifests on the transition.
    const lastTask = map.tasks[map.tasks.length - 1]!;
    const hoverX = (map.details!.left + 80);

    // Start by hovering on the toggle TITLE (Road Safety row).
    const titleY = (map.details!.top + (map.tasks[0]?.top ?? map.details!.top + 16)) / 2;
    await page.mouse.move(hoverX, titleY);
    await page.waitForTimeout(200);
    const handleAfterTitleHover = await page.evaluate(() => {
      const h = document.querySelector<HTMLElement>('.drag-handle:not(.hide)');
      return h ? h.getBoundingClientRect().top : null;
    });
    console.log('after title hover, handleTop:', handleAfterTitleHover);

    // Now move down below the last task item — this is where the bug
    // manifests (handle stays at Road Safety instead of following).
    const hoverY = lastTask.bottom + 4;
    await page.mouse.move(hoverX, hoverY);
    await page.waitForTimeout(250);

    // Inspect what posAtCoords / elementFromPoint actually return
    // for the hover position. This is the real diagnostic.
    const trace = await page.evaluate(({ x, y }) => {
      const ed = (window as any).__tiptapEditor;
      const view = ed.view;
      const hitResult = view.posAtCoords({ left: x, top: y });
      const $pos = hitResult ? view.state.doc.resolve(hitResult.pos) : null;
      const $inside = (hitResult && hitResult.inside >= 0) ? view.state.doc.resolve(hitResult.inside) : null;
      const elt = document.elementFromPoint(x, y);
      const path: string[] = [];
      if ($pos) {
        for (let d = 0; d <= $pos.depth; d++) {
          path.push(`${$pos.node(d).type.name}@${d}`);
        }
      }
      return {
        hitResult,
        posDepth: $pos?.depth,
        path,
        eltTag: elt?.tagName,
        eltClass: elt?.className,
        eltDataType: elt?.getAttribute('data-type'),
        eltText: (elt?.textContent || '').slice(0, 40),
      };
    }, { x: hoverX, y: hoverY });
    console.log('TRACE at hover:', JSON.stringify(trace, null, 2));

    const handleInfo = await page.evaluate(() => {
      const handle = document.querySelector<HTMLElement>('.drag-handle');
      const hidden = handle?.classList.contains('hide') ?? true;
      const handleRect = handle ? handle.getBoundingClientRect() : null;
      return {
        hidden,
        handleTop: handleRect ? handleRect.top : null,
        handleLeft: handleRect ? handleRect.left : null,
      };
    });
    console.log('hover position:', { hoverX, hoverY });
    console.log('handle info:', JSON.stringify(handleInfo));

    // Compare: handle should be near the trailing paragraph or last task,
    // NOT at the summary.
    expect(handleInfo.hidden).toBe(false);
    expect(handleInfo.handleTop).not.toBeNull();
    const handleY = handleInfo.handleTop ?? -1;
    const summaryMid = map.summary
      ? (map.summary.top + map.summary.bottom) / 2
      : map.details!.top + 16;
    const trailingMid = map.trailingP ? (map.trailingP.top + map.trailingP.bottom) / 2 : lastTask.bottom;
    const distToSummary = Math.abs(handleY - summaryMid);
    const distToTrailing = Math.abs(handleY - trailingMid);
    console.log('distToSummary:', distToSummary, 'distToTrailing:', distToTrailing);
    // Handle must be CLOSER to the trailing block than to the summary.
    expect(distToTrailing).toBeLessThan(distToSummary);
  });
});
