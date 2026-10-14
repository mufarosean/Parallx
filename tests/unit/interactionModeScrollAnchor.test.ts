// @vitest-environment jsdom
// interactionModeScrollAnchor.test.ts — a popup that hangs from something
// closes when a scroll moves it, not when a log panel elsewhere scrolls
// (a menu used to snap shut whenever any view auto-scrolled).

import { describe, it, expect, vi } from 'vitest';
import { enterMode } from '../../src/ui/interactionMode';

describe('scroll exits follow the anchor', () => {
  it('stays for an unrelated scroller and exits for the one holding its anchor', () => {
    const page = document.createElement('div');
    const anchor = document.createElement('button');
    page.appendChild(anchor);
    const log = document.createElement('div');
    const menu = document.createElement('div');
    document.body.append(page, log, menu);
    const onExit = vi.fn();
    const mode = enterMode({ id: 'test-menu', ownedRoots: () => [menu], onExit, exitOnScroll: true, scrollAnchor: () => anchor });
    log.dispatchEvent(new Event('scroll'));
    expect(onExit).not.toHaveBeenCalled();
    page.dispatchEvent(new Event('scroll'));
    expect(onExit).toHaveBeenCalledWith('scroll');
    mode.exit();
  });
});
