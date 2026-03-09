// textEntryDialog.ts — Small text-entry dialog for database rename/create flows
//
// Replaces browser-native prompt() usage with a Parallx-native surface built
// from existing UI primitives. Kept deliberately small so it preserves the
// original one-string interaction model.

import { DisposableStore } from '../../../platform/lifecycle.js';
import { $ } from '../../../ui/dom.js';
import { Overlay } from '../../../ui/overlay.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Button } from '../../../ui/button.js';

export interface IDatabaseTextEntryDialogOptions {
  readonly title: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly parent?: HTMLElement;
}

export function showDatabaseTextEntryDialog(options: IDatabaseTextEntryDialogOptions): Promise<string | undefined> {
  const parent = options.parent ?? document.body;
  const overlay = new Overlay(parent, {
    closeOnClickOutside: true,
    closeOnEscape: true,
    contentClass: 'db-text-entry-dialog-overlay',
  });
  const store = new DisposableStore();

  const panel = $('div.db-text-entry-dialog');
  overlay.contentElement.appendChild(panel);

  const title = $('div.db-text-entry-dialog__title');
  title.textContent = options.title;
  panel.appendChild(title);

  const inputWrap = $('div.db-text-entry-dialog__input');
  panel.appendChild(inputWrap);

  const input = store.add(new InputBox(inputWrap, {
    placeholder: options.placeholder,
    value: options.value,
    ariaLabel: options.title,
  }));
  input.inputElement.spellcheck = true;

  const actions = $('div.db-text-entry-dialog__actions');
  panel.appendChild(actions);

  const cancelButton = store.add(new Button(actions, {
    label: options.cancelLabel ?? 'Cancel',
    secondary: true,
  }));
  const confirmButton = store.add(new Button(actions, {
    label: options.confirmLabel ?? 'OK',
  }));

  return new Promise<string | undefined>((resolve) => {
    let settled = false;

    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      store.dispose();
      overlay.hide();
      overlay.dispose();
      resolve(value);
    };

    store.add(overlay.onDidClose(() => finish(undefined)));
    store.add(input.onDidSubmit((value) => finish(value)));
    store.add(input.onDidCancel(() => finish(undefined)));
    store.add(cancelButton.onDidClick(() => finish(undefined)));
    store.add(confirmButton.onDidClick(() => finish(input.value)));

    overlay.show();
    input.focus();
    if (options.value !== undefined) {
      input.select();
    }
  });
}
