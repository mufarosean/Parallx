// pxAppearancePanel.ts — M83 Appearance editor (the working theming UI).
//
// Replaces the old per-color VS Code-style editor. The new design language is
// token-driven (--px-*), so the user only needs two controls:
//   • Base palette  — Slate / Warm / Ember
//   • Accent        — a curated set, or a custom hue
// Changes apply live to :root and persist to localStorage (applied on boot).
//
// Same constructor signature as the old ThemeEditorPanel so every entry point
// (command palette, Ctrl+Shift+T, Tools menu, editor pane) keeps working.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IThemeService } from '../../services/serviceTypes.js';
import type { IStorage } from '../../platform/storage.js';
import {
  PX_BASE_THEMES,
  PX_ACCENTS,
  readAppearance,
  writeAppearance,
  applyAppearance,
  readPresets,
  savePreset,
  deletePreset,
  type PxAppearanceState,
  type PxBaseTheme,
} from '../../theme/pxAppearance.js';

import './pxAppearance.css';

export class PxAppearancePanel implements IDisposable {
  private readonly _container: HTMLElement;
  private _state: PxAppearanceState;
  private _disposed = false;

  // Re-render hooks for selection rings.
  private readonly _baseCards = new Map<PxBaseTheme, HTMLElement>();
  private readonly _accentChips = new Map<string, HTMLElement>();
  private _hueRow?: HTMLElement;
  private _hueInput?: HTMLInputElement;
  private _presetsRow?: HTMLElement;

  constructor(container: HTMLElement, _themeService?: IThemeService, _globalStorage?: IStorage) {
    this._container = container;
    this._state = readAppearance();
    this._render();
  }

  private _commit(): void {
    applyAppearance(this._state);
    writeAppearance(this._state);
  }

  private _render(): void {
    const root = document.createElement('div');
    root.className = 'px-appearance';

    // ── Header ──────────────────────────────────────────────────────────
    const header = document.createElement('header');
    header.className = 'px-appearance-header';
    const h1 = document.createElement('h1');
    h1.className = 'px-appearance-title';
    h1.textContent = 'Appearance';
    const sub = document.createElement('p');
    sub.className = 'px-appearance-subtitle';
    sub.textContent = 'Tune the palette and accent. Changes apply instantly across the workbench and every extension.';
    header.appendChild(h1);
    header.appendChild(sub);
    root.appendChild(header);

    // ── Scroll body ─────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'px-appearance-body';

    body.appendChild(this._renderBaseSection());
    body.appendChild(this._renderAccentSection());
    body.appendChild(this._renderPreviewSection());
    body.appendChild(this._renderSavedSection());

    root.appendChild(body);
    this._container.appendChild(root);
  }

  // ── Base palette ──────────────────────────────────────────────────────
  private _renderBaseSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'px-appearance-section';

    section.appendChild(this._sectionHeading('Base palette', 'The overall mood of every surface.'));

    const grid = document.createElement('div');
    grid.className = 'px-appearance-base-grid';

    for (const theme of PX_BASE_THEMES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'px-base-card';
      card.dataset.theme = theme.id;
      if (this._state.base === theme.id) card.classList.add('is-selected');

      // Mini surface preview rendered in the theme's own colors.
      const preview = document.createElement('div');
      preview.className = `px-base-card-preview px-theme-${theme.id}`;
      preview.innerHTML =
        '<span class="px-bc-side"></span>' +
        '<span class="px-bc-main"><span class="px-bc-bar"></span><span class="px-bc-line"></span><span class="px-bc-line short"></span></span>';
      card.appendChild(preview);

      const meta = document.createElement('div');
      meta.className = 'px-base-card-meta';
      const name = document.createElement('span');
      name.className = 'px-base-card-name';
      name.textContent = theme.label;
      const desc = document.createElement('span');
      desc.className = 'px-base-card-desc';
      desc.textContent = theme.desc;
      meta.appendChild(name);
      meta.appendChild(desc);
      card.appendChild(meta);

      card.addEventListener('click', () => {
        this._state.base = theme.id;
        this._commit();
        this._syncBaseSelection();
      });

      this._baseCards.set(theme.id, card);
      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  private _syncBaseSelection(): void {
    for (const [id, card] of this._baseCards) {
      card.classList.toggle('is-selected', this._state.base === id);
    }
  }

  // ── Accent ────────────────────────────────────────────────────────────
  private _renderAccentSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'px-appearance-section';

    section.appendChild(this._sectionHeading('Accent', 'The single highlight color — selection, focus, primary actions.'));

    const row = document.createElement('div');
    row.className = 'px-appearance-accent-row';

    for (const accent of PX_ACCENTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'px-accent-chip';
      chip.title = accent.label;
      chip.setAttribute('aria-label', `Accent: ${accent.label}`);
      chip.style.setProperty('--chip', `hsl(${accent.h} ${accent.s}% ${accent.l}%)`);
      if (this._state.accent === accent.id) chip.classList.add('is-selected');

      const dot = document.createElement('span');
      dot.className = 'px-accent-chip-dot';
      chip.appendChild(dot);
      const label = document.createElement('span');
      label.className = 'px-accent-chip-label';
      label.textContent = accent.label;
      chip.appendChild(label);

      chip.addEventListener('click', () => {
        this._state.accent = accent.id;
        this._commit();
        this._syncAccentSelection();
      });

      this._accentChips.set(accent.id, chip);
      row.appendChild(chip);
    }

    // Custom hue chip
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'px-accent-chip px-accent-chip--custom';
    custom.title = 'Custom hue';
    custom.setAttribute('aria-label', 'Custom accent hue');
    if (this._state.accent === 'custom') custom.classList.add('is-selected');
    const wheel = document.createElement('span');
    wheel.className = 'px-accent-chip-dot px-accent-chip-dot--wheel';
    custom.appendChild(wheel);
    const customLabel = document.createElement('span');
    customLabel.className = 'px-accent-chip-label';
    customLabel.textContent = 'Custom';
    custom.appendChild(customLabel);
    custom.addEventListener('click', () => {
      this._state.accent = 'custom';
      if (typeof this._state.customHue !== 'number') this._state.customHue = 265;
      this._commit();
      this._syncAccentSelection();
    });
    this._accentChips.set('custom', custom);
    row.appendChild(custom);

    section.appendChild(row);

    // Custom hue slider (revealed when 'custom' selected)
    const hueRow = document.createElement('div');
    hueRow.className = 'px-appearance-hue-row';
    const hueInput = document.createElement('input');
    hueInput.type = 'range';
    hueInput.min = '0';
    hueInput.max = '360';
    hueInput.step = '1';
    hueInput.className = 'px-hue-slider';
    hueInput.value = String(this._state.customHue ?? 265);
    hueInput.addEventListener('input', () => {
      this._state.accent = 'custom';
      this._state.customHue = Number(hueInput.value);
      this._commit();
      this._syncAccentSelection();
    });
    hueRow.appendChild(hueInput);
    this._hueRow = hueRow;
    this._hueInput = hueInput;
    section.appendChild(hueRow);

    this._syncAccentSelection();
    return section;
  }

  private _syncAccentSelection(): void {
    for (const [id, chip] of this._accentChips) {
      chip.classList.toggle('is-selected', this._state.accent === id);
    }
    if (this._hueRow) {
      this._hueRow.classList.toggle('is-visible', this._state.accent === 'custom');
    }
    if (this._hueInput && typeof this._state.customHue === 'number') {
      this._hueInput.value = String(this._state.customHue);
    }
  }

  // ── Live preview ──────────────────────────────────────────────────────
  private _renderPreviewSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'px-appearance-section';
    section.appendChild(this._sectionHeading('Preview', 'A live sample using your current tokens.'));

    const card = document.createElement('div');
    card.className = 'px-appearance-preview';
    card.innerHTML = `
      <div class="px-pv-toolbar">
        <span class="px-pv-dot"></span>
        <span class="px-pv-tab is-active">Overview</span>
        <span class="px-pv-tab">Details</span>
        <span class="px-pv-grow"></span>
        <button class="px-pv-btn" type="button">Primary</button>
      </div>
      <div class="px-pv-content">
        <p class="px-pv-text">A crafted workbench, tuned to your taste.</p>
        <p class="px-pv-muted">Press <kbd>Ctrl</kbd><kbd>K</kbd> to run a command.</p>
        <div class="px-pv-chips">
          <span class="px-pv-chip is-accent">Selected</span>
          <span class="px-pv-chip">Idle</span>
          <a class="px-pv-link" href="#">A link</a>
        </div>
      </div>`;
    // Prevent the sample link from navigating.
    card.querySelector('.px-pv-link')?.addEventListener('click', e => e.preventDefault());
    section.appendChild(card);
    return section;
  }

  // ── Saved looks (create / recall custom themes) ───────────────────────
  private _renderSavedSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'px-appearance-section';
    section.appendChild(this._sectionHeading('Your themes', 'Save the current palette + accent as a named theme to recall later.'));

    // Save bar — name input + save button.
    const saveBar = document.createElement('div');
    saveBar.className = 'px-appearance-savebar';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'px-appearance-name-input';
    nameInput.placeholder = 'Name this look…';
    nameInput.maxLength = 32;
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'px-appearance-save-btn';
    saveBtn.textContent = 'Save current';
    const doSave = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      savePreset(name, this._state);
      nameInput.value = '';
      this._refreshPresets();
    };
    saveBtn.addEventListener('click', doSave);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    saveBar.appendChild(nameInput);
    saveBar.appendChild(saveBtn);
    section.appendChild(saveBar);

    const row = document.createElement('div');
    row.className = 'px-appearance-presets-row';
    this._presetsRow = row;
    section.appendChild(row);
    this._refreshPresets();

    return section;
  }

  private _refreshPresets(): void {
    const row = this._presetsRow;
    if (!row) return;
    row.replaceChildren();

    const presets = readPresets();
    if (presets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'px-appearance-presets-empty';
      empty.textContent = 'No saved themes yet.';
      row.appendChild(empty);
      return;
    }

    for (const preset of presets) {
      const chip = document.createElement('div');
      chip.className = 'px-preset-chip';

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'px-preset-chip-apply';
      apply.title = `Apply ${preset.name}`;

      // Swatch reflecting the preset's accent.
      const accent = PX_ACCENTS.find(a => a.id === preset.accent);
      const swatchColor = preset.accent === 'custom' && typeof preset.customHue === 'number'
        ? `hsl(${preset.customHue} 58% 62%)`
        : accent ? `hsl(${accent.h} ${accent.s}% ${accent.l}%)` : 'var(--px-accent)';
      const dot = document.createElement('span');
      dot.className = 'px-preset-chip-dot';
      dot.style.background = swatchColor;
      apply.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'px-preset-chip-name';
      label.textContent = preset.name;
      apply.appendChild(label);

      apply.addEventListener('click', () => {
        this._state = { base: preset.base, accent: preset.accent, customHue: preset.customHue };
        this._commit();
        this._syncBaseSelection();
        this._syncAccentSelection();
      });
      chip.appendChild(apply);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'px-preset-chip-del';
      del.title = `Delete ${preset.name}`;
      del.setAttribute('aria-label', `Delete ${preset.name}`);
      del.textContent = '×';
      del.addEventListener('click', () => {
        deletePreset(preset.id);
        this._refreshPresets();
      });
      chip.appendChild(del);

      row.appendChild(chip);
    }
  }

  private _sectionHeading(title: string, hint: string): HTMLElement {
    const head = document.createElement('div');
    head.className = 'px-appearance-section-head';
    const t = document.createElement('h2');
    t.className = 'px-appearance-section-title';
    t.textContent = title;
    const h = document.createElement('p');
    h.className = 'px-appearance-section-hint';
    h.textContent = hint;
    head.appendChild(t);
    head.appendChild(h);
    return head;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._baseCards.clear();
    this._accentChips.clear();
    this._container.replaceChildren();
  }
}
