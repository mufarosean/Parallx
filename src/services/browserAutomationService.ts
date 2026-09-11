// browserAutomationService.ts — the assistant's browser tools.
//
// docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md. One eager core service. The
// Browser extension registers itself as the HOST (parallx.browser.
// registerAutomationHost); from then until it disposes the registration, this
// service registers the browser tools with the tools service, owned by
// 'parallx.browser' through the bridge source. So extension enablement, the
// seal filter, the PolicyDecisionPoint, runtime observers and cleanup all apply
// exactly as for any extension tool; the tools simply do not exist while the
// Browser is off.
//
// The trusted identity of every call comes from the invocation, never from the
// model's arguments: the chat session id (invocation context), the request id
// (the cancellation token's turnId) and the workspace session (the session
// manager). The main-process broker checks it against the lease it holds.

import { Disposable, toDisposable, type IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { IChatTool, IToolResult, ICancellationToken, IChatToolInvocationCallContext, IToolResultArtifact, IChatImageAttachment } from './chatTypes.js';
import { isWorkspaceSealed, SEALED_WORKSPACE_SETTING } from './sealedWorkspace.js';
import type {
  IBrowserAutomationHost,
  IBrowserAutomationHostRegistration,
  IBrowserAutomationService,
  IBrowserAutomationTransport,
  IBrowserRunState,
  IChatRequestCompletion,
  BrowserControlAction,
  BrowserToolName,
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
}

interface ToolSpec {
  readonly name: BrowserToolName;
  readonly op: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresConfirmation: boolean;
  readonly toAction: (args: Record<string, unknown>) => Record<string, unknown>;
}

const REF = { type: 'string', description: 'A target reference from the latest browserRead, like "e12".' };
const INDEX = { type: 'integer', description: 'Legacy: the target\'s number (i) in the latest read. Prefer ref.' };
const KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
const pick = (args: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
};
const target = (args: Record<string, unknown>) => ({
  ...(typeof args.ref === 'string' ? { ref: args.ref } : {}),
  ...(args.index !== undefined && Number.isFinite(Number(args.index)) ? { index: Math.trunc(Number(args.index)) } : {}),
});

/** The browser tools. Names are the existing five plus act, tabs, wait and capture (contract section 1). */
export const BROWSER_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'browserOpen', op: 'open', requiresConfirmation: false,
    description: 'Open a web page in the Assistant Browser: a tab the user can watch, using the assistant\'s own browser profile (its own cookies and sign-ins, separate from the user\'s). Returns JSON with the page text and its targets (links, buttons, fields), each with a ref such as "e12" for browserClick, browserType and browserAct. Only http(s) addresses. One chat uses the Assistant Browser at a time. Prefer webSearch or webFetch for plain reading; use the browser when a page needs interaction.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'An http(s) address.' }, newTab: { type: 'boolean', description: 'Open in a new assistant tab instead of the current one.' } }, required: ['url'] },
    toAction: (a) => pick(a, 'url', 'newTab'),
  },
  {
    name: 'browserRead', op: 'read', requiresConfirmation: false,
    description: 'Read the current Assistant Browser page again: text and targets with fresh refs. find lists only targets whose role or name contains the words; from pages through more targets; scope "targets" or "text" returns only that part. When the text is truncated, pass next.textFrom as textFrom to read the text that follows. References from older reads can be refused as stale.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string' },
        from: { type: 'integer' },
        scope: { type: 'string', enum: ['all', 'targets', 'text'] },
        textFrom: { type: 'integer', description: 'Character offset in the page text to start from: next.textFrom of a truncated read.' },
      },
    },
    toAction: (a) => pick(a, 'find', 'from', 'scope', 'textFrom'),
  },
  {
    name: 'browserClick', op: 'click', requiresConfirmation: true,
    description: 'Click a target by ref with a real mouse click. Returns what happened (navigated, page changed, popup, download, dialog or no visible change) and the page afterwards. A stale, hidden or covered target is refused, never swapped for another element. A click that reached a site cannot be undone.',
    parameters: { type: 'object', properties: { ref: REF, index: INDEX } },
    toAction: (a) => target(a),
  },
  {
    name: 'browserType', op: 'type', requiresConfirmation: true,
    description: 'Type into a text field or editor by ref, replacing its contents; submit presses Enter afterwards. Password and one-time-code fields are refused: the user types those into the Assistant Browser themselves.',
    parameters: { type: 'object', properties: { ref: REF, index: INDEX, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['text'] },
    toAction: (a) => ({ ...target(a), text: String(a.text ?? ''), submit: a.submit === true }),
  },
  {
    name: 'browserBack', op: 'back', requiresConfirmation: false,
    description: 'Go back one page in the current assistant tab and return the page.',
    parameters: { type: 'object', properties: {} },
    toAction: () => ({}),
  },
  {
    name: 'browserAct', op: 'act', requiresConfirmation: true,
    description: 'Other actions: check (a checkbox, radio or switch to checked true or false), select (a dropdown option by value or label), press (a key, optionally on a ref), hover, scroll (a ref into view, or the page up or down without one), dialog (accept or dismiss an open alert, confirm or prompt; text answers a prompt), click_at (x, y in a browserCapture image, with its captureId, for something that has no ref).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['check', 'select', 'press', 'hover', 'scroll', 'dialog', 'click_at'] },
        ref: REF, index: INDEX,
        checked: { type: 'boolean' }, value: { type: 'string' }, label: { type: 'string' },
        key: { type: 'string', enum: KEYS }, direction: { type: 'string', enum: ['up', 'down'] },
        accept: { type: 'boolean' }, text: { type: 'string' },
        captureId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
      required: ['action'],
    },
    toAction: (a) => ({ ...target(a), ...pick(a, 'action', 'checked', 'value', 'label', 'key', 'direction', 'accept', 'text', 'captureId', 'x', 'y') }),
  },
  {
    name: 'browserTabs', op: 'tabs', requiresConfirmation: false,
    description: 'List, switch to, or close this chat\'s assistant tabs. A popup a page opens becomes a new assistant tab.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'switch', 'close'] }, tab: { type: 'string' } } },
    toAction: (a) => pick(a, 'action', 'tab'),
  },
  {
    name: 'browserWait', op: 'wait', requiresConfirmation: false,
    description: 'Wait for a condition on the current page: load, url (contains value), text (value appears), gone (value disappears) or download (finishes). Returns as soon as it holds; timeoutMs up to 30000. A timeout is an error, not a success.',
    parameters: { type: 'object', properties: { for: { type: 'string', enum: ['load', 'url', 'text', 'gone', 'download'] }, value: { type: 'string' }, timeoutMs: { type: 'integer' } }, required: ['for'] },
    toAction: (a) => pick(a, 'for', 'value', 'timeoutMs'),
  },
  {
    name: 'browserCapture', op: 'capture', requiresConfirmation: false,
    description: 'Capture the visible Assistant Browser page as an image you can see (models with vision only). Use it when a page cannot be understood from its text and targets; click something in it with browserAct click_at.',
    parameters: { type: 'object', properties: {} },
    toAction: () => ({}),
  },
];

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

export class BrowserAutomationService extends Disposable implements IBrowserAutomationService {
  private _host: IBrowserAutomationHost | undefined;

  constructor(private readonly _deps: IBrowserAutomationDeps) {
    super();
    // A deleted chat takes its captures and downloads with it, whether or not
    // the Browser is on now: the files are on disk from earlier runs.
    this._register(_deps.chat.onDidDeleteSession((chatSessionId) => {
      const t = this._transport();
      if (t) void t.call('clearArtifacts', { chatSessionIds: [chatSessionId] }).catch(() => { /* main process not ready */ });
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

  registerHost(host: IBrowserAutomationHost, ownerToolId: string): IBrowserAutomationHostRegistration {
    if (this._host) throw new Error('A browser automation host is already registered.');
    const transport = this._transport();
    this._host = host;
    const regs: IDisposable[] = [];
    if (transport) {
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
      for (const spec of BROWSER_TOOL_SPECS) {
        regs.push(this._deps.tools.registerTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
          requiresConfirmation: spec.requiresConfirmation,
          source: 'bridge',
          ownerToolId,
          handler: (args, token, invocation) => this._invoke(spec, args, token, invocation),
        }));
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
        for (const r of regs.reverse()) { try { r.dispose(); } catch { /* ignore */ } }
        if (transport) void transport.call('revokeAll', { reason: 'host-gone', closeViews: true }).catch(() => {});
        if (this._host === host) this._host = undefined;
      },
    };
  }

  private _onEvent(e: { type: string; payload: unknown }): void {
    if (e.type !== 'automation:event' || !this._host) return;
    const p = e.payload as { type?: string; tabId?: string; chatSessionId?: string; openerTabId?: string | null; reveal?: boolean } & Partial<IBrowserRunState>;
    const host = this._host;
    try {
      if (p.type === 'tab-open' && p.tabId && p.chatSessionId) void host.openTab({ tabId: p.tabId, chatSessionId: p.chatSessionId, openerTabId: p.openerTabId ?? null, reveal: p.reveal !== false });
      else if (p.type === 'tab-closed' && p.tabId) void host.closeTab(p.tabId);
      else if (p.type === 'reveal' && p.tabId) void host.revealTab(p.tabId);
      else if (p.type === 'run-state' && p.chatSessionId) {
        host.setRunState({ chatSessionId: p.chatSessionId, tabId: p.tabId ?? null, tabs: p.tabs ?? [], state: p.state ?? 'idle', note: p.note ?? '', by: p.by ?? null });
      }
    } catch (err) {
      console.warn('[BrowserAutomation] host event failed:', err);
    }
  }

  private async _invoke(spec: ToolSpec, args: Record<string, unknown>, token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
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
    if (spec.op === 'capture' && invocation?.acceptsImages !== true) {
      return outcomeResult('NO_VISION', 'The chat model cannot see images. Use browserRead instead.');
    }
    const identity = { chatSessionId, turnId, workspaceSessionId: ctx.sessionId };
    // The turn's cancellation and the workspace session's abort both end the run.
    const cancel = () => { void transport.call('cancel', { chatSessionId, turnId }).catch(() => {}); };
    const sub = token.onCancellationRequested(cancel);
    ctx.cancellationSignal?.addEventListener('abort', cancel, { once: true });
    try {
      const raw = await transport.call('run', { identity, action: { op: spec.op, ...spec.toAction(args ?? {}) } }, invocation?.resultCharBudget);
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
      if (spec.op === 'capture') {
        for (const a of artifacts) {
          const r = await transport.call('readArtifact', { id: a.id }).catch(() => null) as { mimeType?: string; data?: string } | null;
          if (r && typeof r.data === 'string' && typeof r.mimeType === 'string') {
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
