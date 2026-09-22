// @vitest-environment jsdom
// The extension-facing context menu (`api.ui.showContextMenu`) is the SAME
// .context-menu the workbench draws, reached through showExtensionContextMenu.
// Media-organizer, browser and flashcards call it with the flat shape below.
// These pin the mapping they rely on: separators as group dividers, checked
// rows with a mark column on EVERY row, tooltips, submenus whose handlers still
// fire through the parent, element anchors, and onClose on both exit routes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { showExtensionContextMenu } from '../../src/ui/contextMenu';

afterEach(() => { document.body.innerHTML = ''; });

const rows = () => Array.from(document.querySelectorAll('.context-menu:not(.context-menu--submenu) > .context-menu-item')) as HTMLElement[];

describe('showExtensionContextMenu', () => {
  it('draws separators as group dividers and maps danger and disabled', () => {
    showExtensionContextMenu({ x: 5, y: 5 }, [
      { label: 'Open' }, { separator: true }, { label: 'Delete', danger: true }, { label: 'Locked', disabled: true },
    ]);
    expect(document.querySelectorAll('.context-menu-separator').length).toBe(1);
    const r = rows();
    expect(r.map((e) => e.textContent)).toEqual(['Open', 'Delete', 'Locked']);
    expect(r[1].classList.contains('context-menu-item--danger')).toBe(true);
    expect(r[2].classList.contains('context-menu-item--disabled')).toBe(true);
  });

  it('reserves a mark column on every row once any item is checkable, and marks the checked one', () => {
    showExtensionContextMenu({ x: 5, y: 5 }, [
      { label: 'Ascending', checked: true }, { label: 'Descending', checked: false }, { label: 'Group By Date' },
    ]);
    const menu = document.querySelector('.context-menu') as HTMLElement;
    expect(menu.classList.contains('context-menu--has-checks')).toBe(true);
    const marks = rows().map((r) => r.querySelector('.context-menu-item-check'));
    expect(marks.every(Boolean)).toBe(true);
    expect(marks[0]!.textContent).toBe('✓');
    expect(marks[1]!.textContent).toBe('');
    expect(rows()[0].getAttribute('aria-checked')).toBe('true');
    expect(rows()[0].getAttribute('role')).toBe('menuitemcheckbox');
    expect(rows()[2].getAttribute('role')).toBe('menuitem');
  });

  it('has no mark column when nothing is checkable', () => {
    showExtensionContextMenu({ x: 5, y: 5 }, [{ label: 'A' }, { label: 'B' }]);
    expect(document.querySelector('.context-menu--has-checks')).toBeNull();
    expect(document.querySelector('.context-menu-item-check')).toBeNull();
  });

  it('puts a tooltip on the row', () => {
    showExtensionContextMenu({ x: 5, y: 5 }, [{ label: 'Group By Date', disabled: true, tooltip: 'A feed has no day headers' }]);
    expect(rows()[0].title).toBe('A feed has no day headers');
  });

  it('runs the handler on click, closes, and fires onClose once', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    showExtensionContextMenu({ x: 5, y: 5 }, [{ label: 'Open', onSelect }], { onClose });
    rows()[0].click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose on dispose too', () => {
    const onClose = vi.fn();
    const handle = showExtensionContextMenu({ x: 5, y: 5 }, [{ label: 'Open' }], { onClose });
    handle.dispose();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opens a submenu on click; a submenu handler fires through the parent and closes everything', () => {
    const inner = vi.fn();
    showExtensionContextMenu({ x: 5, y: 5 }, [
      { label: 'Add To Album', submenu: [{ label: 'Holiday', onSelect: inner }, { label: 'Work' }] },
    ]);
    const parent = rows()[0];
    expect(parent.classList.contains('context-menu-item--has-submenu')).toBe(true);
    parent.click();
    const sub = document.querySelector('.context-menu--submenu') as HTMLElement;
    expect(sub).not.toBeNull();
    const subRows = Array.from(sub.querySelectorAll('.context-menu-item')) as HTMLElement[];
    expect(subRows.map((r) => r.textContent)).toEqual(['Holiday', 'Work']);
    subRows[0].click();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('accepts the element the menu belongs to as the anchor', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    expect(() => showExtensionContextMenu(btn, [{ label: 'Only' }])).not.toThrow();
    expect(document.querySelector('.context-menu')).not.toBeNull();
  });

  it('renders an icon through the injected renderer only when an item names one', () => {
    const renderIcon = vi.fn((icon: string, c: HTMLElement) => { c.textContent = `[${icon}]`; });
    showExtensionContextMenu({ x: 5, y: 5 }, [{ label: 'Star', icon: 'star' }, { label: 'Plain' }], undefined, renderIcon);
    expect(renderIcon).toHaveBeenCalledTimes(1);
    expect(rows()[0].querySelector('.context-menu-item-icon')!.textContent).toBe('[star]');
    expect(rows()[1].querySelector('.context-menu-item-icon')).toBeNull();
  });
});
