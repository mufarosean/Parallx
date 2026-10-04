// @vitest-environment jsdom
// The callout redrew its icon on every update; the new SVG was a DOM
// mutation that re-rendered the node again, so the icon was replaced in a
// loop and a click on it hit a detached SVG: the icon picker never opened.
import { describe, it, expect } from 'vitest';
import { mk, p } from './canvasMatrixHarness';

const callout = (emoji: string) => ({ type: 'callout', attrs: { emoji }, content: [p('Icon me')] });

describe('callout icon', () => {
  it('keeps the same icon element across updates that do not change the icon', () => {
    const ed = mk({ type: 'doc', content: [callout('lightbulb'), p('after')] });
    const svgBefore = ed.view.dom.querySelector('.canvas-callout-emoji svg');
    ed.commands.setTextSelection(4);
    ed.commands.insertContent('typed ');
    const svgAfter = ed.view.dom.querySelector('.canvas-callout-emoji svg');
    expect(svgAfter).toBe(svgBefore);
  });

  it('redraws when the icon changes', () => {
    const ed = mk({ type: 'doc', content: [callout('lightbulb')] });
    const svgBefore = ed.view.dom.querySelector('.canvas-callout-emoji svg');
    ed.view.dispatch(ed.state.tr.setNodeAttribute(0, 'emoji', 'rocket'));
    expect(ed.view.dom.querySelector('.canvas-callout-emoji svg')).not.toBe(svgBefore);
  });
});
