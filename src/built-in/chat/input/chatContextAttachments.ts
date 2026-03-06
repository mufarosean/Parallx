// chatContextAttachments.ts — File attachment ribbon for chat input (M9)
//
// Shows two kinds of context chips in a ribbon between the textarea and toolbar:
//   1. **Explicit** attachments — user-added files (via "Add Context" button).
//      Shown as chips with an × close button. Click × to remove.
//   2. **Implicit** suggestions — files from currently open editors.
//      Shown as dimmed chips with a + button. Click + to promote to explicit.
//      Click × on a promoted implicit to demote it back.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts
//   (ChatAttachedContext portion)

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $ } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IChatAttachment } from '../../../services/chatTypes.js';
import type { IOpenEditorFile, IAttachmentServices } from '../chatTypes.js';

// IOpenEditorFile, IWorkspaceFileEntry, IAttachmentServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IOpenEditorFile, IWorkspaceFileEntry, IAttachmentServices } from '../chatTypes.js';

// ── Component ──

/**
 * Context attachment ribbon — manages explicit and implicit file attachments.
 *
 * Sits between the textarea and toolbar inside the chat input.
 */
export class ChatContextAttachments extends Disposable {

  private readonly _root: HTMLElement;
  private _services: IAttachmentServices | undefined;

  /** Explicitly attached files (user-added). */
  private readonly _explicit = new Map<string, IChatAttachment>();

  /** Dismissed implicit suggestions (user clicked × on an implicit). */
  private readonly _dismissed = new Set<string>();

  // ── Events ──

  private readonly _onDidChange = this._register(new Emitter<void>());
  /** Fires when the set of attachments changes. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(container: HTMLElement) {
    super();

    this._root = $('div.parallx-chat-context-ribbon');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));
  }

  // ── Service binding ──

  /** Bind attachment services (editor file tracking). */
  setServices(services: IAttachmentServices): void {
    this._services = services;
    this._register(services.onDidChangeOpenEditors(() => this._render()));
    this._render();
  }

  // ── Public API ──

  /** Add a file as an explicit attachment. */
  addAttachment(file: IOpenEditorFile): void {
    if (this._explicit.has(file.fullPath)) {
      return;
    }
    this._explicit.set(file.fullPath, {
      id: file.fullPath,
      name: file.name,
      fullPath: file.fullPath,
      isImplicit: false,
    });
    this._dismissed.delete(file.fullPath);
    this._render();
    this._onDidChange.fire();
  }

  /** Remove an explicit attachment. */
  removeAttachment(fullPath: string): void {
    if (this._explicit.delete(fullPath)) {
      this._render();
      this._onDidChange.fire();
    }
  }

  /** Dismiss an implicit suggestion (hide it from the ribbon). */
  dismissImplicit(fullPath: string): void {
    this._dismissed.add(fullPath);
    this._render();
  }

  /** Get all effective attachments (explicit only — implicit suggestions are not sent). */
  getAttachments(): readonly IChatAttachment[] {
    return Array.from(this._explicit.values());
  }

  /** Clear all explicit attachments and dismissed set. */
  clear(): void {
    this._explicit.clear();
    this._dismissed.clear();
    this._render();
    this._onDidChange.fire();
  }

  /** Returns true when there are any explicit attachments. */
  hasAttachments(): boolean {
    return this._explicit.size > 0;
  }

  // ── Rendering ──

  private _render(): void {
    this._root.innerHTML = '';

    // 1. Render explicit attachments (chips with × to remove)
    for (const attachment of this._explicit.values()) {
      const chip = this._createChip(attachment.name, false, () => {
        this.removeAttachment(attachment.fullPath);
      });
      this._root.appendChild(chip);
    }

    // 2. Render implicit suggestions from open editors
    if (this._services) {
      const openFiles = this._services.getOpenEditorFiles();
      for (const file of openFiles) {
        // Skip if already explicitly attached or dismissed
        if (this._explicit.has(file.fullPath) || this._dismissed.has(file.fullPath)) {
          continue;
        }
        const chip = this._createImplicitChip(file);
        this._root.appendChild(chip);
      }
    }

    // Show/hide the ribbon
    const hasContent = this._root.childElementCount > 0;
    this._root.style.display = hasContent ? '' : 'none';
  }

  /** Create an explicit attachment chip with × close button. */
  private _createChip(label: string, _isImplicit: boolean, onRemove: () => void): HTMLElement {
    const chip = $('div.parallx-chat-context-chip');

    // File icon
    const icon = document.createElement('span');
    icon.className = 'parallx-chat-context-chip-icon';
    icon.innerHTML = chatIcons.file;
    chip.appendChild(icon);

    // Label
    const name = document.createElement('span');
    name.className = 'parallx-chat-context-chip-label';
    name.textContent = label;
    chip.appendChild(name);

    // × close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-chat-context-chip-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Remove';
    closeBtn.setAttribute('aria-label', `Remove ${label}`);
    closeBtn.innerHTML = chatIcons.close;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    chip.appendChild(closeBtn);

    return chip;
  }

  /** Create an implicit suggestion chip with + add button. */
  private _createImplicitChip(file: IOpenEditorFile): HTMLElement {
    const chip = $('div.parallx-chat-context-chip.parallx-chat-context-chip--implicit');

    // File icon
    const icon = document.createElement('span');
    icon.className = 'parallx-chat-context-chip-icon';
    icon.innerHTML = chatIcons.file;
    chip.appendChild(icon);

    // Label (italicized via CSS)
    const name = document.createElement('span');
    name.className = 'parallx-chat-context-chip-label';
    name.textContent = file.name;
    chip.appendChild(name);

    // + add button
    const addBtn = document.createElement('button');
    addBtn.className = 'parallx-chat-context-chip-add';
    addBtn.type = 'button';
    addBtn.title = `Add ${file.name} as context`;
    addBtn.setAttribute('aria-label', `Add ${file.name}`);
    addBtn.innerHTML = chatIcons.newChat; // + icon
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addAttachment(file);
    });
    chip.appendChild(addBtn);

    // × dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'parallx-chat-context-chip-close';
    dismissBtn.type = 'button';
    dismissBtn.title = 'Dismiss suggestion';
    dismissBtn.setAttribute('aria-label', `Dismiss ${file.name}`);
    dismissBtn.innerHTML = chatIcons.close;
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissImplicit(file.fullPath);
    });
    chip.appendChild(dismissBtn);

    return chip;
  }
}
