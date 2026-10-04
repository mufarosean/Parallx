// canvasBlocksBridge.ts — bridges `parallx.canvas.registerBlock` to a shared
// in-process hub of page block contributions.
//
// A block that shows one tool's data (the planner's agenda, an Atelier
// album, Worksheets problems) belongs to that tool, not to the canvas: the
// tool registers it when it starts and it goes away when the tool is turned
// off, so a user who never enabled the tool never sees it. The canvas only
// knows the contract below and draws the frame (title, actions, Edit…).
//
// Stored pages keep such a block as one generic node (`toolBlock`, see
// canvas/extensions/toolBlockNode.ts) holding the block type and its
// settings, so turning a tool off never loses a block: it shows a note
// naming the tool, and comes back as it was when the tool is turned on.
//
// Same architecture as dashboardBridge: module-global hub (contributions
// survive activation order) + per-tool bridges cleaned up on deactivation.

import { type IDisposable, toDisposable } from '../../platform/lifecycle.js';

// ─── Contract ────────────────────────────────────────────────────────────────

export interface CanvasBlockOption { readonly value: string; readonly label: string }

/** One setting in the block's Edit… menu. */
export interface CanvasBlockField {
  readonly type: 'enum' | 'string' | 'number';
  readonly label: string;
  /** enum: fixed choices, or read when the menu opens (an album list). */
  readonly options?: readonly CanvasBlockOption[] | (() => Promise<readonly CanvasBlockOption[]>);
  readonly placeholder?: string;
}

export interface CanvasBlockAction {
  readonly label: string;
  run(): void;
}

/** What the canvas hands a block when it draws it. */
export interface CanvasBlockContext {
  /** The block's settings as stored in the page. */
  readonly config: Readonly<Record<string, unknown>>;
  /** False on a locked or read-only page. */
  readonly editable: boolean;
  /** Store new settings (merged); the block is drawn again through update(). */
  setConfig(patch: Record<string, unknown>): void;
  /** The title in the block's bar. */
  setTitle(text: string): void;
  /** Buttons in the block's bar, shown on hover, before Edit…. */
  setActions(actions: readonly CanvasBlockAction[]): void;
  /** Replace the body with a quiet one-line message. */
  showNote(text: string): void;
}

export interface CanvasBlockHandle {
  /** The settings changed (Edit…, undo, another copy of the page). */
  update?(config: Readonly<Record<string, unknown>>): void;
  dispose?(): void;
}

export interface CanvasBlockRegistration {
  /** `${toolId}.${name}`: namespaced under the contributing tool. */
  readonly typeId: string;
  /** Title Case name in the / menu ("Media Gallery"). */
  readonly label: string;
  /** One line under the name in the / menu. */
  readonly description: string;
  /** An icon registry id. */
  readonly icon: string;
  readonly defaultConfig: Readonly<Record<string, unknown>>;
  /** The Edit… menu; no Edit… button when absent. */
  readonly settings?: { readonly title: string; readonly fields: Readonly<Record<string, CanvasBlockField>> };
  /** Draw the block into `body`. */
  render(body: HTMLElement, ctx: CanvasBlockContext): CanvasBlockHandle | void;
  /** What a reader (export, the AI) sees of the block; one line. */
  readable?(config: Readonly<Record<string, unknown>>): string;
}

export interface ContributedCanvasBlock {
  readonly ownerToolId: string;
  /** The tool's name as the user knows it ("Atelier"). */
  readonly ownerName: string;
  readonly registration: CanvasBlockRegistration;
}

// ─── Hub ─────────────────────────────────────────────────────────────────────

const _contributions = new Map<string, ContributedCanvasBlock>();
const _listeners = new Set<() => void>();

function _fireChange(): void {
  for (const l of [..._listeners]) { try { l(); } catch (err) { console.error('[api.canvas] listener failed:', err); } }
}

/** Every block contributed by a running tool. */
export function getContributedBlocks(): readonly ContributedCanvasBlock[] {
  return [..._contributions.values()];
}

export function getContributedBlock(typeId: string): ContributedCanvasBlock | undefined {
  return _contributions.get(typeId);
}

/** Fires when a tool adds or removes a block (it was turned on or off). */
export function onDidChangeContributedBlocks(listener: () => void): IDisposable {
  _listeners.add(listener);
  return toDisposable(() => { _listeners.delete(listener); });
}

function validate(toolId: string, reg: CanvasBlockRegistration): void {
  if (!reg || typeof reg !== 'object') throw new Error('[api.canvas] registerBlock needs a registration object.');
  if (typeof reg.typeId !== 'string' || !reg.typeId.startsWith(`${toolId}.`) || reg.typeId.length <= toolId.length + 1) {
    throw new Error(`[api.canvas] Block typeId "${String(reg.typeId)}" must start with "${toolId}.".`);
  }
  for (const key of ['label', 'description', 'icon'] as const) {
    if (typeof reg[key] !== 'string' || !reg[key]) throw new Error(`[api.canvas] Block "${reg.typeId}" needs a ${key}.`);
  }
  if (typeof reg.render !== 'function') throw new Error(`[api.canvas] Block "${reg.typeId}" needs a render function.`);
  if (!reg.defaultConfig || typeof reg.defaultConfig !== 'object') throw new Error(`[api.canvas] Block "${reg.typeId}" needs a defaultConfig object.`);
}

// ─── Per-tool bridge ─────────────────────────────────────────────────────────

export class CanvasBlocksBridge {
  private _disposed = false;
  private readonly _mine = new Map<string, ContributedCanvasBlock>();

  constructor(
    private readonly _toolId: string,
    private readonly _toolName: string,
    private readonly _subscriptions: IDisposable[],
  ) {}

  registerBlock(registration: CanvasBlockRegistration): IDisposable {
    if (this._disposed) throw new Error('[api.canvas] Tool was deactivated.');
    validate(this._toolId, registration);
    const existing = _contributions.get(registration.typeId);
    if (existing && existing.ownerToolId !== this._toolId) {
      throw new Error(`[api.canvas] Block "${registration.typeId}" is already registered by "${existing.ownerToolId}".`);
    }
    const entry: ContributedCanvasBlock = { ownerToolId: this._toolId, ownerName: this._toolName, registration };
    _contributions.set(registration.typeId, entry);
    this._mine.set(registration.typeId, entry);
    _fireChange();
    const d = toDisposable(() => this._remove(registration.typeId, entry));
    this._subscriptions.push(d);
    return d;
  }

  private _remove(typeId: string, entry: ContributedCanvasBlock): void {
    if (_contributions.get(typeId) !== entry) return;
    _contributions.delete(typeId);
    this._mine.delete(typeId);
    _fireChange();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const [typeId, entry] of [...this._mine]) this._remove(typeId, entry);
  }
}
