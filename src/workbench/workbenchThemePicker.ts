/**
 * Color Theme Picker — extracted from workbench.ts.
 *
 * Shows a quick-pick-style overlay listing all available themes grouped by
 * type (dark / light / high-contrast) with live preview via arrow keys,
 * revert on Escape, and persist on Enter/click.
 *
 * VS Code reference: SelectColorThemeAction in
 * src/vs/workbench/contrib/themes/browser/themes.contribution.ts
 */

import type { ThemeService } from '../services/themeService.js';
import type { ThemeCatalogEntry } from '../theme/themeCatalog.js';
import { colorRegistry } from '../theme/colorRegistry.js';
import {
  getAvailableThemes,
  findThemeById,
  resolveTheme,
  THEME_STORAGE_KEY,
} from '../theme/themeCatalog.js';

// ── Types ────────────────────────────────────────────────────────────────

interface PickerItem {
  themeEntry: ThemeCatalogEntry;
  isSeparator: false;
  label: string;
}

interface PickerSeparator {
  isSeparator: true;
  label: string;
}

type PickerRow = PickerItem | PickerSeparator;

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Show the color-theme picker overlay.
 *
 * @param container  DOM element to append the overlay to (typically the workbench container).
 * @param themeService  The live ThemeService instance (used for preview / apply).
 */
export function showColorThemePicker(
  container: HTMLElement,
  themeService: ThemeService,
): void {
  const previousThemeId = themeService.activeTheme.id;
  const allThemes = getAvailableThemes();

  // ── Build groups ─────────────────────────────────────────────────────
  const darkThemes = allThemes.filter(t => t.uiTheme === 'vs-dark');
  const lightThemes = allThemes.filter(t => t.uiTheme === 'vs');
  const hcThemes = allThemes.filter(t => t.uiTheme === 'hc-black' || t.uiTheme === 'hc-light');

  // ── Overlay DOM ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.classList.add('theme-picker-overlay');

  const box = document.createElement('div');
  box.classList.add('theme-picker-box');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Select Color Theme (Up/Down Keys to Preview)';
  input.classList.add('theme-picker-input');
  box.appendChild(input);

  const list = document.createElement('div');
  list.classList.add('theme-picker-list');
  box.appendChild(list);

  overlay.appendChild(box);
  container.appendChild(overlay);
  input.focus();

  // ── Rows ─────────────────────────────────────────────────────────────
  const rows: PickerRow[] = [];
  if (darkThemes.length) {
    rows.push({ isSeparator: true, label: 'dark themes' });
    for (const t of darkThemes) rows.push({ themeEntry: t, isSeparator: false, label: t.label });
  }
  if (lightThemes.length) {
    rows.push({ isSeparator: true, label: 'light themes' });
    for (const t of lightThemes) rows.push({ themeEntry: t, isSeparator: false, label: t.label });
  }
  if (hcThemes.length) {
    rows.push({ isSeparator: true, label: 'high contrast themes' });
    for (const t of hcThemes) rows.push({ themeEntry: t, isSeparator: false, label: t.label });
  }

  // ── State ────────────────────────────────────────────────────────────
  let highlightIndex = -1;
  let visibleItems: PickerItem[] = [];

  // ── Helpers ──────────────────────────────────────────────────────────

  const renderItems = (filter: string): void => {
    list.innerHTML = '';
    visibleItems = [];
    const lowerFilter = filter.toLowerCase();

    for (const row of rows) {
      if (row.isSeparator) {
        const groupStart = rows.indexOf(row);
        let hasVisible = false;
        for (let i = groupStart + 1; i < rows.length; i++) {
          const r = rows[i];
          if (r.isSeparator) break;
          if (!lowerFilter || r.label.toLowerCase().includes(lowerFilter)) {
            hasVisible = true;
            break;
          }
        }
        if (!hasVisible) continue;

        const sep = document.createElement('div');
        sep.classList.add('theme-picker-separator');
        sep.textContent = row.label;
        list.appendChild(sep);
      } else {
        if (lowerFilter && !row.label.toLowerCase().includes(lowerFilter)) continue;

        const idx = visibleItems.length;
        const el = document.createElement('div');
        el.classList.add('theme-picker-item');
        if (row.themeEntry.id === previousThemeId) {
          el.classList.add('theme-picker-item--current');
        }
        el.textContent = row.label;

        el.addEventListener('click', () => {
          applyAndConfirm(row.themeEntry);
        });
        el.addEventListener('mouseenter', () => {
          setHighlight(idx);
          previewTheme(row.themeEntry);
        });

        visibleItems.push(row);
        list.appendChild(el);
      }
    }

    // Default highlight to the current theme
    if (highlightIndex < 0 || highlightIndex >= visibleItems.length) {
      const currentIdx = visibleItems.findIndex(
        v => v.themeEntry.id === themeService.activeTheme.id
      );
      highlightIndex = currentIdx >= 0 ? currentIdx : 0;
    }
    updateHighlightVisual();
  };

  const setHighlight = (idx: number): void => {
    if (idx < 0 || idx >= visibleItems.length) return;
    highlightIndex = idx;
    updateHighlightVisual();
  };

  const updateHighlightVisual = (): void => {
    const items = list.querySelectorAll('.theme-picker-item');
    items.forEach((el, i) => {
      el.classList.toggle('theme-picker-item--focused', i === highlightIndex);
    });
    items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  };

  const previewTheme = (entry: ThemeCatalogEntry): void => {
    const td = resolveTheme(entry, colorRegistry);
    themeService.applyTheme(td);
  };

  const applyAndConfirm = (entry: ThemeCatalogEntry): void => {
    const td = resolveTheme(entry, colorRegistry);
    themeService.applyTheme(td);
    localStorage.setItem(THEME_STORAGE_KEY, entry.id);
    cleanup();
  };

  const revert = (): void => {
    const prev = findThemeById(previousThemeId);
    if (prev) {
      const td = resolveTheme(prev, colorRegistry);
      themeService.applyTheme(td);
    }
    cleanup();
  };

  const cleanup = (): void => {
    overlay.remove();
  };

  // ── Initial render ───────────────────────────────────────────────────
  renderItems('');

  // ── Input events ─────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    highlightIndex = 0;
    renderItems(input.value);
  });

  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(Math.min(highlightIndex + 1, visibleItems.length - 1));
        if (visibleItems[highlightIndex]) {
          previewTheme(visibleItems[highlightIndex].themeEntry);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(Math.max(highlightIndex - 1, 0));
        if (visibleItems[highlightIndex]) {
          previewTheme(visibleItems[highlightIndex].themeEntry);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (visibleItems[highlightIndex]) {
          applyAndConfirm(visibleItems[highlightIndex].themeEntry);
        }
        break;
      case 'Escape':
        e.preventDefault();
        revert();
        break;
    }
  });

  // ── Click outside → revert ──────────────────────────────────────────
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      revert();
    }
  });
}
