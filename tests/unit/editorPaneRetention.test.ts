// @vitest-environment jsdom
//
// M101 seamless tabs — pane retention in EditorGroupView.
//
// Switching tabs used to dispose the outgoing pane and rebuild the incoming
// one from scratch: revealed flashcard answers reset, canvas flashed
// title-then-content, duplicate scans re-ran. These tests pin the new
// contract: panes stay alive (hidden) across switches and are disposed only
// on tab close, LRU eviction beyond the cap, or group disposal.

import { describe, it, expect } from 'vitest';
import { EditorGroupView } from '../../src/editor/editorGroupView';
import { PlaceholderEditorInput, type IEditorInput } from '../../src/editor/editorInput';
import { EditorPane, type EditorPaneViewState } from '../../src/editor/editorPane';

// jsdom has no scrollIntoView; the tab bar calls it on every render.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => { /* noop */ });

/** Flush the microtask/timeout chain _showActiveEditor rides on. */
const settle = () => new Promise((r) => setTimeout(r, 0));

class ProbePane extends EditorPane {
  static created: ProbePane[] = [];
  disposed = false;
  renders = 0;
  restoredWith: EditorPaneViewState | undefined;
  scrollTop = 0;

  constructor() {
    super();
    ProbePane.created.push(this);
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('probe-pane');
  }

  protected override async renderInput(): Promise<void> {
    this.renders++;
  }

  protected override savePaneViewState(): EditorPaneViewState {
    return { scrollTop: this.scrollTop };
  }

  protected override restorePaneViewState(state: EditorPaneViewState): void {
    this.restoredWith = state;
  }

  override dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}

function makeGroup() {
  ProbePane.created = [];
  const group = new EditorGroupView(undefined, () => new ProbePane());
  document.body.appendChild(group.element);
  return group;
}

function paneFor(input: IEditorInput): ProbePane | undefined {
  return ProbePane.created.find((p) => p.input?.id === input.id && !p.disposed);
}

describe('editor pane retention (seamless tab switching)', () => {
  it('switching away and back reuses the SAME pane instance — no rebuild', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');

    await group.openEditor(a, { pinned: true });
    await settle();
    await group.openEditor(b, { pinned: true });
    await settle();
    expect(ProbePane.created).toHaveLength(2);

    const paneA = ProbePane.created[0];
    // A is hidden, not disposed — its DOM and state are intact.
    expect(paneA.disposed).toBe(false);
    expect(paneA.element?.classList.contains('hidden')).toBe(true);

    await group.openEditor(a, { pinned: true });
    await settle();
    // No third pane was built; A's pane was revealed as-is.
    expect(ProbePane.created).toHaveLength(2);
    expect(group.activePane).toBe(paneA);
    expect(paneA.element?.classList.contains('hidden')).toBe(false);
    expect(paneA.renders).toBe(1); // setInput ran once, at first mount
    // The other pane went hidden.
    expect(ProbePane.created[1].element?.classList.contains('hidden')).toBe(true);

    group.dispose();
  });

  it('closing a tab disposes its retained pane', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');
    await group.openEditor(a, { pinned: true });
    await settle();
    await group.openEditor(b, { pinned: true });
    await settle();

    const paneA = paneFor(a)!;
    await group.closeEditor(a);
    await settle();

    expect(paneA.disposed).toBe(true);
    expect(paneA.element?.isConnected).toBe(false);
    // B is still alive and active.
    expect(paneFor(b)?.disposed).toBe(false);

    group.dispose();
  });

  it('closing the ACTIVE tab disposes its pane and reveals the neighbor', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');
    await group.openEditor(a, { pinned: true });
    await settle();
    await group.openEditor(b, { pinned: true });
    await settle();

    const paneB = paneFor(b)!;
    await group.closeEditor(b);
    await settle();

    expect(paneB.disposed).toBe(true);
    expect(group.activePane).toBe(paneFor(a));
    expect(paneFor(a)?.element?.classList.contains('hidden')).toBe(false);

    group.dispose();
  });

  it('evicts the least-recently-shown pane beyond the cap, keeping its view state', async () => {
    const group = makeGroup();
    const inputs = Array.from({ length: 9 }, (_, i) => new PlaceholderEditorInput(`T${i}`));

    for (const input of inputs) {
      await group.openEditor(input, { pinned: true });
      await settle();
      // Give each pane a distinct scroll position before switching away.
      (group.activePane as ProbePane).scrollTop = 100 + inputs.indexOf(input);
    }

    // 9 opened, cap is 7 → the two oldest (T0, T1) are disposed.
    const alive = ProbePane.created.filter((p) => !p.disposed);
    expect(alive).toHaveLength(7);
    expect(paneFor(inputs[0])).toBeUndefined();
    expect(paneFor(inputs[1])).toBeUndefined();
    expect(paneFor(inputs[2])).toBeDefined();

    // Returning to an evicted tab rebuilds — WITH its saved view state.
    await group.openEditor(inputs[0], { pinned: true });
    await settle();
    const rebuilt = paneFor(inputs[0])!;
    expect(rebuilt.renders).toBe(1);
    expect(rebuilt.restoredWith).toEqual({ scrollTop: 100 });

    group.dispose();
  });

  it('group disposal disposes every retained pane', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');
    await group.openEditor(a, { pinned: true });
    await settle();
    await group.openEditor(b, { pinned: true });
    await settle();

    group.dispose();
    expect(ProbePane.created.every((p) => p.disposed)).toBe(true);
  });

  it('preview-replace (unpinned open swapping the preview tab) prunes the replaced pane', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');

    // Both open as PREVIEW: opening B silently replaces A in the model with
    // no EditorClose event. The reconciliation prune must dispose A's pane —
    // otherwise it leaks alive, bound to a disposed input.
    await group.openEditor(a);
    await settle();
    const paneA = paneFor(a)!;
    await group.openEditor(b);
    await settle();

    expect(paneA.disposed).toBe(true);
    expect(paneA.element?.isConnected).toBe(false);
    expect(paneFor(b)?.disposed).toBe(false);

    group.dispose();
  });

  it('re-activating the already-active tab neither rebuilds nor hides the pane', async () => {
    const group = makeGroup();
    const a = new PlaceholderEditorInput('A');
    await group.openEditor(a, { pinned: true });
    await settle();
    const paneA = paneFor(a)!;

    await group.openEditor(a, { pinned: true });
    await settle();

    expect(ProbePane.created).toHaveLength(1);
    expect(group.activePane).toBe(paneA);
    expect(paneA.element?.classList.contains('hidden')).toBe(false);

    group.dispose();
  });
});
