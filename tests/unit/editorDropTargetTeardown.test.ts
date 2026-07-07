// @vitest-environment jsdom
//
// Regression: the drag-to-split drop overlay must be torn down when the drag
// ENDS even if `dragend` never fires on the source tab (Chromium drops it when
// the source element is removed by the split/move). Otherwise the overlay —
// position:absolute; inset:0; z-index:10000; pointer-events:auto — stays over
// the pane and swallows scroll/clicks (the "blue dot blocks the PDF" bug).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorDropTarget } from '../../src/editor/editorDropTarget';
import { EDITOR_TAB_DRAG_TYPE } from '../../src/editor/editorTypes';

function makeDragEvent(type: string): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    configurable: true,
    value: { types: [EDITOR_TAB_DRAG_TYPE], dropEffect: '', getData: () => '' },
  });
  Object.defineProperty(ev, 'clientX', { configurable: true, value: 100 });
  Object.defineProperty(ev, 'clientY', { configurable: true, value: 100 });
  return ev;
}

describe('EditorDropTarget overlay teardown', () => {
  let container: HTMLElement;
  let pane: HTMLElement;
  let target: EditorDropTarget;

  beforeEach(() => {
    container = document.createElement('div');
    const group = document.createElement('div');
    group.classList.add('editor-group');
    group.setAttribute('data-editor-group-id', 'g1');
    pane = document.createElement('div');
    pane.classList.add('editor-pane-container');
    group.appendChild(pane);
    container.appendChild(group);
    document.body.appendChild(container);
    // jsdom has no layout — give the container a real rect so the
    // "cursor left the container" dragover guard doesn't fire spuriously.
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    target = new EditorDropTarget(container);
  });

  afterEach(() => {
    target.dispose();
    container.remove();
    vi.useRealTimers();
  });

  /** Simulate dragging a tab over the group's pane → creates the overlay. */
  function startDragOverPane(): void {
    pane.dispatchEvent(makeDragEvent('dragover'));
  }

  it('creates a drop overlay while dragging a tab over the pane', () => {
    startDragOverPane();
    expect(container.querySelector('.editor-drop-overlay')).not.toBeNull();
  });

  it('sweeps the overlay on a document-level drop (source tab removed → no dragend)', () => {
    vi.useFakeTimers();
    startDragOverPane();
    expect(container.querySelector('.editor-drop-overlay')).not.toBeNull();

    // Drop happens somewhere that ISN'T the overlay (e.g. a tab), and the move
    // removes the source tab so no `dragend` fires on it.
    document.dispatchEvent(new Event('drop', { bubbles: true }));
    vi.advanceTimersByTime(0); // deferred sweep runs after target handlers

    expect(container.querySelector('.editor-drop-overlay')).toBeNull();
  });

  it('sweeps the overlay on a document-level dragend (drag cancelled)', () => {
    startDragOverPane();
    expect(container.querySelector('.editor-drop-overlay')).not.toBeNull();

    document.dispatchEvent(new Event('dragend', { bubbles: true }));

    expect(container.querySelector('.editor-drop-overlay')).toBeNull();
  });
});
