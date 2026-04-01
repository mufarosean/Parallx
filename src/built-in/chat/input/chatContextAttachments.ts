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
import { isChatImageAttachment } from '../../../services/chatTypes.js';
import type { IChatAttachment, IChatImageAttachment, IChatSelectionAttachment } from '../../../services/chatTypes.js';
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

  private _visionSupported = false;
  private _onRequestVisionModel?: () => void;

  // ── Events ──

  private readonly _onDidChange = this._register(new Emitter<void>());
  /** Fires when the set of attachments changes. */
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor(container: HTMLElement, onRequestVisionModel?: () => void) {
    super();

    this._onRequestVisionModel = onRequestVisionModel;

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
      kind: 'file',
      id: file.fullPath,
      name: file.name,
      fullPath: file.fullPath,
      isImplicit: false,
    });
    this._dismissed.delete(file.fullPath);
    this._render();
    this._onDidChange.fire();
  }

  async addPastedImage(file: File): Promise<void> {
    // Reject images larger than 10MB to avoid OOM and excessive base64 encoding
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_IMAGE_BYTES) {
      console.warn(`[ChatAttachments] Rejecting pasted image: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit`);
      return;
    }
    const dataUrl = await this._readFileAsDataUrl(file);
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) {
      return;
    }

    const mimeType = dataUrl.slice(5, dataUrl.indexOf(';', 5)) || file.type || 'image/png';
    const id = `parallx-image://${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const attachment: IChatImageAttachment = {
      kind: 'image',
      id,
      name: file.name || 'Pasted image',
      fullPath: id,
      isImplicit: false,
      mimeType,
      data: dataUrl.slice(commaIndex + 1),
      origin: 'clipboard',
    };
    this._explicit.set(id, attachment);
    this._render();
    this._onDidChange.fire();
  }

  /** Add a text selection as an explicit attachment (M48). */
  addSelectionAttachment(attachment: IChatSelectionAttachment): void {
    // Replace any existing selection attachment — only one at a time
    for (const [key, existing] of this._explicit) {
      if ((existing as any).kind === 'selection') {
        this._explicit.delete(key);
      }
    }
    this._explicit.set(attachment.id, attachment);
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
    return Array.from(this._explicit.values()).filter((attachment) => {
      if (!isChatImageAttachment(attachment)) {
        return true;
      }
      return this._visionSupported;
    });
  }

  setVisionSupported(visionSupported: boolean): void {
    if (this._visionSupported === visionSupported) {
      return;
    }
    this._visionSupported = visionSupported;
    this._render();
    this._onDidChange.fire();
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
      const chip = this._createChip(attachment, false, () => {
        this.removeAttachment(attachment.id);
      });
      this._root.appendChild(chip);
    }

    // 2. Render implicit suggestion — only the active editor file (not all open editors)
    if (this._services) {
      const activeFile = this._services.getActiveEditorFile();
      if (activeFile && !this._explicit.has(activeFile.fullPath) && !this._dismissed.has(activeFile.fullPath)) {
        const chip = this._createImplicitChip(activeFile);
        this._root.appendChild(chip);
      }
    }

    // Show/hide the ribbon
    const hasContent = this._root.childElementCount > 0;
    this._root.style.display = hasContent ? '' : 'none';
  }

  /** Create an explicit attachment chip with × close button. */
  private _createChip(attachment: IChatAttachment, _isImplicit: boolean, onRemove: () => void): HTMLElement {
    const chip = $('div.parallx-chat-context-chip');
    const isSelection = (attachment as IChatSelectionAttachment).kind === 'selection';
    if (isChatImageAttachment(attachment)) {
      chip.classList.add('parallx-chat-context-chip--image');
      if (!this._visionSupported) {
        chip.classList.add('parallx-chat-context-chip--disabled');
        chip.title = 'Active model does not support vision. Switch to a vision-capable model to send this image.';
      }
    }
    if (isSelection) {
      chip.classList.add('parallx-chat-context-chip--selection');
      const sel = attachment as IChatSelectionAttachment;
      const lines = sel.startLine && sel.endLine ? ` (lines ${sel.startLine}–${sel.endLine})` : '';
      const page = sel.pageNumber ? ` (page ${sel.pageNumber})` : '';
      chip.title = `Selected text from ${sel.name}${lines}${page}`;
    }

    // File icon
    const icon = document.createElement('span');
    icon.className = 'parallx-chat-context-chip-icon';
    if (isChatImageAttachment(attachment)) {
      const preview = document.createElement('span');
      preview.className = 'parallx-chat-context-chip-preview';
      preview.style.backgroundImage = `url(${this._buildPreviewDataUrl(attachment)})`;
      icon.appendChild(preview);

      const glyph = document.createElement('span');
      glyph.className = 'parallx-chat-context-chip-glyph';
      glyph.innerHTML = chatIcons.image;
      icon.appendChild(glyph);
    } else if (isSelection) {
      icon.textContent = '📋';
    } else {
      icon.innerHTML = chatIcons.file;
    }
    chip.appendChild(icon);

    // Label
    const name = document.createElement('span');
    name.className = 'parallx-chat-context-chip-label';
    if (isSelection) {
      const sel = attachment as IChatSelectionAttachment;
      const preview = sel.selectedText.length > 40
        ? sel.selectedText.slice(0, 37) + '…'
        : sel.selectedText;
      name.textContent = `"${preview}" — ${sel.name}`;
    } else {
      name.textContent = attachment.name;
    }
    chip.appendChild(name);

    if (isChatImageAttachment(attachment) && !this._visionSupported) {
      const status = $('span.parallx-chat-context-chip-status', 'Vision required');
      chip.appendChild(status);

      if (this._onRequestVisionModel) {
        const switchLink = document.createElement('button');
        switchLink.className = 'parallx-chat-context-chip-action';
        switchLink.type = 'button';
        switchLink.textContent = 'Switch model';
        switchLink.title = 'Switch to a vision-capable model';
        switchLink.addEventListener('click', (e) => {
          e.stopPropagation();
          this._onRequestVisionModel?.();
        });
        chip.appendChild(switchLink);
      }
    }

    // × close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-chat-context-chip-close';
    closeBtn.type = 'button';
    closeBtn.title = 'Remove';
    closeBtn.setAttribute('aria-label', `Remove ${attachment.name}`);
    closeBtn.innerHTML = chatIcons.close;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    chip.appendChild(closeBtn);

    return chip;
  }

  private _buildPreviewDataUrl(attachment: IChatImageAttachment): string {
    return `data:${attachment.mimeType};base64,${attachment.data}`;
  }

  private _readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image attachment.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
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
