// appearanceDrawer.ts — the per-widget look editor, host-agnostic.
//
// Extracted from DashboardEditorPane._openAppearanceDrawer so a widget
// seated in the WORKBENCH edits its look with exactly the drawer a
// dashboard card gets: background, border, title, title visibility, and
// content alignment — previewed live on the card, saved through whichever
// host owns persistence. The drawer's DOM classes are the dashboard's
// settings-sheet family; dashboard.css is a global stylesheet, so the
// sheet renders identically wherever it opens.
//
// The createSelect import forms a module cycle with the editor provider
// (it imports this drawer). Safe by construction: both sides touch each
// other only inside functions called long after module evaluation — no
// init-time binding reads, no TDZ.

import type { WidgetAppearance } from './dashboardTypes.js';
import { applyWidgetAppearance } from './widgetAppearance.js';
import { createSelect } from './dashboardEditorProvider.js';
import { attachPopupDismiss } from '../../ui/dom.js';

export interface AppearanceDrawerHost {
  /** The live card the draft previews onto. */
  readonly card: HTMLElement;
  /** The appearance as persisted — restored on cancel. */
  readonly appearance: WidgetAppearance;
  /** Placeholder for the title field (the widget type's display name). */
  readonly defaultTitle: string;
  /** Persist. Throwing keeps the drawer open after showError. */
  onSave(next: WidgetAppearance): Promise<void>;
  showError(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function isHexColor(v: string | null): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function openAppearanceDrawer(host: AppearanceDrawerHost): void {
  const original = host.appearance;

  const overlay = el('div', 'dashboard-settings-overlay');
  // Every exit routes through here. The dropdowns in this drawer hold
  // document/window listeners and, while open, a list mounted on
  // document.body — so removing the overlay alone would accumulate
  // listeners across opens and could strand a floating option list.
  const selects: ReturnType<typeof createSelect>[] = [];
  let detachDismiss: (() => void) | undefined;
  const closeDrawer = (): void => {
    detachDismiss?.();
    for (const s of selects) s.dispose();
    overlay.remove();
  };

  const sheet = el('aside', 'dashboard-settings');

  // Standard popup contract (Escape / outside press / window blur — the
  // drawer previously had NO Escape at all). Every non-Save exit cancels:
  // the live preview reverts to the persisted look. Dropdown option lists
  // mount on document.body, outside the sheet — pressing one must not
  // count as leaving the drawer.
  detachDismiss = attachPopupDismiss(sheet, () => {
    applyWidgetAppearance(host.card, original);
    closeDrawer();
  }, {
    isDismissable: (e) => !(e.target as Element | null)?.closest?.('.ui-dropdown__list'),
  });

  const head = el('div', 'dashboard-settings__head');
  const ht = el('h2', 'dashboard-settings__title');
  ht.textContent = 'Appearance';
  head.appendChild(ht);
  const hint = el('p', 'dashboard-settings__hint');
  hint.textContent = 'Background, border and content placement for this widget. Changes preview live.';
  head.appendChild(hint);
  sheet.appendChild(head);

  const body = el('div', 'dashboard-settings__body');
  sheet.appendChild(body);

  // Working copy mutated by the controls; previewed live on the card.
  const draft: { -readonly [K in keyof WidgetAppearance]: WidgetAppearance[K] } = { ...original };
  const preview = (): void => applyWidgetAppearance(host.card, draft);

  // ── Background ──
  const bgBlock = el('div', 'dashboard-field');
  const bgLabel = el('label', 'dashboard-field__label');
  bgLabel.textContent = 'Background';
  bgBlock.appendChild(bgLabel);
  const bgColor = document.createElement('input');
  bgColor.type = 'color';
  bgColor.className = 'dashboard-field__color';
  bgColor.value = isHexColor(draft.backgroundColor) ? draft.backgroundColor : '#1e1e1e';
  bgColor.style.display = draft.background === 'custom' ? '' : 'none';
  const bgSelect = createSelect(
    [{ value: 'default', label: 'Theme default' }, { value: 'transparent', label: 'Transparent' }, { value: 'custom', label: 'Custom color' }],
    draft.background,
    (v) => {
      draft.background = v as WidgetAppearance['background'];
      bgColor.style.display = draft.background === 'custom' ? '' : 'none';
      if (draft.background === 'custom') draft.backgroundColor = bgColor.value;
      preview();
    },
  );
  selects.push(bgSelect);
  bgBlock.appendChild(bgSelect.el);
  bgBlock.appendChild(bgColor);
  bgColor.addEventListener('input', () => { draft.backgroundColor = bgColor.value; preview(); });
  body.appendChild(bgBlock);

  // ── Border ──
  const bdBlock = el('div', 'dashboard-field');
  const bdLabel = el('label', 'dashboard-field__label');
  bdLabel.textContent = 'Border';
  bdBlock.appendChild(bdLabel);
  const bdColor = document.createElement('input');
  bdColor.type = 'color';
  bdColor.className = 'dashboard-field__color';
  bdColor.value = isHexColor(draft.borderColor) ? draft.borderColor : '#3c3c3c';
  bdColor.style.display = draft.border === 'custom' ? '' : 'none';
  const bdSelect = createSelect(
    [{ value: 'default', label: 'Theme default' }, { value: 'none', label: 'No border' }, { value: 'custom', label: 'Custom color' }],
    draft.border,
    (v) => {
      draft.border = v as WidgetAppearance['border'];
      bdColor.style.display = draft.border === 'custom' ? '' : 'none';
      if (draft.border === 'custom') draft.borderColor = bdColor.value;
      preview();
    },
  );
  selects.push(bdSelect);
  bdBlock.appendChild(bdSelect.el);
  bdBlock.appendChild(bdColor);
  bdColor.addEventListener('input', () => { draft.borderColor = bdColor.value; preview(); });
  body.appendChild(bdBlock);

  // ── Content alignment ──
  const alignBlock = el('div', 'dashboard-field');
  const alignLabel = el('label', 'dashboard-field__label');
  alignLabel.textContent = 'Content';
  alignBlock.appendChild(alignLabel);
  const alignSelect = createSelect(
    [
      { value: 'start', label: 'Top left' },
      { value: 'start-padded', label: 'Top left with margin' },
      { value: 'center', label: 'Centered' },
    ],
    draft.contentAlign ?? 'start',
    (v) => {
      draft.contentAlign = v as NonNullable<WidgetAppearance['contentAlign']>;
      preview();
    },
  );
  selects.push(alignSelect);
  alignBlock.appendChild(alignSelect.el);
  body.appendChild(alignBlock);

  // ── Title ──
  const titleBlock = el('div', 'dashboard-field');
  const titleLabel = el('label', 'dashboard-field__label');
  titleLabel.textContent = 'Title';
  titleBlock.appendChild(titleLabel);
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'dashboard-field__input';
  titleInput.value = draft.title ?? '';
  titleInput.placeholder = host.defaultTitle;
  titleBlock.appendChild(titleInput);
  titleInput.addEventListener('input', () => {
    draft.title = titleInput.value.trim() ? titleInput.value : null;
    preview();
  });
  body.appendChild(titleBlock);

  // ── Hide title ──
  const hideBlock = el('div', 'dashboard-field');
  const hideRow = el('div', 'dashboard-field__checkbox-row');
  const hideCheckbox = document.createElement('input');
  hideCheckbox.type = 'checkbox';
  hideCheckbox.checked = draft.titleHidden;
  hideRow.appendChild(hideCheckbox);
  const hideText = document.createElement('span');
  hideText.textContent = 'Hide title bar';
  hideRow.appendChild(hideText);
  hideBlock.appendChild(hideRow);
  hideCheckbox.addEventListener('change', () => { draft.titleHidden = hideCheckbox.checked; preview(); });
  body.appendChild(hideBlock);

  const foot = el('div', 'dashboard-settings__foot');
  const cancel = el('button', 'dashboard-btn dashboard-btn--ghost');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    applyWidgetAppearance(host.card, original);
    closeDrawer();
  });
  foot.appendChild(cancel);
  const save = el('button', 'dashboard-btn dashboard-btn--primary');
  save.type = 'button';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    const next: WidgetAppearance = {
      background: draft.background,
      backgroundColor: draft.background === 'custom' ? bgColor.value : null,
      border: draft.border,
      borderColor: draft.border === 'custom' ? bdColor.value : null,
      title: titleInput.value.trim() ? titleInput.value.trim() : null,
      titleHidden: hideCheckbox.checked,
      contentAlign: draft.contentAlign ?? 'start',
    };
    try {
      await host.onSave(next);
      applyWidgetAppearance(host.card, next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.showError(`Could not save appearance: ${msg}`);
      return;
    }
    closeDrawer();
  });
  foot.appendChild(save);
  sheet.appendChild(foot);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
