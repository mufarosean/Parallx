// browserAutomationService.ts — the broker machinery behind the assistant's browser tools.
//
// docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md. One eager core service. The
// Browser extension registers itself as the HOST (parallx.browser.
// registerAutomationHost) and brings its tools' specs (names, descriptions,
// parameters, the broker operation each runs). From then until it disposes the
// registration, this service registers those tools with the tools service,
// owned by 'parallx.browser' through the bridge source. So extension
// enablement, the seal filter, the PolicyDecisionPoint, runtime observers and
// cleanup all apply exactly as for any extension tool; the tools simply do not
// exist while the Browser is off, and the core names none of them.
//
// What stays here is what must not be the host's to decide: the main-process
// transport, the per-turn lease and its release, the sealed-workspace context
// push, which broker operations exist and which of them always ask first, and
// what reaches the broker. The trusted identity of every call comes from the
// invocation, never from the model's arguments: the chat session id
// (invocation context), the request id (the cancellation token's turnId) and
// the workspace session (the session manager). The main-process broker checks
// it against the lease it holds.

import { Disposable, toDisposable, type IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { IChatTool, IToolResult, ICancellationToken, IChatToolInvocationCallContext, IToolResultArtifact, IChatImageAttachment } from './chatTypes.js';
import { isWorkspaceSealed, SEALED_WORKSPACE_SETTING } from './sealedWorkspace.js';
import { isToolImageGone, markToolImagesGone } from './toolImageLifetime.js';
import type {
  IBrowserAutomationHost,
  IBrowserAutomationHostRegistration,
  IBrowserAutomationService,
  IBrowserAutomationToolSpec,
  IBrowserAutomationTransport,
  IBrowserRunState,
  IChatRequestCompletion,
  BrowserControlAction,
} from './browserAutomationTypes.js';

type SettingsLike = Parameters<typeof isWorkspaceSealed>[0] & { readonly onDidChange?: Event<{ readonly key: string }> };

export interface IBrowserAutomationDeps {
  readonly tools: { registerTool(tool: IChatTool): IDisposable };
  /** Required: without the completion event a run's lease would outlive its request. */
  readonly chat: { readonly onDidCompleteRequest: Event<IChatRequestCompletion>; readonly onDidDeleteSession: Event<string> };
  /** The workspace session. Its cancellationSignal aborts when the workspace session ends. */
  readonly sessions: () => { readonly activeContext: { readonly workspaceId: string; readonly sessionId: string; readonly cancellationSignal?: AbortSignal } | undefined; readonly onDidChangeSession: Event<unknown> } | undefined;
  readonly settings: () => SettingsLike | undefined;
  readonly transport?: () => IBrowserAutomationTransport | undefined;
  /** Erase deleted chats' kept captures and downloads (main process; works with the Browser off). */
  readonly forgetChats?: (chatSessionIds: string[]) => Promise<unknown>;
}

/**
 * The broker's operations (electron/browserAutomationBroker.cjs execute()) and
 * what the core enforces for each, whatever the host declares. An operation
 * that acts on a page always asks first; an image operation runs only for a
 * loop that hands images to the model, and its images ride along with the
 * result. A spec naming any other operation is refused at registration.
 */
const BROKER_OPS: Readonly<Record<string, { readonly confirm: boolean; readonly image?: boolean }>> = Object.freeze({
  open: { confirm: false },
  read: { confirm: false },
  back: { confirm: false },
  tabs: { confirm: false },
  wait: { confirm: false },
  capture: { confirm: false, image: true },
  click: { confirm: true },
  type: { confirm: true },
  act: { confirm: true },
});

const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** A host's spec, checked and copied: later changes to the host's object reach nothing. */
interface ToolPlan {
  readonly name: string;
  readonly op: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresConfirmation: boolean;
  readonly image: boolean;
  /** Declared argument name -> its declared JSON type ('' when undeclared). */
  readonly args: ReadonlyMap<string, string>;
}

function planTools(specs: readonly IBrowserAutomationToolSpec[]): ToolPlan[] {
  if (!Array.isArray(specs)) throw new Error('Browser automation tools must be a list.');
  const seen = new Set<string>();
  return specs.map((spec) => {
    const name = spec?.name;
    if (typeof name !== 'string' || !TOOL_NAME.test(name)) throw new Error(`Invalid browser automation tool name: ${String(name)}`);
    if (seen.has(name)) throw new Error(`Browser automation tool declared twice: ${name}`);
    seen.add(name);
    const op = spec.op;
    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(BROKER_OPS, op)) throw new Error(`${name}: unknown broker operation ${String(op)}`);
    if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error(`${name}: a description is required`);
    const params = spec.parameters as { type?: unknown; properties?: unknown } | undefined;
    if (!params || typeof params !== 'object' || params.type !== 'object') throw new Error(`${name}: parameters must be a JSON Schema object`);
    let parameters: Record<string, unknown>;
    try { parameters = JSON.parse(JSON.stringify(params)); } catch { throw new Error(`${name}: parameters must be plain JSON`); }
    const props = parameters.properties && typeof parameters.properties === 'object' ? parameters.properties as Record<string, unknown> : {};
    const args = new Map<string, string>();
    for (const [key, schema] of Object.entries(props)) {
      const type = schema && typeof schema === 'object' && typeof (schema as { type?: unknown }).type === 'string' ? (schema as { type: string }).type : '';
      args.set(key, type);
    }
    const policy = BROKER_OPS[op];
    return {
      name, op, description: spec.description, parameters, args,
      requiresConfirmation: policy.confirm || spec.requiresConfirmation === true,
      image: policy.image === true,
    };
  });
}

/**
 * The broker action for a call: the operation, then only the arguments the
 * schema declares, each kept only when it fits its declared type (integers are
 * truncated, a primitive given for a string is stringified). Anything else the
 * model sends (an identity, another operation) never reaches the broker.
 */
function toAction(plan: ToolPlan, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, type] of plan.args) {
    if (key === 'op' || !Object.prototype.hasOwnProperty.call(args, key)) continue;
    const v = args[key];
    if (v === undefined || v === null) continue;
    if (type === 'integer' || type === 'number') {
      const n = Number(v);
      if (typeof v !== 'boolean' && v !== '' && Number.isFinite(n)) out[key] = type === 'integer' ? Math.trunc(n) : n;
    } else if (type === 'string') {
      if (typeof v === 'string') out[key] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[key] = String(v);
    } else if (type === 'boolean') {
      if (typeof v === 'boolean') out[key] = v;
    } else {
      out[key] = v;
    }
  }
  return { op: plan.op, ...out };
}

function outcomeResult(code: string, summary: string, retryable = false): IToolResult {
  return { content: JSON.stringify({ version: 1, status: 'error', summary, error: { code, retryable } }), isError: true };
}

function electronTransport(): IBrowserAutomationTransport | undefined {
  const b = (globalThis as { parallxElectron?: { browser?: { automation?: (m: string, p?: unknown, budget?: number) => Promise<unknown>; onEvent?: (cb: (e: { type: string; payload: unknown }) => void) => () => void } } }).parallxElectron?.browser;
  if (!b || typeof b.automation !== 'function' || typeof b.onEvent !== 'function') return undefined;
  const automation = b.automation.bind(b);
  const onEvent = b.onEvent.bind(b);
  return { call: (m, p, budget) => automation(m, p, budget), onEvent: (cb) => onEvent(cb) };
}

function electronForgetChats(): ((ids: string[]) => Promise<unknown>) | undefined {
  const b = (globalThis as { parallxElectron?: { browser?: { forgetChats?: (ids: string[]) => Promise<unknown> } } }).parallxElectron?.browser;
  return b?.forgetChats ? (ids) => b.forgetChats!(ids) : undefined;
}

export class BrowserAutomationService extends Disposable implements IBrowserAutomationService {
  private _host: IBrowserAutomationHost | undefined;

  constructor(private readonly _deps: IBrowserAutomationDeps) {
    super();
    // A deleted chat takes its captures and downloads with it, whether or not
    // the Browser is on now: the files are on disk from earlier runs. With the
    // Browser off nothing of it starts; the main process erases the files.
    this._register(_deps.chat.onDidDeleteSession((chatSessionId) => {
      const forget = this._deps.forgetChats ?? electronForgetChats();
      if (forget) void forget([chatSessionId]).catch(() => { /* main process not ready */ });
    }));
  }

  get hasHost(): boolean { return !!this._host; }

  private _transport(): IBrowserAutomationTransport | undefined {
    return this._deps.transport ? this._deps.transport() : electronTransport();
  }

  /** Tell the broker which workspace session is current and whether it is sealed. */
  private _pushContext(): void {
    const t = this._transport();
    const ctx = this._deps.sessions()?.activeContext;
    if (!t || !ctx) return;
    const sealed = isWorkspaceSealed(this._deps.settings());
    void t.call('setContext', { workspaceId: ctx.workspaceId, workspaceSessionId: ctx.sessionId, sealed }).catch(() => { /* main process not ready */ });
  }

  registerHost(host: IBrowserAutomationHost, ownerToolId: string, tools: readonly IBrowserAutomationToolSpec[]): IBrowserAutomationHostRegistration {
    if (this._host) throw new Error('A browser automation host is already registered.');
    // Checked and copied before anything starts: a bad spec registers nothing.
    const plans = planTools(tools);
    // A capture refused for a model that cannot see points at the host's own read tool.
    const readTool = plans.find((p) => p.op === 'read')?.name;
    const transport = this._transport();
    this._host = host;
    const regs: IDisposable[] = [];
    const undo = () => { for (const r of regs.reverse()) { try { r.dispose(); } catch { /* ignore */ } } };
    if (transport) {
      try {
        regs.push(toDisposable(transport.onEvent((e) => this._onEvent(e))));
        const sessions = this._deps.sessions();
        // The workspace session ended (a switch is under way): end every run now,
        // not when the window reloads, so a pending wait or queued click cannot
        // reach a site behind the transition.
        if (sessions) regs.push(sessions.onDidChangeSession(() => {
          if (!this._deps.sessions()?.activeContext) {
            void transport.call('revokeAll', { reason: 'workspace', closeViews: true }).catch(() => {});
            return;
          }
          this._pushContext();
        }));
        const settings = this._deps.settings();
        if (settings?.onDidChange) regs.push(settings.onDidChange((c) => { if (c.key === SEALED_WORKSPACE_SETTING) this._pushContext(); }));
        regs.push(this._deps.chat.onDidCompleteRequest((c) => {
          void transport.call('release', { chatSessionId: c.sessionId, turnId: c.turnId }).catch(() => {});
        }));
        this._pushContext();
        for (const plan of plans) {
          // Set here for every tool, whatever the host declared: the broker
          // reaches the web (a sealed workspace hides it), and its lease lives
          // and dies with a chat turn (a workflow Tool step refuses it).
          regs.push(this._deps.tools.registerTool({
            name: plan.name,
            description: plan.description,
            parameters: plan.parameters,
            requiresConfirmation: plan.requiresConfirmation,
            source: 'bridge',
            ownerToolId,
            reachesNetwork: true,
            needsChatTurn: true,
            handler: (args, token, invocation) => this._invoke(plan, readTool, args, token, invocation),
          }));
        }
      } catch (err) {
        undo();
        this._host = undefined;
        throw err;
      }
    } else {
      console.warn('[BrowserAutomation] no main-process transport; the browser tools are not registered');
    }
    let disposed = false;
    return {
      control: async (action: BrowserControlAction) => {
        const t = this._transport();
        if (!t) return false;
        const r = await t.call('control', { action }).catch(() => null) as { ok?: boolean } | null;
        return !!(r && r.ok);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        undo();
        if (transport) void transport.call('revokeAll', { reason: 'host-gone', closeViews: true }).catch(() => {});
        if (this._host === host) this._host = undefined;
      },
    };
  }

  private _onEvent(e: { type: string; payload: unknown }): void {
    if (e.type !== 'automation:event') return;
    // Erased captures leave any turn still running before its next model call.
    const cleared = e.payload as { type?: string; artifactIds?: unknown } | null;
    if (cleared?.type === 'artifacts-cleared' && Array.isArray(cleared.artifactIds)) {
      markToolImagesGone(cleared.artifactIds.filter((x): x is string => typeof x === 'string'));
    }
    if (!this._host) return;
    const p = e.payload as { type?: string; tabId?: string; chatSessionId?: string; openerTabId?: string | null; reveal?: boolean; private?: boolean } & Partial<IBrowserRunState>;
    const host = this._host;
    try {
      if (p.type === 'tab-open' && p.tabId && p.chatSessionId) void host.openTab({ tabId: p.tabId, chatSessionId: p.chatSessionId, openerTabId: p.openerTabId ?? null, reveal: p.reveal !== false, private: p.private === true });
      else if (p.type === 'tab-closed' && p.tabId) void host.closeTab(p.tabId);
      else if (p.type === 'reveal' && p.tabId) void host.revealTab(p.tabId);
      else if (p.type === 'run-state' && p.chatSessionId) {
        host.setRunState({ chatSessionId: p.chatSessionId, tabId: p.tabId ?? null, tabs: p.tabs ?? [], state: p.state ?? 'idle', note: p.note ?? '', by: p.by ?? null });
      }
    } catch (err) {
      console.warn('[BrowserAutomation] host event failed:', err);
    }
  }

  private async _invoke(plan: ToolPlan, readTool: string | undefined, args: Record<string, unknown>, token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
    const transport = this._transport();
    if (!transport || !this._host) return outcomeResult('UNAVAILABLE', 'The Browser is not available.', true);
    const ctx = this._deps.sessions()?.activeContext;
    const chatSessionId = invocation?.sessionId;
    const turnId = token?.turnId;
    if (!ctx || !chatSessionId || !turnId) {
      return outcomeResult('MISSING_CONTEXT', 'Browser actions need a chat session, a request and an open workspace.');
    }
    if (token.isCancellationRequested || ctx.cancellationSignal?.aborted) return { content: JSON.stringify({ version: 1, status: 'cancelled', summary: 'The request was cancelled; nothing ran.', error: { code: 'CANCELLED', retryable: false } }), isError: true };
    // Only the loop that will hand the image to the model may capture: the
    // default chat loop with a model that can see. @workspace, @canvas and
    // workflows send tool results as text, and a capture there would tell the
    // model to click in an image it never got.
    if (plan.image && invocation?.acceptsImages !== true) {
      return outcomeResult('NO_VISION', `The chat model cannot see images. ${readTool ? `Use ${readTool} instead.` : 'Read the page as text instead.'}`);
    }
    const identity = { chatSessionId, turnId, workspaceSessionId: ctx.sessionId };
    // The turn's cancellation and the workspace session's abort both end the run.
    const cancel = () => { void transport.call('cancel', { chatSessionId, turnId }).catch(() => {}); };
    const sub = token.onCancellationRequested(cancel);
    ctx.cancellationSignal?.addEventListener('abort', cancel, { once: true });
    try {
      const raw = await transport.call('run', { identity, action: toAction(plan, args ?? {}) }, invocation?.resultCharBudget);
      if (typeof raw !== 'string') {
        const err = raw && typeof raw === 'object' && '__error' in raw ? String((raw as { __error: unknown }).__error) : 'no answer';
        return outcomeResult('UNAVAILABLE', `The Browser did not answer: ${err}`, true);
      }
      let parsed: { status?: string; artifacts?: unknown };
      try { parsed = JSON.parse(raw); } catch { return outcomeResult('INTERNAL', 'The Browser returned an unreadable result.', true); }
      const artifacts: IToolResultArtifact[] = Array.isArray(parsed.artifacts)
        ? (parsed.artifacts as { kind?: string; id?: string; mimeType?: string; width?: number; height?: number }[])
          .filter((a) => a && a.kind === 'image' && typeof a.id === 'string' && typeof a.mimeType === 'string')
          .map((a) => ({ kind: 'image' as const, id: a.id as string, mimeType: a.mimeType as string, width: a.width, height: a.height }))
        : [];
      // Capture runs only when the loop delivers images (checked above): the
      // bytes ride along for this turn; the card and history keep the ids.
      const images: IChatImageAttachment[] = [];
      if (plan.image) {
        for (const a of artifacts) {
          const r = await transport.call('readArtifact', { id: a.id }).catch(() => null) as { mimeType?: string; data?: string } | null;
          if (r && typeof r.data === 'string' && typeof r.mimeType === 'string' && !isToolImageGone(a.id)) {
            images.push({ kind: 'image', id: a.id, name: 'Page capture', fullPath: '', isImplicit: false, mimeType: r.mimeType, data: r.data });
          }
        }
      }
      return { content: raw, isError: parsed.status !== 'ok', ...(artifacts.length ? { artifacts } : {}), ...(images.length ? { images } : {}) };
    } finally {
      sub.dispose();
      ctx.cancellationSignal?.removeEventListener('abort', cancel);
    }
  }
}
