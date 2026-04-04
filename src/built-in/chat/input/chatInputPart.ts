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

import { Disposable } from '../../../platform/lifecycle.js';
import { ChatMode } from '../../../services/chatTypes.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import { ChatContextAttachments } from './chatContextAttachments.js';
import type { IAttachmentServices, IWorkspaceFileEntry } from '../chatTypes.js';
import type { IChatAttachment, IChatSelectionAttachment, IContextPill } from '../../../services/chatTypes.js';
import { ChatContextPills } from './chatContextPills.js';
import { ChatMentionAutocomplete } from './chatMentionAutocomplete.js';
import type { IMentionSuggestionProvider, ISlashCommandProvider } from '../chatTypes.js';

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
  private readonly _contextPills: ChatContextPills;
  private _filePickerDropdown: HTMLElement | undefined;
  private readonly _toolsBtn: HTMLButtonElement;
  private readonly _mentionAutocomplete: ChatMentionAutocomplete;

  // ── Command pill state ──
  private readonly _commandPill: HTMLElement;
  private _activeCommand: string | undefined;

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

  private readonly _onDidRequestOpenToolSettings = this._register(new Emitter<void>());
  /** Fired when the wrench icon is clicked — opens AI Hub → Tools section. */
  readonly onDidRequestOpenToolSettings: Event<void> = this._onDidRequestOpenToolSettings.event;

  constructor(container: HTMLElement, onRequestVisionModel?: () => void) {
    super();

    // Root
    this._root = $('div.parallx-chat-input');
    container.appendChild(this._root);

    // Context attachment ribbon (ABOVE the textarea, VS Code style)
    this._contextRibbon = this._register(new ChatContextAttachments(this._root, onRequestVisionModel));
    this._register(this._contextRibbon.onDidChange(() => {
      this._updateAttachBtnLabel();
      this._onDidChangeAttachments.fire();
    }));

    // Editor area (textarea wrapper)
    const editorArea = $('div.parallx-chat-input-editor');
    this._root.appendChild(editorArea);

    // Command pill (shown when a /command is active, VS Code style)
    this._commandPill = $('span.parallx-chat-input-command-pill');
    this._commandPill.style.display = 'none';
    editorArea.appendChild(this._commandPill);

    // Textarea
    this._textarea = document.createElement('textarea');
    this._textarea.className = 'parallx-chat-input-textarea';
    this._textarea.placeholder = 'Ask a question\u2026';
    this._textarea.rows = 1;
    editorArea.appendChild(this._textarea);

    // Toolbar
    this._toolbar = $('div.parallx-chat-input-toolbar');
    this._root.appendChild(this._toolbar);

    // Add Context button (VS Code-style attach)
    this._attachBtn = document.createElement('button');
    this._attachBtn.className = 'parallx-chat-input-attach';
    this._attachBtn.type = 'button';
    this._attachBtn.title = 'Add Context...';
    this._attachBtn.setAttribute('aria-label', 'Add Context');
    this._attachBtn.innerHTML = chatIcons.newChat;
    this._attachLabel = document.createElement('span');
    this._attachLabel.className = 'parallx-chat-input-attach-label';
    this._attachLabel.textContent = '';
    this._attachBtn.appendChild(this._attachLabel);
    this._toolbar.appendChild(this._attachBtn);

    // Picker slot (mode/model pickers will be appended here)
    this._pickerSlot = $('div.parallx-chat-input-toolbar-pickers');
    this._toolbar.appendChild(this._pickerSlot);

    // Attach button click — open file picker
    this._register(addDisposableListener(this._attachBtn, 'click', () => {
      if (this._filePickerDropdown) {
        this._closeFilePicker();
      } else {
        this._openFilePicker();
      }
    }));

    // Configure Tools button (wrench icon — opens AI Hub → Tools section, M20 E.2)
    this._toolsBtn = document.createElement('button');
    this._toolsBtn.className = 'parallx-chat-input-tools';
    this._toolsBtn.type = 'button';
    this._toolsBtn.title = '\u2699 Configure AI\u2026';
    this._toolsBtn.setAttribute('aria-label', 'Configure AI Tools');
    this._toolsBtn.innerHTML = chatIcons.tools;
    this._toolsBtn.style.display = 'none'; // hidden until services wired
    this._pickerSlot.appendChild(this._toolsBtn);

    this._register(addDisposableListener(this._toolsBtn, 'click', () => {
      this._onDidRequestOpenToolSettings.fire();
    }));

    // Spacer
    const spacer = $('div.parallx-chat-input-toolbar-spacer');
    this._toolbar.appendChild(spacer);

    // Pre-send context visibility and exclusions live in a toolbar menu.
    this._contextPills = this._register(new ChatContextPills(this._toolbar));

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
      // Don't submit while autocomplete dropdown is open
      if (this._mentionAutocomplete.isOpen) { return; }
      // Backspace at position 0 clears the command pill
      if (e.key === 'Backspace' && this._activeCommand && this._textarea.selectionStart === 0 && this._textarea.selectionEnd === 0) {
        e.preventDefault();
        this._clearCommandPill(true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this._submit();
      }
    }));

    // Auto-resize textarea
    this._register(addDisposableListener(this._textarea, 'input', () => {
      this._autoResize();
      this._detectCommandFromTyping();
    }));

    this._register(addDisposableListener(this._textarea, 'paste', (event: ClipboardEvent) => {
      void this._handlePaste(event);
    }));

    // Submit button click
    this._register(addDisposableListener(this._submitBtn, 'click', () => {
      this._submit();
    }));

    // Stop button click
    this._register(addDisposableListener(this._stopBtn, 'click', () => {
      this._onDidRequestStop.fire();
    }));

    // ── @Mention / /Command autocomplete (M11 Task 3.1, 3.5) ──
    this._mentionAutocomplete = this._register(new ChatMentionAutocomplete(this._textarea, this._root));
    this._register(this._mentionAutocomplete.onDidAccept((ev) => {
      // If a /command was selected from autocomplete, show it as a pill
      if (ev.insertText.startsWith('/')) {
        const cmdName = ev.insertText.trim();
        // Clear trigger text from textarea, keep only text after the trigger
        const after = this._textarea.value.substring(ev.triggerEnd);
        this._textarea.value = after;
        this._textarea.setSelectionRange(0, 0);
        this._setCommandPill(cmdName);
      } else {
        // Regular @mention — insert as before
        const before = this._textarea.value.substring(0, ev.triggerStart);
        const after = this._textarea.value.substring(ev.triggerEnd);
        this._textarea.value = before + ev.insertText + after;
        const newPos = ev.triggerStart + ev.insertText.length;
        this._textarea.setSelectionRange(newPos, newPos);
      }
      this._autoResize();
      this._textarea.focus();
    }));
  }

  // ── Public API ──

  /** Get the current input text. */
  getValue(): string {
    if (this._activeCommand) {
      const rest = this._textarea.value;
      return rest ? `${this._activeCommand} ${rest}` : this._activeCommand;
    }
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
    this._clearCommandPill(false);
    this._autoResize();
    this._contextRibbon.clear();
    this._contextPills.clearExclusions();
  }

  /** Focus the textarea. */
  focus(): void {
    this._textarea.focus();
  }

  /** Show stop button during streaming, submit button otherwise.
   * Input stays enabled so user can type queued messages. */
  setStreaming(streaming: boolean): void {
    this._streaming = streaming;
    // During streaming, show both send (for queuing) and stop buttons
    this._submitBtn.style.display = '';
    this._stopBtn.style.display = streaming ? '' : 'none';
    // Keep textarea enabled during streaming so user can queue messages
    this._textarea.disabled = false;
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

  /** Bind @mention autocomplete suggestion provider (workspace files). */
  setMentionSuggestionProvider(provider: IMentionSuggestionProvider): void {
    this._mentionAutocomplete.setSuggestionProvider(provider);
  }

  /** Bind slash command provider for /command autocomplete. */
  setSlashCommandProvider(provider: ISlashCommandProvider): void {
    this._mentionAutocomplete.setCommandProvider(provider);
  }

  /** Invalidate cached workspace files (call on workspace changes). */
  invalidateMentionCache(): void {
    this._mentionAutocomplete.invalidateCache();
  }

  /**
   * Show or hide the Configure Tools button based on current mode.
   * M41 Phase 9: All modes now have tools — always show the button.
   */
  updateToolsButtonForMode(_mode: ChatMode): void {
    this._toolsBtn.style.display = '';
  }

  /** Get current explicit attachments (to include in the request). */
  getAttachments(): readonly IChatAttachment[] {
    return this._contextRibbon.getAttachments();
  }

  /** Add a text selection as context (M48). */
  addSelectionAttachment(attachment: IChatSelectionAttachment): void {
    this._contextRibbon.addSelectionAttachment(attachment);
  }

  /** Add a file or folder as context attachment. */
  addFileAttachment(file: { name: string; fullPath: string }): void {
    this._contextRibbon.addAttachment(file);
  }

  setVisionSupported(visionSupported: boolean): void {
    this._contextRibbon.setVisionSupported(visionSupported);
  }

  setContextPills(pills: readonly IContextPill[]): void {
    this._contextPills.setPills(pills);
  }

  setBudget(slots: readonly import('./chatContextPills.js').ITokenBudgetSlot[]): void {
    this._contextPills.setBudget(slots);
  }

  getExcludedContextIds(): ReadonlySet<string> {
    return this._contextPills.getExcluded();
  }

  // ── Internal ──

  private _submit(): void {
    if (!this._enabled) {
      return;
    }
    const text = this.getValue().trim();
    if (!text) {
      return;
    }
    // During streaming, still fire the event — the widget handles queuing
    this._onDidAcceptInput.fire(text);
  }

  /** Auto-expand textarea up to max-height, then scroll. */
  private _autoResize(): void {
    const ta = this._textarea;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  // ── Command pill helpers ──

  /** Show a command pill and store the active command. */
  private _setCommandPill(command: string): void {
    this._activeCommand = command;
    this._commandPill.textContent = command;
    this._commandPill.style.display = '';
    this._textarea.placeholder = 'Type additional instructions\u2026';
  }

  /** Clear the command pill. If `restoreText` is true, put the command back in the textarea. */
  private _clearCommandPill(restoreText: boolean): void {
    if (!this._activeCommand) { return; }
    if (restoreText) {
      this._textarea.value = this._activeCommand + this._textarea.value;
      const pos = this._activeCommand.length;
      this._textarea.setSelectionRange(pos, pos);
    }
    this._activeCommand = undefined;
    this._commandPill.textContent = '';
    this._commandPill.style.display = 'none';
    this._textarea.placeholder = 'Ask a question\u2026';
  }

  /** Detect `/command ` typed manually and convert to pill. */
  private _detectCommandFromTyping(): void {
    if (this._activeCommand) { return; }
    const val = this._textarea.value;
    const match = val.match(/^(\/[a-zA-Z_]\w*)\s/);
    if (match) {
      const cmd = match[1];
      const rest = val.substring(match[0].length);
      this._textarea.value = rest;
      this._textarea.setSelectionRange(0, 0);
      this._setCommandPill(cmd);
    }
  }

  /** Keep the add-context control icon-only. */
  private _updateAttachBtnLabel(): void {
    this._attachLabel.style.display = 'none';
  }

  private async _handlePaste(event: ClipboardEvent): Promise<void> {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) {
      return;
    }

    event.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      await this._contextRibbon.addPastedImage(file);
    }
    this._updateAttachBtnLabel();
  }

  /** Open the multi-file picker dropdown (Task 4.7). */
  private _openFilePicker(): void {
    this._closeFilePicker();

    const dropdown = $('div.parallx-chat-context-picker');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '100';

    // ── Header with count + Done button ──
    const headerBar = $('div.parallx-chat-context-picker-toolbar');
    const countLabel = $('span.parallx-chat-context-picker-count', '0 files selected');
    headerBar.appendChild(countLabel);
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'parallx-chat-context-picker-done';
    doneBtn.textContent = 'Done';
    doneBtn.disabled = true;
    headerBar.appendChild(doneBtn);
    dropdown.appendChild(headerBar);

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

    // ── Multi-select state ──
    const selected = new Map<string, { name: string; fullPath: string }>();

    const updateCount = (): void => {
      const n = selected.size;
      countLabel.textContent = n === 0 ? '0 files selected' : `${n} file${n > 1 ? 's' : ''} selected`;
      doneBtn.disabled = n === 0;
    };

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
            const item = this._createPickerItem(file.name, file.fullPath, false, selected.has(file.fullPath), (checked) => {
              if (checked) {
                selected.set(file.fullPath, file);
              } else {
                selected.delete(file.fullPath);
              }
              updateCount();
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
                selected.has(entry.fullPath),
                (checked) => {
                  if (checked) {
                    selected.set(entry.fullPath, { name: entry.name, fullPath: entry.fullPath });
                  } else {
                    selected.delete(entry.fullPath);
                  }
                  updateCount();
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

    // ── Done button — add all selected files ──
    doneBtn.addEventListener('click', () => {
      for (const file of selected.values()) {
        this._contextRibbon.addAttachment(file);
      }
      this._closeFilePicker();
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

  /** Create a multi-select picker item row with checkbox (Task 4.7). */
  private _createPickerItem(
    name: string,
    description: string,
    isDirectory: boolean,
    checked: boolean,
    onToggle: (checked: boolean) => void,
  ): HTMLElement {
    const item = $('div.parallx-chat-context-picker-item');

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'parallx-chat-context-picker-item-checkbox';
    checkbox.checked = checked;
    if (checked) { item.classList.add('parallx-chat-context-picker-item--selected'); }
    item.appendChild(checkbox);

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

    // Click row → toggle checkbox
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT') {
        checkbox.checked = !checkbox.checked;
      }
      item.classList.toggle('parallx-chat-context-picker-item--selected', checkbox.checked);
      onToggle(checkbox.checked);
    });

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
