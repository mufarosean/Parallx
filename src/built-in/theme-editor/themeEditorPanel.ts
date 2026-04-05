// ThemeEditorPanel.ts — Theme customization UI (editor tab version)
//
// Full-width editor pane layout: toolbar at top, scrollable color sections below.
// Flat sections (no accordions) — all visible, organized by surface.
// Hover-preview: hovering a swatch color temporarily applies it live; leaving
// reverts to the committed value. Clicking commits the color.

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
  USER_THEMES_KEY,
  updateUserThemesCache,
  getUserThemeSources,
} from '../../theme/themeCatalog.js';
import type { IStorage } from '../../platform/storage.js';

import './themeEditor.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_UNDO = 30;

/** Color groups — flat sections, all visible. */
interface ColorGroup {
  label: string;
  hint?: string;
  ids: string[];
  labels?: Record<string, string>;
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    label: 'Global',
    hint: 'Base colors inherited by all surfaces. Override per-surface below.',
    ids: [
      'foreground',
      'editor.background',
      'focusBorder',
      'icon.foreground',
      'errorForeground',
      'descriptionForeground',
      'selection.background',
    ],
    labels: {
      'foreground':             'Text & Icon Color',
      'editor.background':      'Background',
      'focusBorder':            'Accent / Focus Color',
      'icon.foreground':        'Icon Color',
      'errorForeground':        'Error Color',
      'descriptionForeground':  'Secondary Text',
      'selection.background':   'Selection Highlight',
    },
  },
  {
    label: 'Accent Colors',
    hint: 'Primary accent applied to buttons, links, badges, and active indicators.',
    ids: [
      'button.background',
      'textLink.foreground',
      'activityBarBadge.background',
      'badge.background', 'badge.foreground',
    ],
    labels: {
      'button.background':        'Primary Button',
      'textLink.foreground':      'Link Color',
      'activityBarBadge.background': 'Badge Accent',
      'badge.background':         'Badge Background',
      'badge.foreground':         'Badge Text',
    },
  },
  {
    label: 'Editor',
    hint: 'Main content area where files and pages are displayed.',
    ids: [
      'editor.foreground',
      'editor.findMatchHighlightBackground',
      'editorWidget.background', 'editorWidget.foreground', 'editorWidget.border',
      'editorLineNumber.foreground', 'editorLineNumber.activeForeground',
    ],
    labels: {
      'editor.foreground':                   'Text Color',
      'editor.findMatchHighlightBackground': 'Find Match Highlight',
      'editorWidget.background':             'Widget Background',
      'editorWidget.foreground':             'Widget Text',
      'editorWidget.border':                 'Widget Border',
      'editorLineNumber.foreground':         'Line Numbers',
      'editorLineNumber.activeForeground':   'Active Line Number',
    },
  },
  {
    label: 'Sidebar',
    hint: 'Left panel containing Explorer, Search, and other views.',
    ids: [
      'sideBar.background', 'sideBar.foreground', 'sideBar.border',
      'sideBarTitle.foreground',
      'sideBarSectionHeader.background', 'sideBarSectionHeader.foreground', 'sideBarSectionHeader.border',
      'list.hoverBackground', 'list.activeSelectionBackground', 'list.activeSelectionForeground',
      'list.focusOutline',
    ],
    labels: {
      'sideBar.background':                  'Background',
      'sideBar.foreground':                   'Text Color',
      'sideBar.border':                       'Border',
      'sideBarTitle.foreground':              'Title Text',
      'sideBarSectionHeader.background':      'Section Header Background',
      'sideBarSectionHeader.foreground':      'Section Header Text',
      'sideBarSectionHeader.border':          'Section Header Border',
      'list.hoverBackground':                 'Item Hover',
      'list.activeSelectionBackground':       'Selected Item Background',
      'list.activeSelectionForeground':       'Selected Item Text',
      'list.focusOutline':                    'Focus Outline',
    },
  },
  {
    label: 'Title Bar',
    ids: [
      'titleBar.activeBackground', 'titleBar.activeForeground',
      'titleBar.inactiveBackground', 'titleBar.inactiveForeground',
      'titleBar.border',
    ],
    labels: {
      'titleBar.activeBackground':   'Background',
      'titleBar.activeForeground':   'Text Color',
      'titleBar.inactiveBackground': 'Inactive Background',
      'titleBar.inactiveForeground': 'Inactive Text',
      'titleBar.border':             'Border',
    },
  },
  {
    label: 'Activity Bar',
    ids: [
      'activityBar.background', 'activityBar.foreground',
      'activityBar.inactiveForeground', 'activityBar.border',
      'activityBar.activeBorder',
    ],
    labels: {
      'activityBar.background':         'Background',
      'activityBar.foreground':          'Active Icon',
      'activityBar.inactiveForeground':  'Inactive Icon',
      'activityBar.border':              'Border',
      'activityBar.activeBorder':        'Active Indicator',
    },
  },
  {
    label: 'Tabs',
    hint: 'Editor tab bar and individual tab styling.',
    ids: [
      'editorGroupHeader.tabsBackground',
      'tab.activeBackground', 'tab.activeForeground', 'tab.activeBorderTop',
      'tab.inactiveBackground', 'tab.inactiveForeground',
      'tab.border', 'tab.hoverBackground',
    ],
    labels: {
      'editorGroupHeader.tabsBackground': 'Tab Bar Background',
      'tab.activeBackground':             'Active Tab',
      'tab.activeForeground':             'Active Tab Text',
      'tab.activeBorderTop':              'Active Tab Accent',
      'tab.inactiveBackground':           'Inactive Tab',
      'tab.inactiveForeground':           'Inactive Tab Text',
      'tab.border':                       'Tab Separator',
      'tab.hoverBackground':              'Tab Hover',
    },
  },
  {
    label: 'Panel',
    hint: 'Bottom panel containing Terminal, Output, and other tools.',
    ids: [
      'panel.background', 'panel.border',
      'panelTitle.activeForeground', 'panelTitle.inactiveForeground',
      'panelTitle.activeBorder',
    ],
    labels: {
      'panel.background':              'Background',
      'panel.border':                  'Top Border',
      'panelTitle.activeForeground':   'Active Tab Text',
      'panelTitle.inactiveForeground': 'Inactive Tab Text',
      'panelTitle.activeBorder':       'Active Tab Indicator',
    },
  },
  {
    label: 'Status Bar',
    ids: [
      'statusBar.background', 'statusBar.foreground',
      'statusBarItem.hoverBackground',
    ],
    labels: {
      'statusBar.background':          'Background',
      'statusBar.foreground':           'Text & Icons',
      'statusBarItem.hoverBackground':  'Item Hover',
    },
  },
  {
    label: 'Buttons & Inputs',
    ids: [
      'button.foreground', 'button.hoverBackground',
      'button.secondaryBackground', 'button.secondaryForeground',
      'input.background', 'input.foreground', 'input.border',
      'input.placeholderForeground',
    ],
    labels: {
      'button.foreground':            'Button Text',
      'button.hoverBackground':       'Button Hover',
      'button.secondaryBackground':   'Secondary Button',
      'button.secondaryForeground':   'Secondary Button Text',
      'input.background':             'Input Background',
      'input.foreground':             'Input Text',
      'input.border':                 'Input Border',
      'input.placeholderForeground':  'Placeholder Text',
    },
  },
  {
    label: 'Menus & Dropdowns',
    ids: [
      'menu.background', 'menu.foreground',
      'menu.selectionBackground', 'menu.selectionForeground',
      'menu.border', 'menu.separatorBackground',
    ],
    labels: {
      'menu.background':           'Background',
      'menu.foreground':            'Text Color',
      'menu.selectionBackground':  'Hover / Selected',
      'menu.selectionForeground':  'Selected Text',
      'menu.border':               'Border',
      'menu.separatorBackground':  'Separator',
    },
  },
  {
    label: 'Notifications',
    ids: [
      'notifications.background', 'notifications.foreground', 'notifications.border',
      'notificationLink.foreground',
    ],
    labels: {
      'notifications.background':  'Background',
      'notifications.foreground':   'Text',
      'notifications.border':       'Border',
      'notificationLink.foreground': 'Link Color',
    },
  },
];

/** Font families for design token dropdowns. */
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

/** Quick presets. */
const PRESETS: { name: string; accent: string; bg: string; sidebar: string; fg: string; uiTheme: 'vs-dark' | 'vs' }[] = [
  { name: 'Parallx Dark', accent: '#a855f7', bg: '#1a1625', sidebar: '#14111a', fg: '#e2dce8', uiTheme: 'vs-dark' },
  { name: 'Parallx Light', accent: '#9333ea', bg: '#faf8ff', sidebar: '#f5f2fa', fg: '#1e1b2e', uiTheme: 'vs' },
  { name: 'Midnight', accent: '#7c3aed', bg: '#0f0a1a', sidebar: '#0a0712', fg: '#d4c8e8', uiTheme: 'vs-dark' },
  { name: 'Warm Dark', accent: '#f59e0b', bg: '#1a1610', sidebar: '#141210', fg: '#e8e0d0', uiTheme: 'vs-dark' },
  { name: 'Monochrome', accent: '#a0a0a0', bg: '#181818', sidebar: '#141414', fg: '#d4d4d4', uiTheme: 'vs-dark' },
];

/** Tailwind-style color ramps for the swatch picker popup. */
const SWATCH_PALETTES: { label: string; colors: string[] }[] = [
  { label: 'Slate',  colors: ['#f8fafc','#e2e8f0','#94a3b8','#475569','#1e293b','#0f172a'] },
  { label: 'Purple', colors: ['#faf5ff','#e9d5ff','#c084fc','#9333ea','#7c3aed','#581c87'] },
  { label: 'Blue',   colors: ['#eff6ff','#bfdbfe','#60a5fa','#2563eb','#1d4ed8','#1e3a8a'] },
  { label: 'Green',  colors: ['#f0fdf4','#bbf7d0','#4ade80','#16a34a','#166534','#14532d'] },
  { label: 'Amber',  colors: ['#fffbeb','#fde68a','#fbbf24','#d97706','#92400e','#78350f'] },
  { label: 'Red',    colors: ['#fef2f2','#fecaca','#f87171','#dc2626','#991b1b','#7f1d1d'] },
  { label: 'Pink',   colors: ['#fdf2f8','#fbcfe8','#f472b6','#db2777','#9d174d','#831843'] },
  { label: 'Rose',   colors: ['#fff1f2','#fecdd3','#fb7185','#e11d48','#9f1239','#881337'] },
  { label: 'Gray',   colors: ['#f9fafb','#e5e7eb','#9ca3af','#4b5563','#1f2937','#111827'] },
  { label: 'Zinc',   colors: ['#fafafa','#e4e4e7','#a1a1aa','#52525b','#27272a','#18181b'] },
];


// ─── Panel ────────────────────────────────────────────────────────────────────

export class ThemeEditorPanel implements IDisposable {
  private readonly _container: HTMLElement;
  private readonly _themeService: IThemeService;
  private readonly _colorRegistry: IColorRegistry;
  private readonly _designTokenRegistry: IDesignTokenRegistry;
  private readonly _globalStorage: IStorage;

  /** Working copy of theme colors (mutated by pickers). */
  private _workingColors: Record<string, string> = {};
  /** Working copy of design tokens. */
  private _workingTokens: Record<string, string> = {};
  /** Current theme label. */
  private _workingLabel = 'Custom Theme';
  /** Whether editing a saved user theme. */
  private _editingUserThemeId: string | null = null;

  private _contentArea!: HTMLElement;
  private _themeDropdown!: HTMLSelectElement;

  /** Map of color-id → visible swatch button element. */
  private readonly _colorSwatches = new Map<string, HTMLElement>();
  /** Map of color-id → editable hex text input. */
  private readonly _hexInputs = new Map<string, HTMLInputElement>();

  /** Hover-preview state: which colorId is being previewed (null = none). */
  private _hoverPreviewColorId: string | null = null;
  /** The committed hex before hover-preview started. */
  private _hoverPreviewOriginalHex: string | null = null;

  /** Active swatch picker popup element. */
  private _swatchPopup: HTMLElement | null = null;
  private _swatchPopupColorId: string | null = null;

  /** Undo/redo stacks. */
  private _undoStack: { colors: Record<string, string>; tokens: Record<string, string> }[] = [];
  private _redoStack: { colors: Record<string, string>; tokens: Record<string, string> }[] = [];
  private _undoBtn!: HTMLButtonElement;
  private _redoBtn!: HTMLButtonElement;

  /** Toast notification. */
  private _toastEl: HTMLElement | null = null;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Keyboard shortcut handler. */
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Click-outside handler for swatch popup. */
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    themeService: IThemeService,
    globalStorage: IStorage,
  ) {
    this._container = container;
    this._themeService = themeService;
    this._colorRegistry = colorRegistry;
    this._designTokenRegistry = designTokenRegistry;
    this._globalStorage = globalStorage;

    this._render();
    this._loadCurrentThemeAsWorking();
    this._setupKeyboardShortcuts();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._container.classList.add('te');

    // ── Toolbar ──────────────────────────────────────────────────────────
    const toolbar = $('div.te__toolbar');

    const title = $('div.te__title');
    title.textContent = 'Theme Editor';
    toolbar.appendChild(title);

    // Theme dropdown
    this._themeDropdown = $('select.te__dropdown') as HTMLSelectElement;
    this._themeDropdown.addEventListener('change', () => this._onThemeDropdownChange());
    toolbar.appendChild(this._themeDropdown);

    // Preset strip
    const presetStrip = $('div.te__presets');
    for (const preset of PRESETS) {
      const btn = $('button.te__preset');
      const swatch = $('span.te__preset-swatch');
      swatch.style.background = preset.accent;
      btn.appendChild(swatch);
      const lbl = $('span');
      lbl.textContent = preset.name;
      btn.appendChild(lbl);
      btn.addEventListener('click', () => this._applyPreset(preset));
      presetStrip.appendChild(btn);
    }
    toolbar.appendChild(presetStrip);

    // Spacer
    toolbar.appendChild($('div.te__spacer'));

    // Actions
    const actions = $('div.te__actions');

    this._undoBtn = $('button.te__btn.te__btn--icon') as HTMLButtonElement;
    this._undoBtn.textContent = '\u21A9';
    this._undoBtn.title = 'Undo (Ctrl+Z)';
    this._undoBtn.disabled = true;
    this._undoBtn.addEventListener('click', () => this._undo());
    actions.appendChild(this._undoBtn);

    this._redoBtn = $('button.te__btn.te__btn--icon') as HTMLButtonElement;
    this._redoBtn.textContent = '\u21AA';
    this._redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    this._redoBtn.disabled = true;
    this._redoBtn.addEventListener('click', () => this._redo());
    actions.appendChild(this._redoBtn);

    actions.appendChild($('div.te__sep'));

    const exportBtn = $('button.te__btn');
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this._exportTheme());
    actions.appendChild(exportBtn);

    const importBtn = $('button.te__btn');
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => this._importTheme());
    actions.appendChild(importBtn);

    const saveBtn = $('button.te__btn.te__btn--primary');
    saveBtn.textContent = 'Save Theme';
    saveBtn.addEventListener('click', () => this._saveUserTheme());
    actions.appendChild(saveBtn);

    toolbar.appendChild(actions);
    this._container.appendChild(toolbar);

    // ── Content area ─────────────────────────────────────────────────────
    this._contentArea = $('div.te__content');
    this._container.appendChild(this._contentArea);

    this._rebuildThemeDropdown();
    this._rebuildContent();
  }

  // ─── Theme Dropdown ─────────────────────────────────────────────────────

  private _rebuildThemeDropdown(): void {
    this._themeDropdown.innerHTML = '';
    const activeId = this._themeService.activeTheme.id;

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

    const builtin = getAvailableThemes().find(t => t.id === id);
    if (builtin) {
      const theme = ColorThemeData.fromSource(builtin.source, this._colorRegistry, this._designTokenRegistry);
      this._themeService.applyTheme(theme);
      this._globalStorage.set(THEME_STORAGE_KEY, id);
      this._loadThemeSourceAsWorking(builtin.source, id);
      this._refreshAllSwatches();
      this._showToast(`Applied "${builtin.label}".`);
      return;
    }

    const userTheme = this._loadUserThemes().find(t => t.id === id);
    if (userTheme) {
      const theme = ColorThemeData.fromSource(userTheme, this._colorRegistry, this._designTokenRegistry);
      this._themeService.applyTheme(theme);
      this._globalStorage.set(THEME_STORAGE_KEY, id);
      this._loadThemeSourceAsWorking(userTheme, id);
      this._refreshAllSwatches();
      this._showToast(`Applied "${userTheme.label}".`);
    }
  }

  // ─── Content Sections ──────────────────────────────────────────────────

  private _rebuildContent(): void {
    this._contentArea.innerHTML = '';
    this._colorSwatches.clear();
    this._hexInputs.clear();
    this._closeSwatchPopup();

    // Flat color sections
    for (const group of COLOR_GROUPS) {
      this._renderColorSection(group);
    }

    // Design tokens
    this._renderDesignTokensSection();
  }

  // ─── Color Section (flat, no accordion) ────────────────────────────────

  private _renderColorSection(group: ColorGroup): void {
    const section = $('div.te__section');

    const header = $('div.te__section-header');
    const titleEl = $('h3.te__section-title');
    titleEl.textContent = group.label;
    header.appendChild(titleEl);
    if (group.hint) {
      const hintEl = $('span.te__section-hint');
      hintEl.textContent = group.hint;
      header.appendChild(hintEl);
    }
    section.appendChild(header);

    const grid = $('div.te__color-grid');

    for (const colorId of group.ids) {
      if (!this._colorRegistry.getRegisteredColor(colorId)) continue;

      const row = $('div.te__color-row');
      row.dataset.colorId = colorId;

      // Swatch button — click opens picker popup
      const swatch = $('button.te__swatch');
      const currentHex = this._resolveColorHex(colorId);
      swatch.style.background = currentHex;
      swatch.title = colorId;
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleSwatchPopup(colorId, swatch);
      });
      this._colorSwatches.set(colorId, swatch);

      // Label
      const label = $('span.te__label');
      const friendlyText = group.labels?.[colorId]
        ?? colorId.split('.').pop()!
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (s) => s.toUpperCase())
            .trim();
      label.textContent = friendlyText;
      label.title = colorId;

      // Hex input
      const hexInput = $('input.te__hex') as HTMLInputElement;
      hexInput.type = 'text';
      hexInput.value = currentHex.toUpperCase();
      hexInput.spellcheck = false;
      hexInput.maxLength = 7;
      hexInput.addEventListener('focus', () => this._pushUndo());
      hexInput.addEventListener('input', () => {
        let val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          this._commitColor(colorId, val);
        }
      });
      hexInput.addEventListener('blur', () => {
        hexInput.value = this._resolveColorHex(colorId).toUpperCase();
      });
      this._hexInputs.set(colorId, hexInput);

      // Reset button
      const resetBtn = $('button.te__reset');
      resetBtn.title = 'Reset to default';
      resetBtn.textContent = '\u21BA';
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._pushUndo();
        delete this._workingColors[colorId];
        const defaultHex = this._resolveColorHex(colorId);
        this._commitColor(colorId, defaultHex);
      });

      row.appendChild(swatch);
      row.appendChild(label);
      row.appendChild(hexInput);
      row.appendChild(resetBtn);
      grid.appendChild(row);
    }

    section.appendChild(grid);
    this._contentArea.appendChild(section);
  }

  // ─── Swatch Picker Popup ──────────────────────────────────────────────

  private _toggleSwatchPopup(colorId: string, anchorEl: HTMLElement): void {
    if (this._swatchPopupColorId === colorId) {
      this._closeSwatchPopup();
      return;
    }
    this._closeSwatchPopup();

    const popup = $('div.te__popup');

    // Color palette ramps
    for (const palette of SWATCH_PALETTES) {
      const ramp = $('div.te__popup-ramp');
      for (const hex of palette.colors) {
        const cell = $('button.te__popup-cell');
        cell.style.background = hex;
        cell.title = hex.toUpperCase();

        // Hover-preview: temporarily apply, revert on leave
        cell.addEventListener('mouseenter', () => {
          this._startHoverPreview(colorId, hex);
        });
        cell.addEventListener('mouseleave', () => {
          this._endHoverPreview(colorId);
        });
        // Click: commit
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          this._endHoverPreview(colorId); // clear preview state
          this._pushUndo();
          this._commitColor(colorId, hex);
          this._closeSwatchPopup();
        });
        ramp.appendChild(cell);
      }
      popup.appendChild(ramp);
    }

    // Native picker fallback
    const customRow = $('div.te__popup-custom');
    const customLabel = $('span');
    customLabel.textContent = 'Custom:';
    customRow.appendChild(customLabel);
    const nativeInput = $('input.te__popup-native') as HTMLInputElement;
    nativeInput.type = 'color';
    nativeInput.value = this._resolveColorHex(colorId);
    let nativeUndoPushed = false;
    nativeInput.addEventListener('input', () => {
      if (!nativeUndoPushed) { this._pushUndo(); nativeUndoPushed = true; }
      this._commitColor(colorId, nativeInput.value);
    });
    customRow.appendChild(nativeInput);
    popup.appendChild(customRow);

    // Position below anchor
    const anchorRect = anchorEl.getBoundingClientRect();
    const containerRect = this._container.getBoundingClientRect();
    popup.style.position = 'absolute';
    popup.style.left = `${anchorRect.left - containerRect.left}px`;
    popup.style.top = `${anchorRect.bottom - containerRect.top + 4}px`;

    this._container.appendChild(popup);
    this._swatchPopup = popup;
    this._swatchPopupColorId = colorId;

    // Close on click outside
    this._clickOutsideHandler = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node) && e.target !== anchorEl) {
        this._closeSwatchPopup();
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', this._clickOutsideHandler!, true);
    });
  }

  private _closeSwatchPopup(): void {
    if (this._swatchPopup) {
      this._swatchPopup.remove();
      this._swatchPopup = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('mousedown', this._clickOutsideHandler, true);
      this._clickOutsideHandler = null;
    }
    this._swatchPopupColorId = null;
    // If hover preview was active, revert
    if (this._hoverPreviewColorId) {
      this._endHoverPreview(this._hoverPreviewColorId);
    }
  }

  // ─── Hover Preview ────────────────────────────────────────────────────

  private _startHoverPreview(colorId: string, previewHex: string): void {
    // Save the committed value before preview
    if (this._hoverPreviewColorId !== colorId) {
      this._hoverPreviewOriginalHex = this._resolveColorHex(colorId);
      this._hoverPreviewColorId = colorId;
    }

    // Temporarily apply the preview color
    this._workingColors[colorId] = previewHex;
    this._applyWorkingThemeLive();

    // Update swatch visually
    const swatch = this._colorSwatches.get(colorId);
    if (swatch) swatch.style.background = previewHex;
    const hexInput = this._hexInputs.get(colorId);
    if (hexInput && document.activeElement !== hexInput) {
      hexInput.value = previewHex.toUpperCase();
    }
  }

  private _endHoverPreview(colorId: string): void {
    if (this._hoverPreviewColorId !== colorId || !this._hoverPreviewOriginalHex) return;

    // Revert to the committed value
    const originalHex = this._hoverPreviewOriginalHex;
    this._workingColors[colorId] = originalHex;
    this._applyWorkingThemeLive();

    // Revert swatch visuals
    const swatch = this._colorSwatches.get(colorId);
    if (swatch) swatch.style.background = originalHex;
    const hexInput = this._hexInputs.get(colorId);
    if (hexInput && document.activeElement !== hexInput) {
      hexInput.value = originalHex.toUpperCase();
    }

    this._hoverPreviewColorId = null;
    this._hoverPreviewOriginalHex = null;
  }

  // ─── Color Commit ─────────────────────────────────────────────────────

  /** Permanently apply a color change. */
  private _commitColor(colorId: string, hex: string): void {
    this._workingColors[colorId] = hex;

    // Clear hover preview state so it doesn't revert
    if (this._hoverPreviewColorId === colorId) {
      this._hoverPreviewColorId = null;
      this._hoverPreviewOriginalHex = null;
    }

    // Update swatch + hex input
    const swatch = this._colorSwatches.get(colorId);
    if (swatch) swatch.style.background = hex;
    const hexInput = this._hexInputs.get(colorId);
    if (hexInput && document.activeElement !== hexInput) {
      hexInput.value = hex.toUpperCase();
    }

    this._applyWorkingThemeLive();
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
    this._redoStack.push({ colors: { ...this._workingColors }, tokens: { ...this._workingTokens } });
    const prev = this._undoStack.pop()!;
    this._workingColors = { ...prev.colors };
    this._workingTokens = { ...prev.tokens };
    this._applyWorkingThemeLive();
    this._refreshAllSwatches();
    this._updateUndoRedoButtons();
  }

  private _redo(): void {
    if (this._redoStack.length === 0) return;
    this._undoStack.push({ colors: { ...this._workingColors }, tokens: { ...this._workingTokens } });
    const next = this._redoStack.pop()!;
    this._workingColors = { ...next.colors };
    this._workingTokens = { ...next.tokens };
    this._applyWorkingThemeLive();
    this._refreshAllSwatches();
    this._updateUndoRedoButtons();
  }

  private _updateUndoRedoButtons(): void {
    this._undoBtn.disabled = this._undoStack.length === 0;
    this._redoBtn.disabled = this._redoStack.length === 0;
  }

  // ─── Design Tokens ────────────────────────────────────────────────────

  private _renderDesignTokensSection(): void {
    const section = $('div.te__section');

    const header = $('div.te__section-header');
    const titleEl = $('h3.te__section-title');
    titleEl.textContent = 'Typography & Shape';
    header.appendChild(titleEl);
    section.appendChild(header);

    const grid = $('div.te__token-grid');
    grid.appendChild(this._createFontRow('UI Font', 'fontFamily.ui', FONT_FAMILIES));
    grid.appendChild(this._createFontRow('Mono Font', 'fontFamily.mono', MONO_FAMILIES));
    grid.appendChild(this._createSliderRow('Base Size', 'fontSize.base', 10, 16, 1, 'px'));
    grid.appendChild(this._createSliderRow('Border Radius', 'radius.md', 0, 12, 1, 'px'));
    grid.appendChild(this._createSliderRow('Large Radius', 'radius.lg', 0, 16, 1, 'px'));
    section.appendChild(grid);

    this._contentArea.appendChild(section);
  }

  private _createFontRow(label: string, tokenId: string, options: string[]): HTMLElement {
    const row = $('div.te__token-row');

    const lbl = $('span.te__token-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const select = $('select.te__token-select') as HTMLSelectElement;
    const currentVal = this._workingTokens[tokenId] || this._resolveDesignTokenValue(tokenId);
    for (const family of options) {
      const opt = $('option') as HTMLOptionElement;
      opt.value = family;
      opt.textContent = family.split(',')[0].replace(/'/g, '').trim();
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
    const row = $('div.te__token-row');

    const lbl = $('span.te__token-label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const current = this._workingTokens[tokenId] || this._resolveDesignTokenValue(tokenId);
    const numVal = parseInt(current, 10) || min;

    const slider = $('input.te__slider') as HTMLInputElement;
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(numVal);
    row.appendChild(slider);

    const valDisplay = $('span.te__slider-val');
    valDisplay.textContent = `${numVal}${unit}`;
    row.appendChild(valDisplay);

    let sliderUndoPushed = false;
    slider.addEventListener('mousedown', () => { sliderUndoPushed = false; });
    slider.addEventListener('input', () => {
      if (!sliderUndoPushed) { this._pushUndo(); sliderUndoPushed = true; }
      valDisplay.textContent = `${slider.value}${unit}`;
      this._workingTokens[tokenId] = `${slider.value}${unit}`;
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
      const ut = this._loadUserThemes().find(t => t.id === active.id);
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
    const isUser = this._loadUserThemes().some(t => t.id === id);
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

  private _refreshAllSwatches(): void {
    for (const [colorId, swatch] of this._colorSwatches) {
      const hex = this._resolveColorHex(colorId);
      swatch.style.background = hex;
      const hexInput = this._hexInputs.get(colorId);
      if (hexInput) hexInput.value = hex.toUpperCase();
    }
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
    this._refreshAllSwatches();
    this._showToast(`Applied "${preset.name}".`);
  }

  // ─── Save / Load ─────────────────────────────────────────────────────

  private _saveUserTheme(): void {
    if (this._editingUserThemeId) {
      this._doSaveTheme(this._workingLabel);
    } else {
      this._showSaveDialog();
    }
  }

  private _showSaveDialog(): void {
    const backdrop = $('div.te__dialog-backdrop');
    const dialog = $('div.te__dialog');

    const dialogTitle = $('div.te__dialog-title');
    dialogTitle.textContent = 'Save Theme As';
    dialog.appendChild(dialogTitle);

    const nameInput = $('input.te__dialog-input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.value = this._workingLabel || 'Custom Theme';
    nameInput.placeholder = 'Theme name';
    nameInput.maxLength = 50;
    dialog.appendChild(nameInput);

    const btnRow = $('div.te__dialog-actions');
    const cancelBtn = $('button.te__btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => backdrop.remove());
    btnRow.appendChild(cancelBtn);

    const confirmBtn = $('button.te__btn.te__btn--primary');
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
    requestAnimationFrame(() => { nameInput.select(); nameInput.focus(); });
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

    this._globalStorage.set(USER_THEMES_KEY, JSON.stringify(userThemes));
    updateUserThemesCache(userThemes);
    this._globalStorage.set(THEME_STORAGE_KEY, id);
    this._editingUserThemeId = id;
    this._workingLabel = label;

    const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
    this._themeService.applyTheme(theme);

    this._rebuildThemeDropdown();
    this._showToast(`Saved "${label}".`);
  }

  private _loadUserThemes(): ThemeSource[] {
    return getUserThemeSources();
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
            this._showToast('Invalid theme file.');
            return;
          }
          this._pushUndo();
          const source: ThemeSource = { ...parsed, id: `user-theme-${Date.now()}` };

          const userThemes = this._loadUserThemes();
          userThemes.push(source);
          this._globalStorage.set(USER_THEMES_KEY, JSON.stringify(userThemes));
          updateUserThemesCache(userThemes);

          this._loadThemeSourceAsWorking(source, source.id);
          const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
          this._themeService.applyTheme(theme);
          this._globalStorage.set(THEME_STORAGE_KEY, source.id);

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

  // ─── Toast ────────────────────────────────────────────────────────────

  private _showToast(msg: string): void {
    if (this._toastEl) { this._toastEl.remove(); this._toastEl = null; }
    if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }

    const toast = $('div.te__toast');
    toast.textContent = msg;
    this._container.appendChild(toast);
    this._toastEl = toast;

    requestAnimationFrame(() => toast.classList.add('te__toast--visible'));

    this._toastTimer = setTimeout(() => {
      toast.classList.remove('te__toast--visible');
      setTimeout(() => { toast.remove(); if (this._toastEl === toast) this._toastEl = null; }, 300);
    }, 2500);
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────

  private _setupKeyboardShortcuts(): void {
    this._keydownHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); this._undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); this._redo();
      }
    };
    this._container.addEventListener('keydown', this._keydownHandler, true);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

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
    this._closeSwatchPopup();
    if (this._keydownHandler) {
      this._container.removeEventListener('keydown', this._keydownHandler, true);
      this._keydownHandler = null;
    }
    if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }
    if (this._toastEl) { this._toastEl.remove(); this._toastEl = null; }
    this._container.innerHTML = '';
    this._colorSwatches.clear();
    this._hexInputs.clear();
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }
}
