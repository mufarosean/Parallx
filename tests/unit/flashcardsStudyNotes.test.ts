// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — extension JavaScript
import { __testables } from '../../ext/flashcards/main.js';

const { fcCreateStudyNotes } = __testables;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const mount = (notes = '', generate = vi.fn().mockResolvedValue('**AI draft**'), persist = vi.fn().mockResolvedValue(undefined)) => {
  const card = { id: 7, front: 'Question', back: 'Answer', notes };
  const root = fcCreateStudyNotes(card, { generate, persist, render: (text: string) => {
    const body = document.createElement('article'); body.textContent = text; return body;
  } });
  document.body.appendChild(root);
  const click = (name: string) => {
    const btn = [...root.querySelectorAll('button')].find((b: any) => (b.getAttribute('aria-label') || b.textContent) === name) as HTMLButtonElement;
    expect(btn, name).toBeTruthy(); btn.click();
  };
  const type = (text: string) => {
    const input = root.querySelector('textarea'); input.value = text; input.dispatchEvent(new Event('input'));
  };
  return { card, root, click, type, generate, persist };
};
afterEach(() => document.body.replaceChildren());

describe('study notes document', () => {
  it('renders saved notes immediately, with no disclosure or always-visible editor', () => {
    const { root } = mount('Saved notes');
    expect(root.querySelector('article')?.textContent).toBe('Saved notes');
    expect(root.querySelector('details, textarea')).toBeNull();
  });
  it('previews and saves Markdown source explicitly, and can discard edits', async () => {
    const { root, card, click, type, persist } = mount();
    click('+ Add notes'); type('**Reasoning** $a/b$'); click('Preview');
    expect(root.textContent).not.toContain('AI draft');
    expect(persist).not.toHaveBeenCalled();
    click('Save notes'); await settle();
    expect(card.notes).toBe('**Reasoning** $a/b$');
    expect(root.querySelector('textarea')).toBeNull();
    click('Edit Notes'); type('Unwanted edit'); click('Discard');
    expect(card.notes).toBe('**Reasoning** $a/b$');
  });
  it('reviews an AI draft without replacing saved notes until Save', async () => {
    const { card, root, click, persist, generate } = mount('Original');
    click('Draft Notes with AI'); await settle();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ id: 7, notes: 'Original' }));
    expect(root.dataset.mode).toBe('draft');
    expect(card.notes).toBe('Original'); expect(persist).not.toHaveBeenCalled();
    click('Save notes'); await settle();
    expect(card.notes).toBe('**AI draft**');
  });
  it('ignores AI results after cancellation or removal of the card surface', async () => {
    let finish!: (text: string) => void;
    const generate = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const { card, root, click, persist } = mount('Original', generate);
    click('Draft Notes with AI'); click('Cancel'); finish('Too late'); await settle();
    expect(root.dataset.mode).toBe('read'); expect(root.textContent).not.toContain('Too late');
    click('Draft Notes with AI'); root.remove(); finish('Detached result'); await settle();
    expect(card.notes).toBe('Original'); expect(persist).not.toHaveBeenCalled();
  });
  it('retains the draft on save failure and shows generation errors without damaging notes', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const generate = vi.fn().mockRejectedValue(new Error('model unavailable'));
    const { card, root, click, type } = mount('Original', generate, persist);
    click('Draft Notes with AI'); await settle();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('model unavailable');
    click('Edit Notes'); type('Keep this draft'); click('Save notes'); await settle();
    expect(root.querySelector('textarea')?.value).toBe('Keep this draft');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('storage unavailable');
    expect(card.notes).toBe('Original');
  });
});
