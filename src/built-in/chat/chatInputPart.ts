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
import type { IAttachmentServices, IWorkspaceFileEntry } from './chatContextAttachments.js';
import type { IChatAttachment } from '../../services/chatTypes.js';
import { ChatToolPicker } from './chatToolPicker.js';
import type { IToolPickerServices } from './chatToolPicker.js';

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
  private readonly _toolsBtn: HTMLButtonElement;
  private readonly _toolPicker: ChatToolPicker;

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

    // Configure Tools button (wrench icon — opens tool picker overlay)
    this._toolsBtn = document.createElement('button');
    this._toolsBtn.className = 'parallx-chat-input-tools';
    this._toolsBtn.type = 'button';
    this._toolsBtn.title = 'Configure Tools\u2026';
    this._toolsBtn.setAttribute('aria-label', 'Configure Tools');
    this._toolsBtn.innerHTML = chatIcons.tools;
    this._toolsBtn.style.display = 'none'; // hidden until services wired
    this._toolbar.appendChild(this._toolsBtn);

    // Tool picker dialog (modal overlay)
    this._toolPicker = this._register(new ChatToolPicker());
    this._register(addDisposableListener(this._toolsBtn, 'click', () => {
      if (this._toolPicker.isOpen) {
        this._toolPicker.close();
      } else {
        this._toolPicker.open();
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

  /** Bind tool picker services — shows the wrench icon and enables the dialog. */
  setToolPickerServices(services: IToolPickerServices): void {
    this._toolPicker.setServices(services);
    this._toolsBtn.style.display = '';
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

    const dropdown = $('div.parallx-chat-context-picker');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    // ── Search input ──
    const searchWrap = $('div.parallx-chat-context-picker-search');
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'parallx-chat-context-picker-search-input';
    searchInput.placeholder = 'Search for files to add to your request\u2026';
    searchWrap.appendChild(searchInput);
    dropdown.appendChild(searchWrap);

    // ── Scrollable list ──
    const listContainer = $('div.parallx-chat-context-picker-list');
    dropdown.appendChild(listContainer);

    // Get open editor files from the attachment ribbon's services
    const services = (this._contextRibbon as any)._services as IAttachmentServices | undefined;
    const openFiles = services?.getOpenEditorFiles() ?? [];

    // State: workspace files loaded lazily
    let workspaceFiles: IWorkspaceFileEntry[] = [];
    let workspaceLoaded = false;

    /** Render items filtered by the current search query. */
    const renderItems = (query: string): void => {
      listContainer.innerHTML = '';
      const q = query.toLowerCase().trim();

      // ── Category: Open Editors ──
      const filteredOpen = q
        ? openFiles.filter((f) => f.name.toLowerCase().includes(q) || f.fullPath.toLowerCase().includes(q))
        : openFiles;

      if (filteredOpen.length > 0 || !q) {
        const header = $('div.parallx-chat-context-picker-header');
        header.textContent = 'Open Editors';
        listContainer.appendChild(header);

        if (filteredOpen.length === 0) {
          const empty = $('div.parallx-chat-context-picker-empty', 'No matching open editors');
          listContainer.appendChild(empty);
        } else {
          for (const file of filteredOpen) {
            const item = this._createPickerItem(file.name, file.fullPath, false, () => {
              this._contextRibbon.addAttachment(file);
              this._closeFilePicker();
            });
            listContainer.appendChild(item);
          }
        }
      }

      // ── Category: Files & Folders ──
      if (workspaceLoaded || q) {
        const filteredWs = q
          ? workspaceFiles.filter((f) => f.name.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q))
          : workspaceFiles;

        // Don't duplicate files already shown in Open Editors
        const openPaths = new Set(openFiles.map((f) => f.fullPath));
        const deduped = filteredWs.filter((f) => !openPaths.has(f.fullPath));

        if (deduped.length > 0 || (workspaceLoaded && !q)) {
          const header = $('div.parallx-chat-context-picker-header');
          header.textContent = 'Files & Folders';
          listContainer.appendChild(header);

          if (deduped.length === 0 && workspaceLoaded) {
            const empty = $('div.parallx-chat-context-picker-empty', q ? 'No matching files' : 'No workspace files');
            listContainer.appendChild(empty);
          } else {
            // Limit to first 50 items to keep the UI responsive
            const shown = deduped.slice(0, 50);
            for (const entry of shown) {
              const item = this._createPickerItem(
                entry.name,
                entry.relativePath,
                entry.isDirectory,
                () => {
                  this._contextRibbon.addAttachment({
                    name: entry.name,
                    fullPath: entry.fullPath,
                  });
                  this._closeFilePicker();
                },
              );
              listContainer.appendChild(item);
            }
            if (deduped.length > 50) {
              const more = $('div.parallx-chat-context-picker-empty', `\u2026and ${deduped.length - 50} more (refine your search)`);
              listContainer.appendChild(more);
            }
          }
        } else if (!workspaceLoaded) {
          const header = $('div.parallx-chat-context-picker-header');
          header.textContent = 'Files & Folders';
          listContainer.appendChild(header);
          const loading = $('div.parallx-chat-context-picker-empty', 'Loading workspace files\u2026');
          listContainer.appendChild(loading);
        }
      }
    };

    // Initial render
    renderItems('');

    // Load workspace files asynchronously
    if (services?.listWorkspaceFiles) {
      services.listWorkspaceFiles().then((files) => {
        workspaceFiles = files;
        workspaceLoaded = true;
        renderItems(searchInput.value);
      }).catch(() => {
        workspaceLoaded = true;
        renderItems(searchInput.value);
      });
    } else {
      workspaceLoaded = true;
    }

    // ── Search filtering ──
    searchInput.addEventListener('input', () => {
      renderItems(searchInput.value);
    });

    // Position below button (opening upward from the attach button)
    const rect = this._attachBtn.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    document.body.appendChild(dropdown);
    this._filePickerDropdown = dropdown;

    // Focus search input
    requestAnimationFrame(() => searchInput.focus());

    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && !this._attachBtn.contains(e.target as Node)) {
        this._closeFilePicker();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    document.addEventListener('mousedown', closeHandler);

    // Close on Escape
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this._closeFilePicker();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  /** Create a picker item row. */
  private _createPickerItem(
    name: string,
    description: string,
    isDirectory: boolean,
    onClick: () => void,
  ): HTMLElement {
    const item = $('div.parallx-chat-context-picker-item');

    const icon = document.createElement('span');
    icon.className = 'parallx-chat-context-picker-item-icon';
    icon.innerHTML = isDirectory ? chatIcons.folder : chatIcons.file;
    item.appendChild(icon);

    const textWrap = $('div.parallx-chat-context-picker-item-text');

    const nameEl = $('span.parallx-chat-context-picker-item-name', name);
    textWrap.appendChild(nameEl);

    // Show path description (relative path or full path) if different from name
    if (description && description !== name) {
      const descEl = $('span.parallx-chat-context-picker-item-desc', description);
      textWrap.appendChild(descEl);
    }

    item.appendChild(textWrap);

    item.addEventListener('click', onClick);
    return item;
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
