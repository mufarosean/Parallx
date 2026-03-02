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
import { ChatContextAttachments } from './chatContextAttachments.js';
import type { IAttachmentServices } from './chatContextAttachments.js';
import type { IChatAttachment } from '../../services/chatTypes.js';

/**
 * Chat input area — textarea + context ribbon + toolbar (submit/stop, model/mode pickers).
 */
export class ChatInputPart extends Disposable {

  // ── DOM ──

  private readonly _root: HTMLElement;
  private readonly _textarea: HTMLTextAreaElement;
  private readonly _submitBtn: HTMLButtonElement;
  private readonly _stopBtn: HTMLButtonElement;
  private readonly _toolbar: HTMLElement;
  private readonly _pickerSlot: HTMLElement;
  private readonly _attachBtn: HTMLButtonElement;
  private readonly _attachLabel: HTMLSpanElement;
  private readonly _contextRibbon: ChatContextAttachments;
  private _filePickerDropdown: HTMLElement | undefined;

  // ── State ──

  private _streaming = false;
  private _enabled = true;

  // ── Events ──

  private readonly _onDidAcceptInput = this._register(new Emitter<string>());
  readonly onDidAcceptInput: Event<string> = this._onDidAcceptInput.event;

  private readonly _onDidRequestStop = this._register(new Emitter<void>());
  readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

  private readonly _onDidChangeAttachments = this._register(new Emitter<void>());
  readonly onDidChangeAttachments: Event<void> = this._onDidChangeAttachments.event;

  constructor(container: HTMLElement) {
    super();

    // Root
    this._root = $('div.parallx-chat-input');
    container.appendChild(this._root);

    // Context attachment ribbon (ABOVE the textarea, VS Code style)
    this._contextRibbon = this._register(new ChatContextAttachments(this._root));
    this._register(this._contextRibbon.onDidChange(() => {
      this._updateAttachBtnLabel();
      this._onDidChangeAttachments.fire();
    }));

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
    this._attachBtn = document.createElement('button');
    this._attachBtn.className = 'parallx-chat-input-attach';
    this._attachBtn.type = 'button';
    this._attachBtn.title = 'Add Context...';
    this._attachBtn.setAttribute('aria-label', 'Add Context');
    this._attachBtn.innerHTML = chatIcons.attach;
    this._attachLabel = document.createElement('span');
    this._attachLabel.className = 'parallx-chat-input-attach-label';
    this._attachLabel.textContent = 'Add Context';
    this._attachBtn.appendChild(this._attachLabel);
    this._toolbar.appendChild(this._attachBtn);

    // Attach button click — open file picker
    this._register(addDisposableListener(this._attachBtn, 'click', () => {
      if (this._filePickerDropdown) {
        this._closeFilePicker();
      } else {
        this._openFilePicker();
      }
    }));

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

  /** Clear the input, reset height, and clear attachments. */
  clear(): void {
    this._textarea.value = '';
    this._autoResize();
    this._contextRibbon.clear();
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

  /** Bind attachment services for editor file tracking. */
  setAttachmentServices(services: IAttachmentServices): void {
    this._contextRibbon.setServices(services);
  }

  /** Get current explicit attachments (to include in the request). */
  getAttachments(): readonly IChatAttachment[] {
    return this._contextRibbon.getAttachments();
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

  /** Update attach button label visibility based on attachment count. */
  private _updateAttachBtnLabel(): void {
    // When files are attached, collapse to just the paperclip icon
    const hasAttachments = this._contextRibbon.hasAttachments();
    this._attachLabel.style.display = hasAttachments ? 'none' : '';
  }

  /** Open the file picker dropdown showing open editor files. */
  private _openFilePicker(): void {
    this._closeFilePicker();

    const dropdown = $('div.parallx-chat-picker-dropdown.parallx-chat-file-picker');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    // Get open editor files from the attachment ribbon's services
    const services = (this._contextRibbon as any)._services as IAttachmentServices | undefined;
    const openFiles = services?.getOpenEditorFiles() ?? [];

    if (openFiles.length === 0) {
      const empty = $('div.parallx-chat-picker-item.parallx-chat-picker-item--empty', 'No open files');
      dropdown.appendChild(empty);
    } else {
      for (const file of openFiles) {
        const item = $('div.parallx-chat-picker-item');
        const icon = document.createElement('span');
        icon.innerHTML = chatIcons.file;
        icon.style.display = 'inline-flex';
        icon.style.alignItems = 'center';
        item.appendChild(icon);

        const name = $('span.parallx-chat-picker-item-name', file.name);
        item.appendChild(name);

        item.addEventListener('click', () => {
          this._contextRibbon.addAttachment(file);
          this._closeFilePicker();
        });

        dropdown.appendChild(item);
      }
    }

    // Position below button (opening upward)
    const rect = this._attachBtn.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(dropdown);
    this._filePickerDropdown = dropdown;

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this._attachBtn.contains(e.target as Node)) {
        this._closeFilePicker();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    document.addEventListener('mousedown', closeHandler);
  }

  private _closeFilePicker(): void {
    if (this._filePickerDropdown) {
      this._filePickerDropdown.remove();
      this._filePickerDropdown = undefined;
    }
  }

  override dispose(): void {
    this._closeFilePicker();
    this._root.remove();
    super.dispose();
  }
}
