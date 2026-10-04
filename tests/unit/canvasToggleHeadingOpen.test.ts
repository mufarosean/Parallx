// @vitest-environment jsdom
// Canvas assessment 2026-10-03, broken features: toggle headings loaded with
// their body hidden while the chevron said open; Enter moved the caret into
// the hidden body; the open state was not saved.
import { describe, it, expect } from 'vitest';
import { mk, p, t, press } from './canvasMatrixHarness';

const toggle = (open?: boolean) => ({
  type: 'toggleHeading', attrs: { level: 2, ...(open === undefined ? {} : { open }) },
  content: [{ type: 'toggleHeadingText', content: [t('Title')] }, { type: 'detailsContent', content: [p('Body')] }],
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const body = (ed: any) => ed.view.dom.querySelector('.canvas-toggle-heading [data-type="detailsContent"]') as HTMLElement;
const wrap = (ed: any) => ed.view.dom.querySelector('.canvas-toggle-heading') as HTMLElement;
const titleEnd = (ed: any) => { let at = -1; ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'toggleHeadingText') at = pos + 1 + n.content.size; }); return at; };

describe('toggle heading open state', () => {
  it('an existing toggle heading loads open, with its body shown', async () => {
    const ed = mk({ type: 'doc', content: [toggle(), p('after')] });
    await flush();
    expect(wrap(ed).classList.contains('is-open')).toBe(true);
    expect(body(ed).hasAttribute('hidden')).toBe(false);
  });

  it('a toggle heading saved closed loads closed', async () => {
    const ed = mk({ type: 'doc', content: [toggle(false), p('after')] });
    await flush();
    expect(wrap(ed).classList.contains('is-open')).toBe(false);
    expect(body(ed).hasAttribute('hidden')).toBe(true);
  });

  it('the chevron closes and opens it, and the state is saved with the page', async () => {
    const ed = mk({ type: 'doc', content: [toggle(), p('after')] });
    await flush();
    const chevron = ed.view.dom.querySelector('.toggle-heading-chevron') as HTMLButtonElement;
    chevron.click(); await flush();
    expect(ed.getJSON().content![0]!.attrs!.open).toBe(false);
    expect(body(ed).hasAttribute('hidden')).toBe(true);
    chevron.click(); await flush();
    expect(ed.getJSON().content![0]!.attrs!.open).toBe(true);
    expect(body(ed).hasAttribute('hidden')).toBe(false);
  });

  it('Enter at the end of a closed title adds a paragraph after the toggle', async () => {
    const ed = mk({ type: 'doc', content: [toggle(false), p('after')] });
    await flush();
    ed.commands.setTextSelection(titleEnd(ed));
    press(ed, 'Enter');
    const json = ed.getJSON();
    expect(json.content!.map((n: any) => n.type)).toEqual(['toggleHeading', 'paragraph', 'paragraph']);
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(ed.state.selection.$from.depth).toBe(1);
  });

  it('Enter at the end of an open title goes into the body', async () => {
    const ed = mk({ type: 'doc', content: [toggle(true), p('after')] });
    await flush();
    ed.commands.setTextSelection(titleEnd(ed));
    press(ed, 'Enter');
    expect(ed.state.selection.$from.node(ed.state.selection.$from.depth - 1).type.name).toBe('detailsContent');
  });

  it('the caret never lands inside a closed body', async () => {
    const ed = mk({ type: 'doc', content: [toggle(false), p('after')] });
    await flush();
    let inBody = -1;
    ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'detailsContent') inBody = pos + 2; });
    ed.commands.setTextSelection(inBody);
    const $from = ed.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) expect($from.node(d).type.name).not.toBe('detailsContent');
  });
});
