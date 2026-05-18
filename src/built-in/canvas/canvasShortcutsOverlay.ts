// canvasShortcutsOverlay.ts — Keyboard shortcut cheatsheet (M77 Phase 11.6)
//
// Notion-parity: pressing Ctrl+/ (or invoking the
// `canvas.showKeyboardShortcuts` command) opens a modal listing every
// keyboard interaction the canvas supports, grouped into sections. The
// shortcuts are sourced from:
//   • The block registry (`turnInto.shortcut` — Markdown-style triggers)
//   • A hard-coded list of global block shortcuts (Esc, Mod+D, etc.)
//   • Slash-menu and bubble-menu entries
//
// Why a curated list rather than a fully-derived one: keeping the
// shortcut copy in one place lets us write user-facing labels ("Toggle
// bold") that don't match the internal command id ("toggleBold"). The
// trade-off is hand-maintenance, mitigated by keeping the list short
// and structured.

import { $ } from '../../ui/dom.js';

interface Shortcut {
  readonly keys: string;     // human-formatted (e.g., "Ctrl+B")
  readonly label: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly entries: readonly Shortcut[];
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Block actions',
    entries: [
      { keys: 'Esc',                       label: 'Select the current block' },
      { keys: 'Shift+↑ / Shift+↓',         label: 'Extend block selection' },
      { keys: 'Enter',                     label: 'Edit the first selected block' },
      { keys: 'Backspace / Delete',        label: 'Delete the selected block(s)' },
      { keys: 'Ctrl+D',                    label: 'Duplicate the selected block(s)' },
      { keys: 'Ctrl+Shift+↑ / Ctrl+Shift+↓', label: 'Move the selected block(s)' },
    ],
  },
  {
    title: 'Text formatting',
    entries: [
      { keys: 'Ctrl+B',      label: 'Bold' },
      { keys: 'Ctrl+I',      label: 'Italic' },
      { keys: 'Ctrl+U',      label: 'Underline' },
      { keys: 'Ctrl+Shift+S', label: 'Strikethrough' },
      { keys: 'Ctrl+E',      label: 'Inline code' },
      { keys: 'Ctrl+\\',     label: 'Clear formatting' },
      { keys: 'Ctrl+Z',      label: 'Undo' },
      { keys: 'Ctrl+Y',      label: 'Redo' },
    ],
  },
  {
    title: 'Insert blocks',
    entries: [
      { keys: '/',          label: 'Open the block menu' },
      { keys: '# Space',    label: 'Heading 1' },
      { keys: '## Space',   label: 'Heading 2' },
      { keys: '### Space',  label: 'Heading 3' },
      { keys: '* Space',    label: 'Bulleted list' },
      { keys: '1. Space',   label: 'Numbered list' },
      { keys: '[ ] Space',  label: 'To-do' },
      { keys: '> Space',    label: 'Quote' },
      { keys: '``` Space',  label: 'Code block' },
      { keys: '--- Enter',  label: 'Divider' },
      { keys: '$ … $',      label: 'Inline equation' },
    ],
  },
  {
    title: 'Sidebar',
    entries: [
      { keys: 'F2',         label: 'Rename the selected page' },
      { keys: 'Delete',     label: 'Move the selected page to trash' },
      { keys: 'Type to find', label: 'Jump-focus to a page by title' },
    ],
  },
  {
    title: 'Help',
    entries: [
      { keys: 'Ctrl+/',     label: 'Show this list' },
    ],
  },
];

/**
 * Open the shortcut cheatsheet modal. Resolves when dismissed.
 */
export function showCanvasShortcutsOverlay(): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const backdrop = $('div.canvas-shortcuts-backdrop');
    const modal = $('div.canvas-shortcuts-modal');
    backdrop.appendChild(modal);

    const header = $('div.canvas-shortcuts-header');
    const title = $('div.canvas-shortcuts-title');
    title.textContent = 'Keyboard shortcuts';
    header.appendChild(title);
    const closeBtn = $('button.canvas-shortcuts-close') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => finish());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = $('div.canvas-shortcuts-body');
    for (const group of SHORTCUT_GROUPS) {
      const section = $('div.canvas-shortcuts-section');
      const heading = $('div.canvas-shortcuts-section-title');
      heading.textContent = group.title;
      section.appendChild(heading);

      const list = $('div.canvas-shortcuts-list');
      for (const sc of group.entries) {
        const row = $('div.canvas-shortcuts-row');
        const label = $('div.canvas-shortcuts-label');
        label.textContent = sc.label;
        const keys = $('div.canvas-shortcuts-keys');
        for (const part of formatKeys(sc.keys)) {
          const kbd = $('kbd.canvas-shortcuts-kbd');
          kbd.textContent = part;
          keys.appendChild(kbd);
        }
        row.appendChild(label);
        row.appendChild(keys);
        list.appendChild(row);
      }
      section.appendChild(list);
      body.appendChild(section);
    }
    modal.appendChild(body);

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    closeBtn.focus();
  });
}

/**
 * Split a shortcut string like "Ctrl+Shift+S" or "# Space" into the
 * tokens we want to render as separate kbd elements. We keep simple
 * spelling and avoid OS-specific glyphs to stay readable on screen
 * readers.
 */
function formatKeys(keys: string): string[] {
  // Treat slash, plus, and space as the only joiners. Each remaining
  // token gets its own kbd. We DON'T break on '+' inside multi-letter
  // tokens like "Backspace" so plus signs in chord strings are the
  // canonical join.
  return keys
    .split(/\s*[+/]\s*/) // join via "+" or "/"
    .flatMap((token) => token.split(/\s+/))
    .filter((s) => s.length > 0);
}
