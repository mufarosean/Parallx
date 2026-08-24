/**
 * Diagnostic probe: panel relocation (field report — "panel move is broken").
 *
 * Exercises BOTH routes to a panel move — the palette commands and the
 * drag gesture (synthetic DragEvents through the real handlers) — and
 * captures a screenshot plus the serialized body tree at every step, so a
 * failure shows exactly what the layout became.
 */
import { test, expect } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

type Box = { x: number; y: number; w: number; h: number } | null;

async function shape(window: Page): Promise<{
  grid: Box; sidebar: Box; editor: Box; panel: Box; tree: unknown;
}> {
  return window.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const wb = (window as unknown as { __parallx_workbench__?: { serializeBodyTree?: () => unknown } }).__parallx_workbench__;
    return {
      grid: box('.workbench-grid'),
      sidebar: box('[data-part-id="workbench.parts.sidebar"]'),
      editor: box('[data-part-id="workbench.parts.editor"]'),
      panel: box('[data-part-id="workbench.parts.panel"]'),
      tree: wb?.serializeBodyTree?.() ?? 'no workbench hook',
    };
  });
}

async function snap(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  const s = await shape(window);
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(s, null, 2), contentType: 'application/json',
  });
  // Written to disk unconditionally — attachments vanish on pass, and the
  // whole point of this probe is LOOKING at the states.
  const fs = await import('node:fs');
  fs.mkdirSync('test-results/panel-probe', { recursive: true });
  fs.writeFileSync(`test-results/panel-probe/${name}.json`, JSON.stringify(s, null, 2));
  await window.screenshot({ path: `test-results/panel-probe/${name}.png` });
}

async function runCommand(window: Page, title: string): Promise<void> {
  await window.keyboard.press('Control+Shift+p');
  const input = window.locator('.command-palette-input');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.pressSequentially(title, { delay: 20 });
  await window.waitForTimeout(400);
  await window.locator('.command-palette-item').first().click();
  await window.waitForTimeout(500);
}

test.describe('panel relocation probe', () => {
  test('palette: panel to left edge and back to bottom', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);
    await snap(window, testInfo, '01-baseline');
    const before = await shape(window);
    expect(before.panel, 'panel visible at boot').not.toBeNull();
    expect(before.editor, 'editor visible at boot').not.toBeNull();
    // Baseline: panel is a bottom strip under the editor.
    expect(before.panel!.y).toBeGreaterThan(before.editor!.y);

    await runCommand(window, 'Move Panel To Left Edge');
    await snap(window, testInfo, '02-after-move-left');
    const left = await shape(window);

    expect(left.panel, 'panel exists after move-left').not.toBeNull();
    expect(left.editor, 'editor exists after move-left').not.toBeNull();
    // A left column: starts at the grid's left, spans the body height.
    expect(Math.abs(left.panel!.x - left.grid!.x)).toBeLessThanOrEqual(8);
    expect(left.panel!.h).toBeGreaterThan(left.grid!.h * 0.8);
    expect(left.panel!.w).toBeGreaterThan(40);
    expect(left.panel!.w).toBeLessThan(left.grid!.w * 0.6);
    // The editor sits to its right, not underneath it.
    expect(left.editor!.x).toBeGreaterThanOrEqual(left.panel!.x + left.panel!.w - 8);
    expect(left.editor!.w).toBeGreaterThan(100);

    await runCommand(window, 'Move Panel To Bottom Edge');
    await snap(window, testInfo, '03-after-move-bottom');
    const bottom = await shape(window);

    expect(bottom.panel, 'panel exists after move-bottom').not.toBeNull();
    // A bottom strip again: spans the grid width, sits below the editor.
    expect(bottom.panel!.w).toBeGreaterThan(bottom.grid!.w * 0.8);
    expect(bottom.panel!.y).toBeGreaterThan(bottom.editor!.y);
    expect(bottom.panel!.h).toBeGreaterThan(40);
  });

  test('drag: panel strip onto the sidebar stacks it there', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);
    await snap(window, testInfo, '04-before-drag-stack');

    const result = await window.evaluate(async () => {
      const strip = document.querySelector(
        '[data-part-id="workbench.parts.panel"] .view-container-tabs',
      ) as HTMLElement | null;
      const sidebar = document.querySelector(
        '[data-part-id="workbench.parts.sidebar"]',
      ) as HTMLElement | null;
      if (!strip) return 'no panel strip found';
      if (!sidebar) return 'no sidebar found';

      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): boolean => {
        const ev = new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        });
        return el.dispatchEvent(ev);
      };

      const s = strip.getBoundingClientRect();
      fire('dragstart', strip, s.left + 5, s.top + 5);

      const r = sidebar.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height * 0.7; // lower half, clear of the boundary sliver
      fire('dragover', sidebar, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('dragover', sidebar, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      const indicator = document.querySelector('.part-drop-overlay-indicator');
      const indicatorRect = indicator?.getBoundingClientRect();
      fire('drop', sidebar, x, y);
      fire('dragend', strip, x, y);
      return {
        indicator: indicator
          ? { x: indicatorRect!.x, y: indicatorRect!.y, w: indicatorRect!.width, h: indicatorRect!.height }
          : 'no indicator shown',
      };
    });
    await testInfo.attach('05-drag-result.json', {
      body: JSON.stringify(result, null, 2), contentType: 'application/json',
    });

    await window.waitForTimeout(500);
    await snap(window, testInfo, '06-after-drag-stack');
    const after = await shape(window);

    expect(after.panel, 'panel exists after drag-stack').not.toBeNull();
    expect(after.sidebar, 'sidebar exists after drag-stack').not.toBeNull();
    // A REAL stack: same column as the sidebar, below it, COLUMN-wide —
    // not the full-width bottom strip the edge hijack used to produce.
    expect(Math.abs(after.panel!.x - after.sidebar!.x)).toBeLessThanOrEqual(8);
    expect(after.panel!.y).toBeGreaterThan(after.sidebar!.y);
    expect(Math.abs(after.panel!.w - after.sidebar!.w),
      'panel width matches the column, not the window').toBeLessThanOrEqual(12);
    expect(after.editor!.x, 'editor sits beside the column')
      .toBeGreaterThanOrEqual(after.panel!.x + after.panel!.w - 8);
    // The column fills the body height (the void bug's regression check).
    const columnBottom = after.panel!.y + after.panel!.h;
    expect(columnBottom).toBeGreaterThan(after.grid!.y + after.grid!.h - 60);
  });

  test('drag: panel strip to the right edge becomes a right column', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);

    const result = await window.evaluate(async () => {
      const strip = document.querySelector(
        '[data-part-id="workbench.parts.panel"] .view-container-tabs',
      ) as HTMLElement | null;
      const grid = document.querySelector('.workbench-grid') as HTMLElement | null;
      if (!strip) return 'no panel strip found';
      if (!grid) return 'no grid found';

      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): void => {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        }));
      };

      const s = strip.getBoundingClientRect();
      fire('dragstart', strip, s.left + 5, s.top + 5);
      const g = grid.getBoundingClientRect();
      const x = g.right - 10; // inside the edge zone
      const y = g.top + g.height / 2;
      const targetEl = document.elementFromPoint(x, y) ?? grid;
      fire('dragover', targetEl, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('drop', targetEl, x, y);
      fire('dragend', strip, x, y);
      return 'dispatched';
    });
    await testInfo.attach('07-drag-edge-result.json', {
      body: JSON.stringify(result, null, 2), contentType: 'application/json',
    });

    await window.waitForTimeout(500);
    await snap(window, testInfo, '08-after-drag-right-edge');
    const after = await shape(window);

    expect(after.panel, 'panel exists after edge drag').not.toBeNull();
    // A right column: ends at the grid's right edge, spans the height.
    const panelRight = after.panel!.x + after.panel!.w;
    expect(Math.abs(panelRight - (after.grid!.x + after.grid!.w))).toBeLessThanOrEqual(8);
    expect(after.panel!.h).toBeGreaterThan(after.grid!.h * 0.8);
  });
});

test.describe('panel relocation probe — sequences', () => {
  test('drag beside the editor, then toggle hide/show recalls the spot', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);

    // Drag the panel onto the editor's LEFT half — split beside it.
    await window.evaluate(async () => {
      const strip = document.querySelector(
        '[data-part-id="workbench.parts.panel"] .view-container-tabs',
      ) as HTMLElement | null;
      const editor = document.querySelector(
        '[data-part-id="workbench.parts.editor"]',
      ) as HTMLElement | null;
      if (!strip || !editor) return;
      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): void => {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        }));
      };
      const s = strip.getBoundingClientRect();
      fire('dragstart', strip, s.left + 5, s.top + 5);
      const r = editor.getBoundingClientRect();
      const x = r.left + 40; // left band of the editor
      const y = r.top + r.height / 2;
      fire('dragover', editor, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('drop', editor, x, y);
      fire('dragend', strip, x, y);
    });
    await window.waitForTimeout(500);
    await snap(window, testInfo, '09-after-drag-beside-editor');
    const beside = await shape(window);
    expect(beside.panel, 'panel exists beside editor').not.toBeNull();
    expect(beside.panel!.x).toBeLessThan(beside.editor!.x);
    expect(beside.panel!.h).toBeGreaterThan(beside.grid!.h * 0.8);

    // Hide, then show: it must come back where it was put.
    await runCommand(window, 'Toggle Panel');
    await window.waitForTimeout(400);
    await snap(window, testInfo, '10-hidden');
    await runCommand(window, 'Toggle Panel');
    await window.waitForTimeout(400);
    await snap(window, testInfo, '11-reshown');
    const reshown = await shape(window);
    expect(reshown.panel, 'panel back after toggle').not.toBeNull();
    expect(reshown.panel!.x, 'recalled beside the editor, not the bottom').toBeLessThan(reshown.editor!.x);
  });

  test('repeated moves in one session stay coherent', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);
    await runCommand(window, 'Move Panel To Left Edge');
    await runCommand(window, 'Move Panel To Right Edge');
    await runCommand(window, 'Move Panel To Bottom Edge');
    await snap(window, testInfo, '12-after-cycle');
    const s = await shape(window);
    expect(s.panel, 'panel alive after the cycle').not.toBeNull();
    expect(s.editor, 'editor alive after the cycle').not.toBeNull();
    // Bottom strip, full width, editor above it.
    expect(s.panel!.w).toBeGreaterThan(s.grid!.w * 0.8);
    expect(s.panel!.y).toBeGreaterThan(s.editor!.y);
    // Nothing degenerate anywhere.
    expect(s.editor!.h).toBeGreaterThan(100);
    expect(s.panel!.h).toBeGreaterThan(40);
  });
});

test.describe('separation and reunion', () => {
  test('a floated container stacks back under the rail, and centre re-docks it', async ({ window }, testInfo) => {
    await window.waitForTimeout(1500);
    await runCommand(window, 'Reset Layout to Defaults');
    await window.waitForTimeout(300);

    // 1. Float the Explorer: drag its ribbon icon onto the editor.
    await window.evaluate(async () => {
      const icon = document.querySelector('[data-icon-id="view.explorer"]') as HTMLElement | null;
      const editor = document.querySelector('[data-part-id="workbench.parts.editor"]') as HTMLElement | null;
      if (!icon || !editor) return;
      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): void => {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        }));
      };
      const i = icon.getBoundingClientRect();
      fire('dragstart', icon, i.left + 5, i.top + 5);
      const r = editor.getBoundingClientRect();
      fire('dragover', editor, r.right - 60, r.top + r.height / 2);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('drop', editor, r.right - 60, r.top + r.height / 2);
      fire('dragend', icon, 0, 0);
    });
    await window.waitForTimeout(500);
    await snap(window, testInfo, '13-explorer-floated');
    const box = window.locator('.container-box[data-part-id="container:view.explorer"]');
    await expect(box, 'explorer floated into a box').toBeVisible();

    // 2. Put it BACK: drag the box header onto the sidebar's bottom band.
    await window.evaluate(async () => {
      const header = document.querySelector('.container-box[data-part-id="container:view.explorer"] .container-box-header') as HTMLElement | null;
      const sidebar = document.querySelector('[data-part-id="workbench.parts.sidebar"]') as HTMLElement | null;
      if (!header || !sidebar) return;
      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): void => {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        }));
      };
      const h = header.getBoundingClientRect();
      fire('dragstart', header, h.left + 5, h.top + 5);
      const r = sidebar.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height * 0.9; // bottom band → BESIDE, not dock
      fire('dragover', sidebar, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('drop', sidebar, x, y);
      fire('dragend', header, x, y);
    });
    await window.waitForTimeout(500);
    await snap(window, testInfo, '14-box-stacked-under-rail');

    const boxBb = await box.boundingBox();
    const sidebarBb = await window.locator('[data-part-id="workbench.parts.sidebar"]').boundingBox();
    expect(boxBb, 'box still exists after beside-drop').not.toBeNull();
    // Reunited: same column as the rail, below it, column-wide.
    expect(Math.abs(boxBb!.x - sidebarBb!.x)).toBeLessThanOrEqual(8);
    expect(boxBb!.y).toBeGreaterThan(sidebarBb!.y);
    expect(Math.abs(boxBb!.width - sidebarBb!.width)).toBeLessThanOrEqual(12);

    // 3. Centre still docks: drop the header mid-card and the box goes away.
    await window.evaluate(async () => {
      const header = document.querySelector('.container-box[data-part-id="container:view.explorer"] .container-box-header') as HTMLElement | null;
      const sidebar = document.querySelector('[data-part-id="workbench.parts.sidebar"]') as HTMLElement | null;
      if (!header || !sidebar) return;
      const dt = new DataTransfer();
      const fire = (type: string, el: Element, x: number, y: number): void => {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt,
        }));
      };
      const h = header.getBoundingClientRect();
      fire('dragstart', header, h.left + 5, h.top + 5);
      const r = sidebar.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2; // centre → dock
      fire('dragover', sidebar, x, y);
      await new Promise((res) => requestAnimationFrame(() => res(undefined)));
      fire('drop', sidebar, x, y);
      fire('dragend', header, x, y);
    });
    await window.waitForTimeout(500);
    await snap(window, testInfo, '15-box-redocked');
    await expect(box, 'box gone after centre dock').toHaveCount(0);

    await runCommand(window, 'Reset Layout to Defaults');
  });
});
