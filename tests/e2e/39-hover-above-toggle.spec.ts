/**
 * Diagnostic: hover ABOVE a toggle that contains a task list.
 * Trace what posAtCoords returns and what node the resolver picks
 * so we can fix the actual root cause.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';

test.describe('Hover above toggle', () => {

  test('hovering above Road Safety must not anchor handle to Spare Tire', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed?.commands.setContent({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hidden content above' }] },
          {
            type: 'details',
            attrs: { open: true },
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: 'Road Safety' }] },
              {
                type: 'detailsContent',
                content: [{
                  type: 'taskList',
                  content: [
                    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spare Tire - check pressure' }] }] },
                    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Portable Battery Charger' }] }] },
                    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Portable Drill' }] }] },
                  ],
                }],
              },
            ],
          },
        ],
      });
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const d = document.querySelector<HTMLDetailsElement>('.tiptap details');
      if (d) d.open = true;
    });
    await page.waitForTimeout(200);

    const geom = await page.evaluate(() => {
      const para = document.querySelector<HTMLElement>('.tiptap > p');
      const toggle = document.querySelector<HTMLElement>('.tiptap details, .tiptap [data-type="details"]');
      const firstTask = document.querySelector<HTMLElement>('.tiptap ul[data-type="taskList"] > li');
      return {
        paragraphBottom: para?.getBoundingClientRect().bottom ?? null,
        toggleTop: toggle?.getBoundingClientRect().top ?? null,
        toggleLeft: toggle?.getBoundingClientRect().left ?? null,
        firstTaskTop: firstTask?.getBoundingClientRect().top ?? null,
      };
    });
    console.log('geom:', JSON.stringify(geom));

    // Hover in the gap ABOVE the toggle (cursor below paragraph, above toggle top).
    const gapY = (geom.paragraphBottom! + geom.toggleTop!) / 2;
    const hoverX = geom.toggleLeft! + 100;
    await page.mouse.move(hoverX, gapY);
    await page.waitForTimeout(200);

    const trace = await page.evaluate(({ x, y }) => {
      const ed = (window as any).__tiptapEditor;
      const view = ed.view;
      const hitResult = view.posAtCoords({ left: x, top: y });
      const $pos = hitResult ? view.state.doc.resolve(hitResult.pos) : null;
      const path: string[] = [];
      if ($pos) {
        for (let d = 0; d <= $pos.depth; d++) {
          path.push(`${$pos.node(d).type.name}@${d}`);
        }
      }
      const handle = document.querySelector<HTMLElement>('.drag-handle');
      const handleHidden = handle?.classList.contains('hide') ?? true;
      const handleTop = handle ? handle.getBoundingClientRect().top : null;
      const elt = document.elementFromPoint(x, y) as HTMLElement | null;
      return {
        hoverX: x,
        hoverY: y,
        hitResult,
        posPath: path,
        handleHidden,
        handleTop,
        eltTag: elt?.tagName,
        eltClass: elt?.className,
        eltText: (elt?.textContent || '').slice(0, 40),
      };
    }, { x: hoverX, y: gapY });
    console.log('TRACE above toggle:', JSON.stringify(trace, null, 2));

    // Find positions of the various candidate blocks so we can interpret
    // where the handle landed.
    const blocks = await page.evaluate(() => {
      const para = document.querySelector<HTMLElement>('.tiptap > p');
      const toggle = document.querySelector<HTMLElement>('.tiptap details, .tiptap [data-type="details"]');
      const summary = document.querySelector<HTMLElement>('.tiptap summary, .tiptap [data-type="detailsSummary"]');
      const firstTask = document.querySelector<HTMLElement>('.tiptap ul[data-type="taskList"] > li');
      return {
        paragraphTop: para?.getBoundingClientRect().top ?? null,
        toggleTop: toggle?.getBoundingClientRect().top ?? null,
        summaryTop: summary?.getBoundingClientRect().top ?? null,
        firstTaskTop: firstTask?.getBoundingClientRect().top ?? null,
      };
    });
    console.log('candidate tops:', JSON.stringify(blocks));

    expect(trace.handleHidden).toBe(false);
    // Handle MUST NOT anchor down at the first taskItem (Spare Tire row).
    // Anchoring at the toggle title (Road Safety / summary row) is OK —
    // that's correctly "grab the whole toggle" gesture territory.
    const handleY = trace.handleTop!;
    const onFirstTaskRow = Math.abs(handleY - blocks.firstTaskTop!) < 8;
    expect(onFirstTaskRow).toBe(false);
  });
});
