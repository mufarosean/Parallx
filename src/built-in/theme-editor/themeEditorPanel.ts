// ThemeEditorPanel.ts — Theme customization UI
//
// Two-column layout: persistent live preview (left) + scrollable controls (right).
// Accordion color groups, inline swatch expansion, undo/redo, toast notifications,
// theme dropdown selector, mini-preview presets, per-color reset, merged design tokens.

import { $ } from '../../ui/dom.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ThemeSource } from '../../theme/themeTypes.js';
import { ColorThemeData } from '../../theme/themeData.js';
import { colorRegistry, type IColorRegistry } from '../../theme/colorRegistry.js';
import { designTokenRegistry, type IDesignTokenRegistry } from '../../theme/designTokenRegistry.js';
import type { IThemeService } from '../../services/serviceTypes.js';
import {
  getAvailableThemes,
  THEME_STORAGE_KEY,
} from '../../theme/themeCatalog.js';

import './themeEditor.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_THEMES_KEY = 'parallx.userThemes';
const MAX_UNDO = 30;

/** Color groups displayed in the editor, with the color IDs to show. */
const COLOR_GROUPS: { label: string; ids: string[] }[] = [
  {
    label: 'Editor',
    ids: [
      'editor.background', 'editor.foreground', 'editor.lineHighlightBackground',
      'editor.selectionBackground', 'editorCursor.foreground',
    ],
  },
  {
    label: 'Sidebar',
    ids: [
      'sideBar.background', 'sideBar.foreground', 'sideBarSectionHeader.background',
      'list.activeSelectionBackground', 'list.activeSelectionForeground',
      'list.hoverBackground',
    ],
  },
  {
    label: 'Title Bar',
    ids: [
      'titleBar.activeBackground', 'titleBar.activeForeground',
      'titleBar.inactiveBackground',
    ],
  },
  {
    label: 'Activity Bar',
    ids: [
      'activityBar.background', 'activityBar.foreground',
      'activityBar.activeBorder', 'activityBarBadge.background',
    ],
  },
  {
    label: 'Tabs',
    ids: [
      'tab.activeBackground', 'tab.activeForeground', 'tab.activeBorderTop',
      'tab.inactiveBackground', 'tab.inactiveForeground',
      'editorGroupHeader.tabsBackground',
    ],
  },
  {
    label: 'Buttons & Inputs',
    ids: [
      'button.background', 'button.foreground', 'button.hoverBackground',
      'input.background', 'input.foreground', 'input.border',
      'focusBorder',
    ],
  },
  {
    label: 'Panel',
    ids: [
      'panel.background', 'panel.border', 'panelTitle.activeBorder',
    ],
  },
  {
    label: 'Status Bar',
    ids: [
      'statusBar.background', 'statusBar.foreground',
    ],
  },
  {
    label: 'General',
    ids: [
      'foreground', 'descriptionForeground', 'errorForeground',
      'textLink.foreground', 'badge.background', 'badge.foreground',
    ],
  },
];

/** Font families available in dropdowns. */
const FONT_FAMILIES = [
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  "'Helvetica Neue', Helvetica, Arial, sans-serif",
  "'SF Pro Text', -apple-system, sans-serif",
  "'IBM Plex Sans', sans-serif",
];

const MONO_FAMILIES = [
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
  "'JetBrains Mono', Consolas, monospace",
  "'Fira Code', monospace",
  "Consolas, 'Courier New', monospace",
  "'SF Mono', Monaco, monospace",
];

/** Quick presets (just color overrides — design tokens use defaults). */
const PRESETS: { name: string; accent: string; bg: string; sidebar: string; fg: string; uiTheme: 'vs-dark' | 'vs' }[] = [
  { name: 'Parallx Dark', accent: '#a855f7', bg: '#1a1625', sidebar: '#14111a', fg: '#e2dce8', uiTheme: 'vs-dark' },
  { name: 'Parallx Light', accent: '#9333ea', bg: '#faf8ff', sidebar: '#f5f2fa', fg: '#1e1b2e', uiTheme: 'vs' },
  { name: 'Midnight', accent: '#7c3aed', bg: '#0f0a1a', sidebar: '#0a0712', fg: '#d4c8e8', uiTheme: 'vs-dark' },
  { name: 'Warm Dark', accent: '#f59e0b', bg: '#1a1610', sidebar: '#141210', fg: '#e8e0d0', uiTheme: 'vs-dark' },
  { name: 'Monochrome', accent: '#a0a0a0', bg: '#181818', sidebar: '#141414', fg: '#d4d4d4', uiTheme: 'vs-dark' },
];

/** Tailwind-style color ramps — light → dark per hue for the swatch palette. */
const SWATCH_PALETTES: { label: string; colors: string[] }[] = [
  { label: 'Slate', colors: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a'] },
  { label: 'Gray', colors: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827'] },
  { label: 'Zinc', colors: ['#fafafa', '#f4f4f5', '#e4e4e7', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', '#18181b'] },
  { label: 'Purple', colors: ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7c3aed', '#6d28d9', '#581c87'] },
  { label: 'Violet', colors: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'] },
  { label: 'Blue', colors: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'] },
  { label: 'Sky', colors: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'] },
  { label: 'Green', colors: ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'] },
  { label: 'Amber', colors: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'] },
  { label: 'Red', colors: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'] },
  { label: 'Pink', colors: ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'] },
  { label: 'Rose', colors: ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337'] },
];


// ─── Panel ────────────────────────────────────────────────────────────────────

export class ThemeEditorPanel implements IDisposable {
  private readonly _container: HTMLElement;
  private readonly _themeService: IThemeService;
  private readonly _colorRegistry: IColorRegistry;
  private readonly _designTokenRegistry: IDesignTokenRegistry;
  private readonly _onClose?: () => void;

  /** Working copy of theme colors (mutated by pickers). */
  private _workingColors: Record<string, string> = {};
  /** Working copy of design tokens. */
  private _workingTokens: Record<string, string> = {};
  /** Current theme label for the working copy. */
  private _workingLabel = 'Custom Theme';
  /** Whether working on a user theme vs a fresh customization. */
  private _editingUserThemeId: string | null = null;

  private _contentArea!: HTMLElement;
  private _themeDropdown!: HTMLSelectElement;

  /** Map of color-id → hidden native color input for batch updates. */
  private readonly _colorInputs = new Map<string, HTMLInputElement>();
  /** Map of color-id → visible swatch button element. */
  private readonly _colorSwatches = new Map<string, HTMLElement>();
  /** Map of color-id → editable hex text input. */
  private readonly _hexInputs = new Map<string, HTMLInputElement>();

  /** Accordion state: which color group is expanded (null = all collapsed). */
  private _expandedGroup: string | null = 'Editor';
  /** Accordion DOM references for toggling without re-render. */
  private readonly _accordionSections = new Map<string, { arrow: HTMLElement; grid: HTMLElement }>();

  /** Inline swatch expansion: which color is showing the ramp. */
  private _inlineSwatchColorId: string | null = null;
  private _inlineSwatchEl: HTMLElement | null = null;

  /** Live preview elements for color tracking. */
  private _previewEls: Record<string, HTMLElement> = {};

  /** Undo/redo stacks. */
  private _undoStack: { colors: Record<string, string>; tokens: Record<string, string> }[] = [];
  private _redoStack: { colors: Record<string, string>; tokens: Record<string, string> }[] = [];
  private _undoBtn!: HTMLButtonElement;
  private _redoBtn!: HTMLButtonElement;

  /** Toast notification state. */
  private _toastEl: HTMLElement | null = null;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Keyboard shortcut handler (stored for cleanup). */
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    themeService: IThemeService,
    onClose?: () => void,
  ) {
    this._container = container;
    this._themeService = themeService;
    this._colorRegistry = colorRegistry;
    this._designTokenRegistry = designTokenRegistry;
    this._onClose = onClose;

    this._render();
    this._loadCurrentThemeAsWorking();
    this._setupKeyboardShortcuts();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._container.classList.add('theme-editor');

    // ── Left: Preview pane ────────────────────────────────────────────────
    const previewPane = $('div.theme-editor__preview-pane');
    this._renderPreviewCard(previewPane);
    this._renderPresetSection(previewPane);
    this._container.appendChild(previewPane);

    // ── Right: Controls pane ──────────────────────────────────────────────
    const controlsPane = $('div.theme-editor__controls-pane');

    // Header
    const header = $('div.theme-editor__header');

    const title = $('div.theme-editor__title');
    title.textContent = 'Theme Editor';
    header.appendChild(title);

    // Theme dropdown selector
    this._themeDropdown = $('select.theme-editor__theme-dropdown') as HTMLSelectElement;
    this._themeDropdown.addEventListener('change', () => this._onThemeDropdownChange());
    header.appendChild(this._themeDropdown);

    const actions = $('div.theme-editor__actions');

    // Undo / Redo
    this._undoBtn = $('button.theme-editor__action-btn.theme-editor__undo-btn') as HTMLButtonElement;
    this._undoBtn.textContent = '\u21A9'; // ↩
    this._undoBtn.title = 'Undo (Ctrl+Z)';
    this._undoBtn.disabled = true;
    this._undoBtn.addEventListener('click', () => this._undo());
    actions.appendChild(this._undoBtn);

    this._redoBtn = $('button.theme-editor__action-btn.theme-editor__undo-btn') as HTMLButtonElement;
    this._redoBtn.textContent = '\u21AA'; // ↪
    this._redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    this._redoBtn.disabled = true;
    this._redoBtn.addEventListener('click', () => this._redo());
    actions.appendChild(this._redoBtn);

    // Separator
    const sep = $('div.theme-editor__action-sep');
    actions.appendChild(sep);

    const exportBtn = $('button.theme-editor__action-btn');
    exportBtn.textContent = 'Export';
    exportBtn.title = 'Export as .parallx-theme.json';
    exportBtn.addEventListener('click', () => this._exportTheme());
    actions.appendChild(exportBtn);

    const importBtn = $('button.theme-editor__action-btn');
    importBtn.textContent = 'Import';
    importBtn.title = 'Import a .parallx-theme.json file';
    importBtn.addEventListener('click', () => this._importTheme());
    actions.appendChild(importBtn);

    const saveBtn = $('button.theme-editor__action-btn.theme-editor__action-btn--primary');
    saveBtn.textContent = 'Save Theme';
    saveBtn.addEventListener('click', () => this._saveUserTheme());
    actions.appendChild(saveBtn);

    // Close button
    const closeBtn = $('button.theme-editor__close-btn');
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', () => this._onClose?.());
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    controlsPane.appendChild(header);

    // Scrollable content
    this._contentArea = $('div.theme-editor__content');
    controlsPane.appendChild(this._contentArea);

    this._container.appendChild(controlsPane);

    this._rebuildThemeDropdown();
    this._rebuildContent();
  }

  // ─── Theme Dropdown ─────────────────────────────────────────────────────

  private _rebuildThemeDropdown(): void {
    this._themeDropdown.innerHTML = '';
    const activeId = this._themeService.activeTheme.id;

    // Built-in themes
    const builtinGroup = $('optgroup') as HTMLOptGroupElement;
    builtinGroup.label = 'Built-in';
    for (const entry of getAvailableThemes()) {
      const opt = $('option') as HTMLOptionElement;
      opt.value = entry.id;
      opt.textContent = entry.label;
      if (entry.id === activeId) opt.selected = true;
      builtinGroup.appendChild(opt);
    }
    this._themeDropdown.appendChild(builtinGroup);

    // User themes
    const userThemes = this._loadUserThemes();
    if (userThemes.length > 0) {
      const userGroup = $('optgroup') as HTMLOptGroupElement;
      userGroup.label = 'My Themes';
      for (const ut of userThemes) {
        const opt = $('option') as HTMLOptionElement;
        opt.value = ut.id;
        opt.textContent = ut.label;
        if (ut.id === activeId) opt.selected = true;
        userGroup.appendChild(opt);
      }
      this._themeDropdown.appendChild(userGroup);
    }
  }

  private _onThemeDropdownChange(): void {
    const id = this._themeDropdown.value;
    if (!id) return;

    // Find theme source
    const builtin = getAvailableThemes().find(t => t.id === id);
    if (builtin) {
      const theme = ColorThemeData.fromSource(builtin.source, this._colorRegistry, this._designTokenRegistry);
      this._themeService.applyTheme(theme);
      localStorage.setItem(THEME_STORAGE_KEY, id);
      this._loadThemeSourceAsWorking(builtin.source, id);
      this._refreshColorInputs();
      this._showToast(`Applied "${builtin.label}".`);
      return;
    }

    const userTheme = this._loadUserThemes().find(t => t.id === id);
    if (userTheme) {
      const theme = ColorThemeData.fromSource(userTheme, this._colorRegistry, this._designTokenRegistry);
      this._themeService.applyTheme(theme);
      localStorage.setItem(THEME_STORAGE_KEY, id);
      this._loadThemeSourceAsWorking(userTheme, id);
      this._refreshColorInputs();
      this._showToast(`Applied "${userTheme.label}".`);
    }
  }

  // ─── Content Sections ──────────────────────────────────────────────────

  private _rebuildContent(): void {
    this._contentArea.innerHTML = '';
    this._colorInputs.clear();
    this._colorSwatches.clear();
    this._hexInputs.clear();
    this._accordionSections.clear();
    this._closeInlineSwatch();

    // Color groups (accordion)
    for (const group of COLOR_GROUPS) {
      this._renderColorGroup(group);
    }

    // Design tokens (merged typography + shape)
    this._renderDesignTokensSection();
  }

  // ─── Live Preview Card ─────────────────────────────────────────────────

  private _renderPreviewCard(parent: HTMLElement): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Preview';
    section.appendChild(title);

    const card = $('div.theme-editor__preview-card');

    // Mini titlebar
    const titlebar = $('div.theme-editor__preview-titlebar');
    const dots = $('div.theme-editor__preview-dots');
    for (let i = 0; i < 3; i++) dots.appendChild($('span.theme-editor__preview-dot'));
    titlebar.appendChild(dots);
    const titleText = $('span.theme-editor__preview-titlebar-text');
    titleText.textContent = 'Parallx';
    titlebar.appendChild(titleText);
    card.appendChild(titlebar);
    this._previewEls['titlebar'] = titlebar;

    // Mini body with sidebar + editor
    const body = $('div.theme-editor__preview-body');

    const sidebar = $('div.theme-editor__preview-sidebar');
    for (let i = 0; i < 4; i++) {
      const item = $('div.theme-editor__preview-sidebar-item');
      if (i === 1) item.classList.add('theme-editor__preview-sidebar-item--active');
      sidebar.appendChild(item);
    }
    body.appendChild(sidebar);
    this._previewEls['sidebar'] = sidebar;

    const editor = $('div.theme-editor__preview-editor');
    for (let i = 0; i < 5; i++) {
      const line = $('div.theme-editor__preview-line');
      line.style.width = `${40 + Math.floor(Math.random() * 50)}%`;
      editor.appendChild(line);
    }
    body.appendChild(editor);
    this._previewEls['editor'] = editor;

    card.appendChild(body);

    // Mini statusbar
    const statusbar = $('div.theme-editor__preview-statusbar');
    card.appendChild(statusbar);
    this._previewEls['statusbar'] = statusbar;

    // Accent bar
    const accentBar = $('div.theme-editor__preview-accent');
    card.appendChild(accentBar);
    this._previewEls['accent'] = accentBar;

    section.appendChild(card);
    parent.appendChild(section);

    this._updatePreviewColors();
  }

  private _updatePreviewColors(): void {
    const bg = this._resolveColorHex('editor.background');
    const fg = this._resolveColorHex('editor.foreground');
    const sbBg = this._resolveColorHex('sideBar.background');
    const sbFg = this._resolveColorHex('sideBar.foreground');
    const accent = this._resolveColorHex('button.background');
    const tbBg = this._resolveColorHex('titleBar.activeBackground');
    const stBg = this._resolveColorHex('statusBar.background');
    const selBg = this._resolveColorHex('list.activeSelectionBackground');

    const p = this._previewEls;
    if (!p['titlebar']) return;

    p['titlebar'].style.background = tbBg;
    p['titlebar'].style.color = fg;
    p['sidebar'].style.background = sbBg;
    p['sidebar'].style.color = sbFg;
    p['editor'].style.background = bg;
    p['editor'].style.color = fg;
    p['statusbar'].style.background = stBg;
    p['accent'].style.background = accent;

    // Active sidebar item
    const activeItem = p['sidebar'].querySelector('.theme-editor__preview-sidebar-item--active') as HTMLElement | null;
    if (activeItem) activeItem.style.background = selBg;

    // Lines in editor take text color
    const lines = p['editor'].querySelectorAll('.theme-editor__preview-line');
    lines.forEach((el) => {
      (el as HTMLElement).style.background = `color-mix(in srgb, ${fg} 20%, transparent)`;
    });
  }

  // ─── Preset Section (Mini-Preview Cards) ──────────────────────────────

  private _renderPresetSection(parent: HTMLElement): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Quick Presets';
    section.appendChild(title);

    const strip = $('div.theme-editor__presets');
    for (const preset of PRESETS) {
      const btn = $('button.theme-editor__preset-card');

      // Mini preview card
      const mini = $('div.theme-editor__preset-mini');
      const miniTitlebar = $('div.theme-editor__preset-mini-titlebar');
      miniTitlebar.style.background = preset.sidebar;
      mini.appendChild(miniTitlebar);

      const miniBody = $('div.theme-editor__preset-mini-body');
      const miniSidebar = $('div.theme-editor__preset-mini-sidebar');
      miniSidebar.style.background = preset.sidebar;
      miniBody.appendChild(miniSidebar);
      const miniEditor = $('div.theme-editor__preset-mini-editor');
      miniEditor.style.background = preset.bg;
      miniBody.appendChild(miniEditor);
      mini.appendChild(miniBody);

      const miniAccent = $('div.theme-editor__preset-mini-accent');
      miniAccent.style.background = preset.accent;
      mini.appendChild(miniAccent);

      btn.appendChild(mini);

      const lbl = $('span.theme-editor__preset-label');
      lbl.textContent = preset.name;
      btn.appendChild(lbl);

      btn.addEventListener('click', () => this._applyPreset(preset));
      strip.appendChild(btn);
    }
    section.appendChild(strip);
    parent.appendChild(section);
  }

  // ─── Accordion Color Groups ────────────────────────────────────────────

  private _renderColorGroup(group: { label: string; ids: string[] }): void {
    const section = $('div.theme-editor__section');

    // Clickable accordion header
    const titleRow = $('button.theme-editor__section-title.theme-editor__section-title--accordion');

    const arrow = $('span.theme-editor__accordion-arrow');
    arrow.textContent = group.label === this._expandedGroup ? '\u25BE' : '\u25B8'; // ▾ or ▸
    titleRow.appendChild(arrow);

    const titleText = $('span');
    titleText.textContent = group.label;
    titleRow.appendChild(titleText);

    // Color count badge
    const count = $('span.theme-editor__accordion-count');
    count.textContent = `${group.ids.length}`;
    titleRow.appendChild(count);

    titleRow.addEventListener('click', () => {
      this._expandedGroup = this._expandedGroup === group.label ? null : group.label;
      this._updateAccordionStates();
    });

    section.appendChild(titleRow);

    // Color grid (collapsible)
    const grid = $('div.theme-editor__color-grid');
    if (group.label !== this._expandedGroup) {
      grid.classList.add('theme-editor__color-grid--collapsed');
    }

    for (const colorId of group.ids) {
      if (!this._colorRegistry.getRegisteredColor(colorId)) continue;

      const row = $('div.theme-editor__color-row');
      row.dataset.colorId = colorId;

      // Clickable swatch button (opens inline ramp)
      const swatch = $('button.theme-editor__color-swatch');
      const currentHex = this._resolveColorHex(colorId);
      swatch.style.background = currentHex;
      swatch.title = 'Pick from swatches';
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleInlineSwatch(colorId, row);
      });
      this._colorSwatches.set(colorId, swatch);

      // Native color picker button (secondary)
      const pickerBtn = $('label.theme-editor__color-picker-btn');
      pickerBtn.title = 'Open color picker';
      pickerBtn.innerHTML = '&#x1F58C;';
      const input = $('input.theme-editor__color-input--hidden') as HTMLInputElement;
      input.type = 'color';
      input.value = currentHex;
      input.tabIndex = -1;
      let pickerUndoPushed = false;
      pickerBtn.addEventListener('click', () => { pickerUndoPushed = false; });
      input.addEventListener('input', () => {
        if (!pickerUndoPushed) {
          this._pushUndo();
          pickerUndoPushed = true;
        }
        this._applyColorChange(colorId, input.value);
      });
      pickerBtn.appendChild(input);
      this._colorInputs.set(colorId, input);

      // Friendly label
      const label = $('span.theme-editor__color-label');
      const parts = colorId.split('.');
      label.textContent = parts[parts.length - 1]
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
      label.title = colorId;

      // Editable hex text input
      const hexInput = $('input.theme-editor__hex-input') as HTMLInputElement;
      hexInput.type = 'text';
      hexInput.value = currentHex.toUpperCase();
      hexInput.spellcheck = false;
      hexInput.maxLength = 7;
      hexInput.addEventListener('focus', () => this._pushUndo());
      hexInput.addEventListener('input', () => {
        let val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          this._applyColorChange(colorId, val);
        }
      });
      hexInput.addEventListener('blur', () => {
        hexInput.value = this._resolveColorHex(colorId).toUpperCase();
      });
      this._hexInputs.set(colorId, hexInput);

      // Reset button (per-color)
      const resetBtn = $('button.theme-editor__reset-btn');
      resetBtn.title = 'Reset to default';
      resetBtn.textContent = '\u2715'; // ✕
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._pushUndo();
        delete this._workingColors[colorId];
        const defaultHex = this._resolveColorHex(colorId);
        this._applyColorChange(colorId, defaultHex);
        this._showToast(`Reset "${label.textContent}" to default.`);
      });

      row.appendChild(swatch);
      row.appendChild(pickerBtn);
      row.appendChild(label);
      row.appendChild(hexInput);
      row.appendChild(resetBtn);
      grid.appendChild(row);
    }

    section.appendChild(grid);
    this._contentArea.appendChild(section);

    // Store accordion refs
    this._accordionSections.set(group.label, { arrow, grid });
  }

  private _updateAccordionStates(): void {
    for (const [label, refs] of this._accordionSections) {
      const expanded = label === this._expandedGroup;
      refs.arrow.textContent = expanded ? '\u25BE' : '\u25B8';
      refs.grid.classList.toggle('theme-editor__color-grid--collapsed', !expanded);
    }
    // Close inline swatch when switching groups
    this._closeInlineSwatch();
  }

  // ─── Inline Swatch Expansion ───────────────────────────────────────────

  private _toggleInlineSwatch(colorId: string, anchorRow: HTMLElement): void {
    // If same color is already open, just close
    if (this._inlineSwatchColorId === colorId) {
      this._closeInlineSwatch();
      return;
    }

    this._closeInlineSwatch();

    const expansion = $('div.theme-editor__swatch-inline');

    for (const palette of SWATCH_PALETTES) {
      const groupLabel = $('div.theme-editor__swatch-group-label');
      groupLabel.textContent = palette.label;
      expansion.appendChild(groupLabel);

      const ramp = $('div.theme-editor__swatch-grid');
      for (const hex of palette.colors) {
        const cell = $('button.theme-editor__swatch-cell');
        cell.style.background = hex;
        cell.title = hex.toUpperCase();
        const currentHex = this._resolveColorHex(colorId);
        if (hex.toLowerCase() === currentHex.toLowerCase()) {
          cell.classList.add('theme-editor__swatch-cell--active');
        }
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          this._pushUndo();
          this._applyColorChange(colorId, hex);
          this._closeInlineSwatch();
        });
        ramp.appendChild(cell);
      }
      expansion.appendChild(ramp);
    }

    // "Custom..." button
    const customBtn = $('button.theme-editor__swatch-custom-btn');
    customBtn.textContent = 'Custom\u2026';
    customBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeInlineSwatch();
      const input = this._colorInputs.get(colorId);
      if (input) input.click();
    });
    expansion.appendChild(customBtn);

    // Insert after the anchor row in the grid
    anchorRow.after(expansion);

    this._inlineSwatchColorId = colorId;
    this._inlineSwatchEl = expansion;
  }

  private _closeInlineSwatch(): void {
    if (this._inlineSwatchEl) {
      this._inlineSwatchEl.remove();
      this._inlineSwatchEl = null;
    }
    this._inlineSwatchColorId = null;
  }

  // ─── Color Change ─────────────────────────────────────────────────────

  /** Central method to apply a color change from any source (swatch, picker, hex input). */
  private _applyColorChange(colorId: string, hex: string): void {
    this._workingColors[colorId] = hex;
    // Update swatch button
    const swatch = this._colorSwatches.get(colorId);
    if (swatch) swatch.style.background = hex;
    // Update hidden native input
    const input = this._colorInputs.get(colorId);
    if (input) input.value = hex;
    // Update hex text input
    const hexInput = this._hexInputs.get(colorId);
    if (hexInput && document.activeElement !== hexInput) {
      hexInput.value = hex.toUpperCase();
    }
    this._applyWorkingThemeLive();
    this._updatePreviewColors();
  }

  // ─── Undo / Redo ──────────────────────────────────────────────────────

  private _pushUndo(): void {
    this._undoStack.push({
      colors: { ...this._workingColors },
      tokens: { ...this._workingTokens },
    });
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
    this._redoStack.length = 0;
    this._updateUndoRedoButtons();
  }

  private _undo(): void {
    if (this._undoStack.length === 0) return;
    this._redoStack.push({
      colors: { ...this._workingColors },
      tokens: { ...this._workingTokens },
    });
    const prev = this._undoStack.pop()!;
    this._workingColors = { ...prev.colors };
    this._workingTokens = { ...prev.tokens };
    this._applyWorkingThemeLive();
    this._refreshColorInputs();
    this._updateUndoRedoButtons();
    this._showToast('Undid last change.');
  }

  private _redo(): void {
    if (this._redoStack.length === 0) return;
    this._undoStack.push({
      colors: { ...this._workingColors },
      tokens: { ...this._workingTokens },
    });
    const next = this._redoStack.pop()!;
    this._workingColors = { ...next.colors };
    this._workingTokens = { ...next.tokens };
    this._applyWorkingThemeLive();
    this._refreshColorInputs();
    this._updateUndoRedoButtons();
    this._showToast('Redid change.');
  }

  private _updateUndoRedoButtons(): void {
    this._undoBtn.disabled = this._undoStack.length === 0;
    this._redoBtn.disabled = this._redoStack.length === 0;
  }

  // ─── Design Tokens (merged Typography + Shape) ────────────────────────

  private _renderDesignTokensSection(): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Design Tokens';
    section.appendChild(title);

    // Typography
    section.appendChild(this._createFontRow('UI Font', 'fontFamily.ui', FONT_FAMILIES));
    section.appendChild(this._createFontRow('Mono Font', 'fontFamily.mono', MONO_FAMILIES));
    section.appendChild(this._createSliderRow('Base Size', 'fontSize.base', 10, 16, 1, 'px'));

    // Shape
    section.appendChild(this._createSliderRow('Border Radius', 'radius.md', 0, 12, 1, 'px'));
    section.appendChild(this._createSliderRow('Large Radius', 'radius.lg', 0, 16, 1, 'px'));

    this._contentArea.appendChild(section);
  }

  // ─── UI Helpers ─────────────────────────────────────────────────────────

  private _createFontRow(label: string, tokenId: string, options: string[]): HTMLElement {
    const row = $('div.theme-editor__font-row');

    const lbl = $('span.theme-editor__font-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const select = $('select.theme-editor__font-select') as HTMLSelectElement;
    const currentVal = this._workingTokens[tokenId] || this._resolveDesignTokenValue(tokenId);
    for (const family of options) {
      const opt = $('option') as HTMLOptionElement;
      opt.value = family;
      const short = family.split(',')[0].replace(/'/g, '').trim();
      opt.textContent = short;
      if (family === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      this._pushUndo();
      this._workingTokens[tokenId] = select.value;
      this._applyWorkingThemeLive();
    });
    row.appendChild(select);

    return row;
  }

  private _createSliderRow(label: string, tokenId: string, min: number, max: number, step: number, unit: string): HTMLElement {
    const row = $('div.theme-editor__slider-row');

    const lbl = $('span.theme-editor__slider-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const current = this._workingTokens[tokenId] || this._resolveDesignTokenValue(tokenId);
    const numVal = parseInt(current, 10) || min;

    const slider = $('input.theme-editor__slider') as HTMLInputElement;
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(numVal);
    row.appendChild(slider);

    const valDisplay = $('span.theme-editor__slider-value');
    valDisplay.textContent = `${numVal}${unit}`;
    row.appendChild(valDisplay);

    let sliderUndoPushed = false;
    slider.addEventListener('mousedown', () => { sliderUndoPushed = false; });
    slider.addEventListener('input', () => {
      if (!sliderUndoPushed) {
        this._pushUndo();
        sliderUndoPushed = true;
      }
      const v = slider.value;
      valDisplay.textContent = `${v}${unit}`;
      this._workingTokens[tokenId] = `${v}${unit}`;
      this._applyWorkingThemeLive();
    });

    return row;
  }

  // ─── Working Theme ─────────────────────────────────────────────────────

  private _loadCurrentThemeAsWorking(): void {
    const active = this._themeService.activeTheme;
    const entry = getAvailableThemes().find(t => t.id === active.id);
    if (entry) {
      this._loadThemeSourceAsWorking(entry.source, entry.id);
    } else {
      const userThemes = this._loadUserThemes();
      const ut = userThemes.find(t => t.id === active.id);
      if (ut) {
        this._loadThemeSourceAsWorking(ut, ut.id);
      } else {
        this._workingColors = {};
        this._workingTokens = {};
        this._workingLabel = active.label;
      }
    }
  }

  private _loadThemeSourceAsWorking(source: ThemeSource, id: string): void {
    this._workingColors = { ...source.colors };
    this._workingTokens = source.designTokens ? { ...source.designTokens } : {};
    this._workingLabel = source.label;

    const userThemes = this._loadUserThemes();
    const isUser = userThemes.some(t => t.id === id);
    this._editingUserThemeId = isUser ? id : null;
  }

  private _applyWorkingThemeLive(): void {
    const source: ThemeSource = {
      id: this._editingUserThemeId || `user-${Date.now()}`,
      label: this._workingLabel || 'Custom Theme',
      uiTheme: this._guessUiTheme(),
      colors: { ...this._workingColors },
      designTokens: Object.keys(this._workingTokens).length > 0 ? { ...this._workingTokens } : undefined,
    };
    const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
    this._themeService.applyTheme(theme);
  }

  private _refreshColorInputs(): void {
    for (const [colorId, input] of this._colorInputs) {
      const hex = this._resolveColorHex(colorId);
      input.value = hex;
      const swatch = this._colorSwatches.get(colorId);
      if (swatch) swatch.style.background = hex;
      const hexInput = this._hexInputs.get(colorId);
      if (hexInput) hexInput.value = hex.toUpperCase();
    }
    this._updatePreviewColors();
  }

  // ─── Presets ───────────────────────────────────────────────────────────

  private _applyPreset(preset: typeof PRESETS[0]): void {
    this._pushUndo();

    this._workingColors['editor.background'] = preset.bg;
    this._workingColors['sideBar.background'] = preset.sidebar;
    this._workingColors['titleBar.activeBackground'] = preset.sidebar;
    this._workingColors['activityBar.background'] = preset.sidebar;
    this._workingColors['foreground'] = preset.fg;
    this._workingColors['editor.foreground'] = preset.fg;
    this._workingColors['sideBar.foreground'] = preset.fg;
    this._workingColors['button.background'] = preset.accent;
    this._workingColors['focusBorder'] = preset.accent;
    this._workingColors['tab.activeBorderTop'] = preset.accent;
    this._workingColors['activityBar.activeBorder'] = preset.accent;
    this._workingColors['panelTitle.activeBorder'] = preset.accent;
    this._workingColors['textLink.foreground'] = preset.accent;

    this._workingLabel = preset.name;

    this._applyWorkingThemeLive();
    this._refreshColorInputs();
    this._updatePreviewColors();
    this._showToast(`Applied preset "${preset.name}".`);
  }

  // ─── Save / Load User Themes ──────────────────────────────────────────

  private _saveUserTheme(): void {
    if (this._editingUserThemeId) {
      // Overwrite existing — save directly
      this._doSaveTheme(this._workingLabel);
    } else {
      // New theme — show save dialog
      this._showSaveDialog();
    }
  }

  private _showSaveDialog(): void {
    const backdrop = $('div.theme-editor__save-dialog');

    const dialog = $('div.theme-editor__save-dialog-box');

    const dialogTitle = $('div.theme-editor__save-dialog-title');
    dialogTitle.textContent = 'Save Theme As';
    dialog.appendChild(dialogTitle);

    const nameInput = $('input.theme-editor__save-dialog-input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.value = this._workingLabel || 'Custom Theme';
    nameInput.placeholder = 'Theme name';
    nameInput.maxLength = 50;
    dialog.appendChild(nameInput);

    const btnRow = $('div.theme-editor__save-dialog-actions');

    const cancelBtn = $('button.theme-editor__action-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => backdrop.remove());
    btnRow.appendChild(cancelBtn);

    const confirmBtn = $('button.theme-editor__action-btn.theme-editor__action-btn--primary');
    confirmBtn.textContent = 'Save';
    confirmBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Custom Theme';
      backdrop.remove();
      this._doSaveTheme(name);
    });
    btnRow.appendChild(confirmBtn);

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') backdrop.remove();
    });

    dialog.appendChild(btnRow);
    backdrop.appendChild(dialog);
    this._container.appendChild(backdrop);

    // Focus on next frame
    requestAnimationFrame(() => {
      nameInput.select();
      nameInput.focus();
    });
  }

  private _doSaveTheme(label: string): void {
    const id = this._editingUserThemeId || `user-theme-${Date.now()}`;

    const source: ThemeSource = {
      id,
      label,
      uiTheme: this._guessUiTheme(),
      colors: { ...this._workingColors },
      designTokens: Object.keys(this._workingTokens).length > 0 ? { ...this._workingTokens } : undefined,
    };

    const userThemes = this._loadUserThemes();
    const existingIdx = userThemes.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
      userThemes[existingIdx] = source;
    } else {
      userThemes.push(source);
    }

    localStorage.setItem(USER_THEMES_KEY, JSON.stringify(userThemes));
    localStorage.setItem(THEME_STORAGE_KEY, id);
    this._editingUserThemeId = id;
    this._workingLabel = label;

    const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
    this._themeService.applyTheme(theme);

    this._rebuildThemeDropdown();
    this._showToast(`Saved "${label}".`);
  }

  private _loadUserThemes(): ThemeSource[] {
    try {
      const raw = localStorage.getItem(USER_THEMES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t: unknown): t is ThemeSource =>
          typeof t === 'object' && t !== null &&
          typeof (t as ThemeSource).id === 'string' &&
          typeof (t as ThemeSource).label === 'string' &&
          typeof (t as ThemeSource).colors === 'object',
      );
    } catch {
      return [];
    }
  }

  // ─── Import / Export ───────────────────────────────────────────────────

  private _exportTheme(): void {
    const source: ThemeSource = {
      id: this._editingUserThemeId || `user-theme-${Date.now()}`,
      label: this._workingLabel || 'Custom Theme',
      uiTheme: this._guessUiTheme(),
      colors: { ...this._workingColors },
      designTokens: Object.keys(this._workingTokens).length > 0 ? { ...this._workingTokens } : undefined,
    };

    const json = JSON.stringify(source, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(source.label || 'theme').replace(/\s+/g, '-').toLowerCase()}.parallx-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('Theme exported.');
  }

  private _importTheme(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.parallx-theme.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as ThemeSource;
          if (!parsed.id || !parsed.label || !parsed.colors || typeof parsed.colors !== 'object') {
            this._showToast('Invalid theme file: missing required fields.');
            return;
          }
          this._pushUndo();
          const source: ThemeSource = { ...parsed, id: `user-theme-${Date.now()}` };

          const userThemes = this._loadUserThemes();
          userThemes.push(source);
          localStorage.setItem(USER_THEMES_KEY, JSON.stringify(userThemes));

          this._loadThemeSourceAsWorking(source, source.id);
          const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
          this._themeService.applyTheme(theme);
          localStorage.setItem(THEME_STORAGE_KEY, source.id);

          this._rebuildThemeDropdown();
          this._rebuildContent();
          this._showToast(`Imported "${source.label}".`);
        } catch {
          this._showToast('Failed to parse theme file.');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ─── Toast Notification ────────────────────────────────────────────────

  private _showToast(msg: string): void {
    if (this._toastEl) {
      this._toastEl.remove();
      this._toastEl = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }

    const toast = $('div.theme-editor__toast');
    toast.textContent = msg;
    this._container.appendChild(toast);
    this._toastEl = toast;

    // Trigger enter animation
    requestAnimationFrame(() => toast.classList.add('theme-editor__toast--visible'));

    this._toastTimer = setTimeout(() => {
      toast.classList.remove('theme-editor__toast--visible');
      setTimeout(() => {
        toast.remove();
        if (this._toastEl === toast) this._toastEl = null;
      }, 300);
    }, 2500);
  }

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────

  private _setupKeyboardShortcuts(): void {
    this._keydownHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this._undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this._redo();
      }
    };
    this._container.addEventListener('keydown', this._keydownHandler, true);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private _resolveColorHex(colorId: string): string {
    const working = this._workingColors[colorId];
    if (working && working.startsWith('#')) return working.length === 4 ? this._expandShortHex(working) : working.substring(0, 7);

    const themeVal = this._themeService.activeTheme.getColor(colorId);
    if (themeVal && themeVal.startsWith('#')) return themeVal.length === 4 ? this._expandShortHex(themeVal) : themeVal.substring(0, 7);

    return '#808080';
  }

  private _expandShortHex(hex: string): string {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  private _resolveDesignTokenValue(tokenId: string): string {
    const reg = this._designTokenRegistry.getRegisteredToken(tokenId);
    if (!reg) return '';
    const type = this._themeService.activeTheme.type;
    return this._designTokenRegistry.resolveDefault(tokenId, type) ?? '';
  }

  private _guessUiTheme(): 'vs-dark' | 'vs' | 'hc-black' | 'hc-light' {
    const bg = this._workingColors['editor.background'] || '#1e1e1e';
    const r = parseInt(bg.substring(1, 3), 16) || 0;
    const g = parseInt(bg.substring(3, 5), 16) || 0;
    const b = parseInt(bg.substring(5, 7), 16) || 0;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? 'vs' : 'vs-dark';
  }

  // ─── IDisposable ──────────────────────────────────────────────────────

  dispose(): void {
    this._closeInlineSwatch();
    if (this._keydownHandler) {
      this._container.removeEventListener('keydown', this._keydownHandler, true);
      this._keydownHandler = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    if (this._toastEl) {
      this._toastEl.remove();
      this._toastEl = null;
    }
    this._container.innerHTML = '';
    this._colorInputs.clear();
    this._colorSwatches.clear();
    this._hexInputs.clear();
    this._accordionSections.clear();
    this._previewEls = {};
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }
}
