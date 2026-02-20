/**
 * Focused E2E test: Equation (MathBlock) drag-and-drop via GlobalDragHandle.
 *
 * Tests two things:
 * 1. The drag handle correctly initiates drag on atom nodes (MathBlock).
 *    GlobalDragHandle uses posAtCoords().inside which returns -1 for atoms.
 *    The fix ensures the library's own handleDragStart works after
 *    removing the content hole from MathBlock's renderHTML.
 *
 * 2. ProseMirror can move a MathBlock node to a different position,
 *    proving the schema allows atom node repositioning.
 *
 * Note: HTML5 drag-and-drop drop events cannot be reliably simulated
 * via synthetic events in Playwright/Electron. We test the drag INITIATION
 * (which was the broken part) and the node MOVEMENT separately.
 */
import { sharedTest as test, expect, setupCanvasPage } from './fixtures';

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Equation Block Drag-and-Drop', () => {

  test('drag handle correctly initiates drag for MathBlock atom node', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    // Capture console output
    const consoleLogs: string[] = [];
    window.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[AtomDrag]')) consoleLogs.push(text);
    });

    await setupCanvasPage(window, electronApp, workspacePath);

    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await window.waitForTimeout(200);

    // Wait for TipTap editor to be exposed
    await window.waitForFunction(
      () => (window as any).__tiptapEditor != null,
      { timeout: 10_000 },
    );

    // Set up document: [P "First"] [P "Second"] [MathBlock] [P "Fourth"]
    await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) throw new Error('No TipTap editor');
      editor.commands.setContent({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
          { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Fourth paragraph' }] },
        ],
      });
    });
    await window.waitForTimeout(500);

    // Verify math block is rendered
    const mathBlock = tiptap.locator('[data-type="mathBlock"]');
    await expect(mathBlock).toBeVisible({ timeout: 5_000 });

    // Verify initial structure
    const structBefore = await window.evaluate(() => {
      const pmEl = document.querySelector('.ProseMirror');
      if (!pmEl) return [];
      return Array.from(pmEl.children).map((el) => {
        const htmlEl = el as HTMLElement;
        return htmlEl.getAttribute('data-type') === 'mathBlock'
          ? 'mathBlock'
          : htmlEl.tagName === 'P'
            ? `p:${htmlEl.textContent?.trim()}`
            : htmlEl.tagName.toLowerCase();
      });
    });
    console.log('Structure BEFORE:', structBefore);
    expect(structBefore).toEqual([
      'p:First paragraph',
      'p:Second paragraph',
      'mathBlock',
      'p:Fourth paragraph',
    ]);

    // ── Test 1: Drag handle initiation ──
    // Hover over math block to show drag handle
    await mathBlock.hover();
    await window.waitForTimeout(500);

    const dragHandle = window.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });

    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    if (!handleBox) throw new Error('No handle box');

    // Dispatch a synthetic dragstart on the handle and verify view.dragging is set
    const dragSetup = await window.evaluate(({ hx, hy }) => {
      const handle = document.querySelector('.drag-handle') as HTMLElement;
      if (!handle) return { error: 'no handle' };

      const dt = new DataTransfer();
      const dsEvent = new DragEvent('dragstart', {
        clientX: hx, clientY: hy, dataTransfer: dt, bubbles: true, cancelable: true,
      });
      handle.dispatchEvent(dsEvent);

      const editor = (window as any).__tiptapEditor;
      const view = editor?.view;
      const dragging = (view as any)?.dragging;

      return {
        draggingSet: !!dragging,
        sliceExists: !!dragging?.slice,
        sliceNodeType: dragging?.slice?.content?.firstChild?.type?.name ?? null,
      };
    }, {
      hx: handleBox.x + handleBox.width / 2,
      hy: handleBox.y + handleBox.height / 2,
    });

    console.log('Drag setup result:', dragSetup);
    console.log('Console logs:', consoleLogs);

    // CRITICAL: The drag must be properly initiated with the right node
    expect(dragSetup.draggingSet).toBe(true);
    expect(dragSetup.sliceExists).toBe(true);
    expect(dragSetup.sliceNodeType).toBe('mathBlock');

    // ── Test 2: MathBlock can be moved via ProseMirror transaction ──
    // This proves the schema allows moving mathBlock nodes.
    // In real usage, ProseMirror's native drop handler performs this move
    // after the drag handle initiates the drag (tested above).
    const structAfterMove = await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) return [];
      const view = editor.view;
      const { state } = view;

      // Clear dragging state first
      (view as any).dragging = null;

      // Find the mathBlock position
      let mathPos = -1;
      state.doc.forEach((node: any, offset: number) => {
        if (node.type.name === 'mathBlock') mathPos = offset;
      });
      if (mathPos === -1) return ['ERROR: mathBlock not found'];

      const mathNode = state.doc.nodeAt(mathPos);
      if (!mathNode) return ['ERROR: no node at mathPos'];

      // Move mathBlock to position 0 (before the first paragraph)
      // Same operation ProseMirror's drop handler performs:
      // 1. Delete the node from its current position
      // 2. Insert it at the target position
      const tr = state.tr;
      const content = mathNode.copy(mathNode.content);
      tr.delete(mathPos, mathPos + mathNode.nodeSize);
      tr.insert(0, content);
      view.dispatch(tr);

      // Return the new structure
      const pmEl = document.querySelector('.ProseMirror');
      if (!pmEl) return [];
      return Array.from(pmEl.children).map((el) => {
        const htmlEl = el as HTMLElement;
        return htmlEl.getAttribute('data-type') === 'mathBlock'
          ? 'mathBlock'
          : htmlEl.tagName === 'P'
            ? `p:${htmlEl.textContent?.trim()}`
            : htmlEl.tagName.toLowerCase();
      });
    });

    console.log('Structure AFTER move:', structAfterMove);

    // The mathBlock should now be at position 0
    expect(structAfterMove).toEqual([
      'mathBlock',
      'p:First paragraph',
      'p:Second paragraph',
      'p:Fourth paragraph',
    ]);
  });
});
