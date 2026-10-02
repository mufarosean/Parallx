// @vitest-environment jsdom
// The app-wide tooltip must show an element's CURRENT title, even when the
// title changed after the first hover (the engine chip after a model switch).
import { describe, it, expect, vi } from 'vitest';
import { installGlobalTooltipDelegate } from '../../src/ui/tooltip';
import { chipTooltip } from '../../src/built-in/chat/widgets/chatEngineChip';

describe('tooltip delegate', () => {
  it('shows the new title after the title changes', async () => {
    vi.useFakeTimers();
    installGlobalTooltipDelegate();
    const chip = document.createElement('button');
    chip.title = 'gemma4:26b · 256K';
    const other = document.createElement('div');
    document.body.append(chip, other);
    const hover = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const leave = (el: Element) => el.dispatchEvent(new MouseEvent('mouseleave'));
    hover(chip); await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.parallx-tooltip')?.textContent).toBe('gemma4:26b · 256K');
    leave(chip); hover(other); await vi.advanceTimersByTimeAsync(2000);
    chip.title = 'qwen3.8:27b · 160K';
    hover(chip); await vi.advanceTimersByTimeAsync(2000);
    expect(document.querySelector('.parallx-tooltip')?.textContent).toBe('qwen3.8:27b · 160K');
    vi.useRealTimers();
  });
});

describe('engine chip tooltip', () => {
  it('names the same model and size as the label', () => {
    expect(chipTooltip('qwen3.8:27b', 163_840, 0, ['On the graphics card'])).toBe('qwen3.8:27b · 160K. Nothing used yet. On the graphics card.');
    expect(chipTooltip('q', 65_536, 0, ['Partly on the CPU, so slower. A smaller size may fit on the graphics card.'])).toBe('q · 64K. Nothing used yet. Partly on the CPU, so slower. A smaller size may fit on the graphics card.');
    expect(chipTooltip('qwen3.8:27b', 163_840, 16_700, [])).toBe('qwen3.8:27b · 160K. 16.3K of 160K used.');
  });
});
