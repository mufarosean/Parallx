// chatInputPart.ts — Chat input area (M9 Task 3.4)
//
// Multi-line text input with Enter-to-submit, Shift+Enter for newline,
// submit/stop buttons, and toolbar area for model/mode pickers.
//
// M9.0 uses a plain <textarea> — the writable Tiptap instance with
// @mention autocomplete (per M9 doc) is wired in a follow-up once
// the Mention extension and participants are fully operational.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts

import './chatInput.css';

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $, addDisposableListener } from '../../ui/dom.js';
import { chatIcons } from './chatIcons.js';

/**
 * Chat input area — textarea + toolbar (submit/stop, model/mode pickers).
 */
export class ChatInputPart extends Disposable {

  // ── DOM ──

  private readonly _root: HTMLElement;
  private readonly _textarea: HTMLTextAreaElement;
  private readonly _submitBtn: HTMLButtonElement;
  private readonly _stopBtn: HTMLButtonElement;
  private readonly _toolbar: HTMLElement;
  private readonly _pickerSlot: HTMLElement;

  // ── State ──

  private _streaming = false;
  private _enabled = true;

  // ── Events ──

  private readonly _onDidAcceptInput = this._register(new Emitter<string>());
  readonly onDidAcceptInput: Event<string> = this._onDidAcceptInput.event;

  private readonly _onDidRequestStop = this._register(new Emitter<void>());
  readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

  constructor(container: HTMLElement) {
    super();

    // Root
    this._root = $('div.parallx-chat-input');
    container.appendChild(this._root);

    // Editor area (textarea wrapper)
    const editorArea = $('div.parallx-chat-input-editor');
    this._root.appendChild(editorArea);

    // Textarea
    this._textarea = document.createElement('textarea');
    this._textarea.className = 'parallx-chat-input-textarea';
    this._textarea.placeholder = 'Ask a question\u2026';
    this._textarea.rows = 1;
    editorArea.appendChild(this._textarea);

    // Toolbar
    this._toolbar = $('div.parallx-chat-input-toolbar');
    this._root.appendChild(this._toolbar);

    // Picker slot (model/mode pickers will be appended here)
    this._pickerSlot = $('div.parallx-chat-input-toolbar-pickers');
    this._toolbar.appendChild(this._pickerSlot);

    // Add Context button (VS Code-style attach)
    const attachBtn = document.createElement('button');
    attachBtn.className = 'parallx-chat-input-attach';
    attachBtn.type = 'button';
    attachBtn.title = 'Add Context...';
    attachBtn.setAttribute('aria-label', 'Add Context');
    attachBtn.innerHTML = chatIcons.attach;
    const attachLabel = document.createElement('span');
    attachLabel.className = 'parallx-chat-input-attach-label';
    attachLabel.textContent = 'Add Context';
    attachBtn.appendChild(attachLabel);
    this._toolbar.appendChild(attachBtn);

    // Spacer
    const spacer = $('div.parallx-chat-input-toolbar-spacer');
    this._toolbar.appendChild(spacer);

    // Submit button (icon-only: ↑ arrow, VS Code style)
    this._submitBtn = document.createElement('button');
    this._submitBtn.className = 'parallx-chat-input-submit';
    this._submitBtn.innerHTML = chatIcons.send;
    this._submitBtn.type = 'button';
    this._submitBtn.title = 'Send message (Enter)';
    this._submitBtn.setAttribute('aria-label', 'Send message');
    this._toolbar.appendChild(this._submitBtn);

    // Stop button (icon-only: ■ square, hidden by default)
    this._stopBtn = document.createElement('button');
    this._stopBtn.className = 'parallx-chat-input-stop';
    this._stopBtn.innerHTML = chatIcons.stop;
    this._stopBtn.type = 'button';
    this._stopBtn.title = 'Stop generation';
    this._stopBtn.setAttribute('aria-label', 'Stop generation');
    this._stopBtn.style.display = 'none';
    this._toolbar.appendChild(this._stopBtn);

    // ── Event handlers ──

    // Enter to submit, Shift+Enter for newline
    this._register(addDisposableListener(this._textarea, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this._submit();
      }
    }));

    // Auto-resize textarea
    this._register(addDisposableListener(this._textarea, 'input', () => {
      this._autoResize();
    }));

    // Submit button click
    this._register(addDisposableListener(this._submitBtn, 'click', () => {
      this._submit();
    }));

    // Stop button click
    this._register(addDisposableListener(this._stopBtn, 'click', () => {
      this._onDidRequestStop.fire();
    }));
  }

  // ── Public API ──

  /** Get the current input text. */
  getValue(): string {
    return this._textarea.value;
  }

  /** Set the input text and auto-resize. */
  setValue(text: string): void {
    this._textarea.value = text;
    this._autoResize();
  }

  /** Clear the input and reset height. */
  clear(): void {
    this._textarea.value = '';
    this._autoResize();
  }

  /** Focus the textarea. */
  focus(): void {
    this._textarea.focus();
  }

  /** Show stop button during streaming, submit button otherwise. */
  setStreaming(streaming: boolean): void {
    this._streaming = streaming;
    this._submitBtn.style.display = streaming ? 'none' : '';
    this._stopBtn.style.display = streaming ? '' : 'none';
    this._textarea.disabled = streaming;
  }

  /** Enable or disable the entire input (e.g. when Ollama is offline). */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this._textarea.disabled = !enabled || this._streaming;
    this._submitBtn.disabled = !enabled;
  }

  /** Get the picker slot element for model/mode picker attachment. */
  getPickerSlot(): HTMLElement {
    return this._pickerSlot;
  }

  // ── Internal ──

  private _submit(): void {
    if (!this._enabled || this._streaming) {
      return;
    }
    const text = this._textarea.value.trim();
    if (!text) {
      return;
    }
    this._onDidAcceptInput.fire(text);
  }

  /** Auto-expand textarea up to max-height, then scroll. */
  private _autoResize(): void {
    const ta = this._textarea;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  override dispose(): void {
    this._root.remove();
    super.dispose();
  }
}
