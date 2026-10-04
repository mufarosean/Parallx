// @vitest-environment jsdom
// Canvas assessment 2026-10-03: "Start with a blank page" in the template
// picker did the same as Cancel (nothing).
import { describe, it, expect } from 'vitest';
import { showCanvasTemplatePicker } from '../../src/built-in/canvas/canvasTemplatePicker';

async function open() {
  const pending = showCanvasTemplatePicker({});
  await new Promise((r) => setTimeout(r, 0));
  return pending;
}

describe('template picker', () => {
  it('"Start with a blank page" asks for a blank page', async () => {
    const pending = open();
    await new Promise((r) => setTimeout(r, 5));
    (document.querySelector('.canvas-template-picker-blank') as HTMLButtonElement).click();
    const result = await pending;
    expect(result.blank).toBe(true);
    expect(result.template).toBeNull();
  });

  it('Cancel asks for nothing', async () => {
    const pending = open();
    await new Promise((r) => setTimeout(r, 5));
    (document.querySelector('.canvas-template-picker-cancel') as HTMLButtonElement).click();
    const result = await pending;
    expect(result.blank).toBeFalsy();
    expect(result.template).toBeNull();
  });
});
