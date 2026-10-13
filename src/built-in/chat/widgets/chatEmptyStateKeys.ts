// chatEmptyStateKeys.ts — the empty state's hairline strip (/ commands ·
// @ context · the mode) and the offline notice, each control in the scene.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { $, append } from '../../../ui/dom.js';
import { declareControl } from '../../../ui/kit.js';
import { ChatModePicker, MODE_META } from '../pickers/chatModePicker.js';

export interface IEmptyStateKeysHost {
  /** Puts `/` or `@` in the input, which opens the matching menu. */
  insertTrigger(char: '/' | '@'): void;
  /** The mode picker's services, when the widget has a mode picker. */
  readonly modePicker?: ConstructorParameters<typeof ChatModePicker>[1];
  openModeDropdown(): void;
  register<T extends IDisposable>(d: T): T;
}

/** The hairline strip: `/ commands` · `@ context` · `<mode>`. */
export function buildEmptyStateKeys(host: IEmptyStateKeysHost): HTMLElement {
  const strip = $('div.parallx-chat-empty-keys');

  const cell = (
    glyphHtml: string,
    glyphIsText: boolean,
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLElement => {
    const btn = $('button.parallx-chat-empty-key') as HTMLButtonElement;
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    declareControl(btn, { id: `chat.empty.${label}`, label, hint: title });
    const g = $(`span.parallx-chat-empty-key__glyph${glyphIsText ? '.is-text' : ''}`);
    if (glyphIsText) { g.textContent = glyphHtml; } else { g.innerHTML = glyphHtml; }
    const l = $('span.parallx-chat-empty-key__label', label);
    append(btn, g, l);
    // LOAD-BEARING: the textarea is focused whenever the empty state is up
    // (_inputPart.focus() on session bind). Letting this button take focus
    // would blur it, and the autocomplete's blur handler schedules an
    // unconditional close 150ms later — which would snuff out the menu this
    // very click just opened. Keep focus in the textarea.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', onClick);
    return btn;
  };

  // Typing the trigger opens the real menu — nothing is hard-coded here, so
  // this can never advertise a command that does not exist.
  strip.appendChild(cell('/', true, 'commands',
    'Type / for the command list: /init, /context, /compact and more',
    () => host.insertTrigger('/')));

  strip.appendChild(cell('@', true, 'context',
    'Type @ to pull in a file, folder, or terminal output',
    () => host.insertTrigger('@')));

  // The mode cell reads from the picker's own metadata and opens the picker
  // itself, so the two can never disagree about what a mode does.
  const picker = host.modePicker;
  if (picker) {
    const modeCell = $('button.parallx-chat-empty-key.parallx-chat-empty-key--mode') as HTMLButtonElement;
    modeCell.type = 'button';
    declareControl(modeCell, { id: 'chat.empty.mode', label: 'Mode', state: () => ({ kind: 'value', value: MODE_META[picker.getMode()].label }) });
    const paintMode = () => {
      const mode = picker.getMode();
      const meta = MODE_META[mode];
      modeCell.innerHTML = '';
      const g = $('span.parallx-chat-empty-key__glyph');
      g.innerHTML = meta.icon;
      const l = $('span.parallx-chat-empty-key__label', `${meta.label} mode`);
      append(modeCell, g, l);
      const title = `${meta.label} mode: ${meta.description}. Click to change.`;
      modeCell.title = title;
      modeCell.setAttribute('aria-label', title);
    };
    paintMode();
    host.register(picker.onDidChangeMode(() => paintMode()));
    modeCell.addEventListener('mousedown', (e) => e.preventDefault());
    modeCell.addEventListener('click', () => host.openModeDropdown());
    strip.appendChild(modeCell);
  }

  return strip;
}

/** The offline notice: a spinner, a title the caller updates, and the way to AI settings. */
export function buildOfflineState(openAiSettings: (() => void) | undefined): { root: HTMLElement; title: HTMLElement } {
  const root = $('div.parallx-chat-offline-state');

  const spinner = $('div.parallx-chat-offline-spinner');
  const title = $('div.parallx-chat-offline-title', 'Connecting to Ollama\u2026');

  const instruction = $('div.parallx-chat-offline-instruction');
  instruction.innerHTML = [
    'Parallx\u2019s AI runs on your computer through <strong>Ollama</strong>.',
    'Install it from <a href="https://ollama.com">ollama.com</a> and it connects on its own,',
    'or set up a cloud model in AI settings.',
  ].join(' ');
  const link = instruction.querySelector('a');
  if (link) declareControl(link, { id: 'chat.offline.ollamaLink', label: 'Ollama website' });

  append(root, spinner, title, instruction);

  if (openAiSettings) {
    const open = $('button.parallx-chat-offline-action', 'Open AI Settings') as HTMLButtonElement;
    open.type = 'button';
    declareControl(open, { id: 'chat.offline.openAiSettings', label: 'Open AI Settings' });
    open.addEventListener('click', () => openAiSettings());
    root.appendChild(open);
  }
  return { root, title };
}
