// ThemeEditorPanel.ts — M49 Phase 4: User-facing theme customization UI
//
// Provides color pickers, font controls, radius/shadow sliders, and
// live preview. User themes are stored in localStorage alongside built-in themes.

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


// ─── Panel ────────────────────────────────────────────────────────────────────

export class ThemeEditorPanel implements IDisposable {
  private readonly _container: HTMLElement;
  private readonly _themeService: IThemeService;
  private readonly _colorRegistry: IColorRegistry;
  private readonly _designTokenRegistry: IDesignTokenRegistry;

  /** Working copy of theme colors (mutated by pickers). */
  private _workingColors: Record<string, string> = {};
  /** Working copy of design tokens. */
  private _workingTokens: Record<string, string> = {};
  /** Current theme label for the working copy. */
  private _workingLabel = 'Custom Theme';
  /** Whether working on a user theme vs a fresh customization. */
  private _editingUserThemeId: string | null = null;

  private _pickerStrip!: HTMLElement;
  private _contentArea!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _nameInput!: HTMLInputElement;

  /** Map of color-id → input element for batch updates. */
  private readonly _colorInputs = new Map<string, HTMLInputElement>();

  constructor(
    container: HTMLElement,
    themeService: IThemeService,
  ) {
    this._container = container;
    this._themeService = themeService;
    this._colorRegistry = colorRegistry;
    this._designTokenRegistry = designTokenRegistry;

    this._render();
    this._loadCurrentThemeAsWorking();
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._container.classList.add('theme-editor');

    // Header
    const header = $('div.theme-editor__header');
    const title = $('div.theme-editor__title');
    title.textContent = 'Theme Editor';
    header.appendChild(title);

    const actions = $('div.theme-editor__actions');

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

    header.appendChild(actions);
    this._container.appendChild(header);

    // Theme picker strip
    this._pickerStrip = $('div.theme-editor__picker');
    this._container.appendChild(this._pickerStrip);

    // Scrollable content
    this._contentArea = $('div.theme-editor__content');
    this._container.appendChild(this._contentArea);

    // Status bar
    this._statusEl = $('div.theme-editor__status');
    this._statusEl.textContent = 'Select a theme or customize colors below.';
    this._container.appendChild(this._statusEl);

    this._rebuildPickerStrip();
    this._rebuildContent();
  }

  // ─── Picker Strip ───────────────────────────────────────────────────────

  private _rebuildPickerStrip(): void {
    this._pickerStrip.innerHTML = '';
    const activeId = this._themeService.activeTheme.id;

    // Built-in themes
    for (const entry of getAvailableThemes()) {
      this._pickerStrip.appendChild(this._createPickerItem(entry.id, entry.label, entry, activeId));
    }

    // User themes
    for (const ut of this._loadUserThemes()) {
      this._pickerStrip.appendChild(this._createPickerItem(ut.id, ut.label, { ...ut, source: ut }, activeId));
    }
  }

  private _createPickerItem(id: string, label: string, entry: { source: ThemeSource }, activeId: string): HTMLElement {
    const item = $('button.theme-editor__picker-item');
    if (id === activeId) item.classList.add('theme-editor__picker-item--active');

    // Small swatch showing the theme's editor background + accent
    const swatch = $('div.theme-editor__picker-swatch');
    const bg = entry.source.colors['editor.background'] || '#1e1e1e';
    const accent = entry.source.colors['button.background'] || '#007acc';
    swatch.style.background = `linear-gradient(135deg, ${bg} 60%, ${accent} 100%)`;
    item.appendChild(swatch);

    const text = $('span');
    text.textContent = label;
    item.appendChild(text);

    item.addEventListener('click', () => {
      const theme = ColorThemeData.fromSource(entry.source, this._colorRegistry, this._designTokenRegistry);
      this._themeService.applyTheme(theme);
      localStorage.setItem(THEME_STORAGE_KEY, id);
      this._loadThemeSourceAsWorking(entry.source, id);
      this._rebuildPickerStrip();
      this._refreshColorInputs();
      this._setStatus(`Applied "${label}".`);
    });

    return item;
  }

  // ─── Content Sections ──────────────────────────────────────────────────

  private _rebuildContent(): void {
    this._contentArea.innerHTML = '';
    this._colorInputs.clear();

    // Theme name
    this._renderNameSection();

    // Preset buttons
    this._renderPresetSection();

    // Color groups
    for (const group of COLOR_GROUPS) {
      this._renderColorGroup(group);
    }

    // Typography
    this._renderTypographySection();

    // Shape
    this._renderShapeSection();
  }

  private _renderNameSection(): void {
    const section = $('div.theme-editor__section');
    const row = $('div.theme-editor__name-row');

    const label = $('label.theme-editor__font-label');
    label.textContent = 'Theme Name';
    row.appendChild(label);

    this._nameInput = $('input.theme-editor__name-input') as HTMLInputElement;
    this._nameInput.type = 'text';
    this._nameInput.value = this._workingLabel;
    this._nameInput.addEventListener('input', () => {
      this._workingLabel = this._nameInput.value;
    });
    row.appendChild(this._nameInput);

    section.appendChild(row);
    this._contentArea.appendChild(section);
  }

  private _renderPresetSection(): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Quick Presets';
    section.appendChild(title);

    const strip = $('div.theme-editor__presets');
    for (const preset of PRESETS) {
      const btn = $('button.theme-editor__preset-btn');
      btn.textContent = preset.name;
      btn.addEventListener('click', () => this._applyPreset(preset));
      strip.appendChild(btn);
    }
    section.appendChild(strip);
    this._contentArea.appendChild(section);
  }

  private _renderColorGroup(group: { label: string; ids: string[] }): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = group.label;
    section.appendChild(title);

    const grid = $('div.theme-editor__color-grid');

    for (const colorId of group.ids) {
      // Only show colors that are actually registered
      if (!this._colorRegistry.getRegisteredColor(colorId)) continue;

      const row = $('div.theme-editor__color-row');

      const input = $('input.theme-editor__color-input') as HTMLInputElement;
      input.type = 'color';
      input.value = this._resolveColorHex(colorId);
      input.title = colorId;
      input.addEventListener('input', () => {
        this._workingColors[colorId] = input.value;
        this._applyWorkingThemeLive();
      });

      this._colorInputs.set(colorId, input);

      const label = $('span.theme-editor__color-label');
      // Show friendly name: "editor.background" → "Background"
      const parts = colorId.split('.');
      label.textContent = parts[parts.length - 1]
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
      label.title = colorId;

      row.appendChild(input);
      row.appendChild(label);
      grid.appendChild(row);
    }

    section.appendChild(grid);
    this._contentArea.appendChild(section);
  }

  private _renderTypographySection(): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Typography';
    section.appendChild(title);

    // UI Font
    section.appendChild(this._createFontRow('UI Font', 'fontFamily.ui', FONT_FAMILIES));

    // Monospace Font
    section.appendChild(this._createFontRow('Mono Font', 'fontFamily.mono', MONO_FAMILIES));

    // Base font size slider
    section.appendChild(this._createSliderRow('Base Size', 'fontSize.base', 10, 16, 1, 'px'));

    this._contentArea.appendChild(section);
  }

  private _renderShapeSection(): void {
    const section = $('div.theme-editor__section');
    const title = $('div.theme-editor__section-title');
    title.textContent = 'Shape';
    section.appendChild(title);

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
      // Show short version
      const short = family.split(',')[0].replace(/'/g, '').trim();
      opt.textContent = short;
      if (family === currentVal) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
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

    slider.addEventListener('input', () => {
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
    // Try to find source from catalog
    const entry = getAvailableThemes().find(t => t.id === active.id);
    if (entry) {
      this._loadThemeSourceAsWorking(entry.source, entry.id);
    } else {
      // Maybe a user theme
      const userThemes = this._loadUserThemes();
      const ut = userThemes.find(t => t.id === active.id);
      if (ut) {
        this._loadThemeSourceAsWorking(ut, ut.id);
      } else {
        // Fallback: read colors from registry defaults
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

    // If it's a user theme, track for overwrite on save
    const userThemes = this._loadUserThemes();
    const isUser = userThemes.some(t => t.id === id);
    this._editingUserThemeId = isUser ? id : null;

    if (this._nameInput) {
      this._nameInput.value = this._workingLabel;
    }
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
      input.value = this._resolveColorHex(colorId);
    }
  }

  // ─── Presets ───────────────────────────────────────────────────────────

  private _applyPreset(preset: typeof PRESETS[0]): void {
    // Build a minimal color map from the preset
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
    if (this._nameInput) this._nameInput.value = preset.name;

    this._applyWorkingThemeLive();
    this._refreshColorInputs();
    this._setStatus(`Applied preset "${preset.name}". Customize further or Save.`);
  }

  // ─── Save / Load User Themes ──────────────────────────────────────────

  private _saveUserTheme(): void {
    const label = this._workingLabel.trim() || 'Custom Theme';
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

    // Apply it
    const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
    this._themeService.applyTheme(theme);

    this._rebuildPickerStrip();
    this._setStatus(`Saved "${label}".`);
  }

  private _loadUserThemes(): ThemeSource[] {
    try {
      const raw = localStorage.getItem(USER_THEMES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Basic validation
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
    this._setStatus('Theme exported.');
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
            this._setStatus('Invalid theme file: missing required fields.');
            return;
          }
          // Ensure unique ID
          const source: ThemeSource = { ...parsed, id: `user-theme-${Date.now()}` };

          const userThemes = this._loadUserThemes();
          userThemes.push(source);
          localStorage.setItem(USER_THEMES_KEY, JSON.stringify(userThemes));

          // Apply immediately
          this._loadThemeSourceAsWorking(source, source.id);
          const theme = ColorThemeData.fromSource(source, this._colorRegistry, this._designTokenRegistry);
          this._themeService.applyTheme(theme);
          localStorage.setItem(THEME_STORAGE_KEY, source.id);

          this._rebuildPickerStrip();
          this._rebuildContent();
          this._setStatus(`Imported "${source.label}".`);
        } catch {
          this._setStatus('Failed to parse theme file.');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private _resolveColorHex(colorId: string): string {
    // First check working copy
    const working = this._workingColors[colorId];
    if (working && working.startsWith('#')) return working.length === 4 ? this._expandShortHex(working) : working.substring(0, 7);

    // Then active theme
    const themeVal = this._themeService.activeTheme.getColor(colorId);
    if (themeVal && themeVal.startsWith('#')) return themeVal.length === 4 ? this._expandShortHex(themeVal) : themeVal.substring(0, 7);

    // Fallback
    return '#808080';
  }

  private _expandShortHex(hex: string): string {
    // #abc → #aabbcc
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
    // Simple brightness heuristic
    const r = parseInt(bg.substring(1, 3), 16) || 0;
    const g = parseInt(bg.substring(3, 5), 16) || 0;
    const b = parseInt(bg.substring(5, 7), 16) || 0;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? 'vs' : 'vs-dark';
  }

  private _setStatus(msg: string): void {
    this._statusEl.textContent = msg;
  }

  // ─── IDisposable ──────────────────────────────────────────────────────

  dispose(): void {
    this._container.innerHTML = '';
    this._colorInputs.clear();
  }
}
