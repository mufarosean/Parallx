// style-preview.js — the writing styles, visible where they are chosen.
//
// A writing style was a name in a dropdown: nobody could read what
// "Immersive RP" tells the model, and a custom style had to be written from
// nothing. Under every style dropdown (Settings, the character card, a
// chat's own override) a Style Text disclosure now shows the chosen
// preset's full text and the short reminder of it that rides right before
// the reply; the Custom preset shows the custom text, or says it is empty.
// In Settings, Start Custom From This copies the shown text into the custom
// style, so a custom style begins from the shipped one nearest to it.
//
// Drawn with the kit alone (blocks and buttons); its styles are in main.js's
// sheet with the rest of the Settings form's.

import { WRITING_PRESETS, STYLE_HINTS } from './writing-style.js';

/** What a preset sends, in words a reader can check: the full text and the late reminder. */
export function describePreset(key, customText = '') {
  const k = key || 'immersive-rp';
  if (k === 'none') return { label: WRITING_PRESETS.none.label, text: '', hint: '', note: 'No style text is sent. The character\'s card and the conversation rules still apply.' };
  if (k === 'custom') {
    const text = String(customText || '').trim();
    return { label: WRITING_PRESETS.custom.label, text, hint: '', note: text ? 'Sent exactly as written, under "## Writing Style".' : 'Empty. Write it in Settings, under Custom writing style, or start it from a preset there.' };
  }
  const preset = WRITING_PRESETS[k] || WRITING_PRESETS['immersive-rp'];
  const hint = STYLE_HINTS[k] || '';
  return { label: preset.label, text: preset.content, hint, note: hint ? 'Sent at the top of the prompt; the short line below is repeated right before the reply, where the model attends most.' : 'Sent at the top of the prompt.' };
}

/**
 * The Style Text disclosure under a style dropdown. `select` is the
 * dropdown ({ value }); the caller calls `refresh()` when it changes.
 * `customText` gives the custom style's text (a string, or a function
 * returning one or a promise of one). `onStartCustom(text)` adds Start
 * Custom From This, shown for a shipped preset only.
 */
export function mountStylePreview(host, ui, select, { customText = '', onStartCustom = null, idBase = 'textGenerator.style' } = {}) {
  const wrap = ui.createBlock(host, 'div', { className: 'tg-style-preview' });
  const body = ui.createBlock(null, 'div', { className: 'tg-style-preview-body' });
  body.hidden = true;
  const toggle = ui.createButton(wrap, { id: `${idBase}.showText`, label: 'Style Text', kind: 'ghost', size: 'sm', icon: 'eye', title: 'Show what this style tells the model', onClick: () => { body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden)); if (!body.hidden) void refresh(); } });
  toggle.setAttribute('aria-expanded', 'false');
  wrap.appendChild(body);
  const note = ui.createBlock(body, 'p', { className: 'tg-style-preview-hint' });
  const text = ui.createBlock(body, 'div', { className: 'tg-style-preview-text', attrs: { role: 'region', 'aria-label': 'Style text', tabindex: '0' } });
  const hint = ui.createBlock(body, 'p', { className: 'tg-style-preview-hint' });
  let start = null;
  if (onStartCustom) {
    const actions = ui.createBlock(body, 'div', { className: 'tg-style-preview-actions' });
    start = ui.createButton(actions, { id: `${idBase}.startCustom`, label: 'Start Custom From This', kind: 'secondary', size: 'sm', icon: 'copy', title: 'Copy this text into the custom style, to edit', onClick: () => onStartCustom(describePreset(select.value, '').text) });
  }
  async function refresh() {
    const custom = typeof customText === 'function' ? await customText() : customText;
    const d = describePreset(select.value, custom);
    note.textContent = d.note;
    text.textContent = d.text;
    text.hidden = !d.text;
    hint.textContent = d.hint ? `Repeated before the reply: ${d.hint}` : '';
    hint.hidden = !d.hint;
    if (start) start.hidden = !d.text || select.value === 'custom' || select.value === 'none';
  }
  void refresh();
  /** A line in the disclosure, in place of the note, until the next refresh. */
  const say = (message) => { body.hidden = false; toggle.setAttribute('aria-expanded', 'true'); note.textContent = message; };
  return { element: wrap, refresh, say, get open() { return !body.hidden; } };
}

/**
 * The Settings page's preview under the default preset dropdown, tied to
 * the custom style textarea: Custom shows what is typed, and Start Custom
 * From This fills an empty textarea with the shown preset and switches the
 * dropdown to Custom. A textarea with text in it is never overwritten: the
 * disclosure says so and nothing changes until it is cleared.
 */
export function mountCustomStylePreview(ui, presetSelect, input) {
  const preview = mountStylePreview(presetSelect.element.parentElement, ui, presetSelect, {
    customText: () => input.value,
    idBase: 'textGenerator.settings.style',
    onStartCustom: (text) => {
      if (input.value.trim()) { preview.say('The custom style already has text. Clear it first to start again from a preset.'); input.focus(); return; }
      input.value = text;
      presetSelect.value = 'custom';
      void preview.refresh();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
  input.addEventListener('input', () => { if (presetSelect.value === 'custom' && preview.open) void preview.refresh(); });
  return preview;
}
