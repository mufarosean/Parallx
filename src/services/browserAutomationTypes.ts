// browserAutomationTypes.ts — the assistant's browser tools: contract types.
//
// docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md. The core service
// (browserAutomationService.ts) registers the browser tools while the Browser
// extension is registered as the automation HOST; the main-process broker
// (electron/browserAutomationBroker.cjs) does the work. Results travel as
// versioned JSON inside IToolResult.content.

import { createServiceIdentifier } from '../platform/types.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

/** The one extension that may host browser automation. Its tools carry this owner id. */
export const BROWSER_OWNER_TOOL_ID = 'parallx.browser';

/**
 * The browser tools, named once. The service registers exactly these while the
 * Browser hosts them. A workflow tool step has no chat turn for the broker's
 * lease, so it refuses them and the workflow editor does not offer them.
 */
export const BROWSER_TOOL_NAMES = [
  'browserOpen', 'browserRead', 'browserClick', 'browserType', 'browserBack',
  'browserAct', 'browserTabs', 'browserWait', 'browserCapture',
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

const BROWSER_TOOL_NAME_SET: ReadonlySet<string> = new Set(BROWSER_TOOL_NAMES);

export function isBrowserToolName(name: string): name is BrowserToolName {
  return BROWSER_TOOL_NAME_SET.has(name);
}

/** What a workflow tool step gets instead of running a browser tool. */
export const BROWSER_TOOLS_NEED_A_CHAT = 'The Assistant Browser runs only inside a chat or an Agent Turn step. Use an Agent Turn step to browse.';

export type BrowserOutcomeStatus = 'ok' | 'needs_user' | 'cancelled' | 'error';

export interface IBrowserTarget {
  /** Host-owned reference, valid only within the run and document it came from. */
  readonly ref: string;
  /** Position in the latest read (the legacy numeric index). */
  readonly i: number;
  readonly role: string;
  readonly name: string;
  readonly value?: string;
  readonly state?: string;
  readonly secret?: boolean;
  readonly offscreen?: boolean;
  readonly frame?: string;
}

export interface IBrowserOutcome {
  readonly version: 1;
  readonly status: BrowserOutcomeStatus;
  readonly summary: string;
  readonly tabId?: string;
  readonly documentId?: string;
  readonly observationId?: string;
  readonly url?: string;
  readonly title?: string;
  readonly text?: string;
  readonly targets?: readonly IBrowserTarget[];
  readonly truncated?: boolean;
  /** Where the next browserRead continues: from for targets, textFrom for cut text. */
  readonly next?: { readonly from?: number; readonly textFrom?: number; readonly note?: string };
  readonly evidence?: readonly { readonly kind: string; readonly detail: string }[];
  readonly error?: { readonly code: string; readonly retryable: boolean };
  readonly artifacts?: readonly { readonly kind: 'image'; readonly id: string; readonly mimeType: string; readonly width?: number; readonly height?: number }[];
}

export type BrowserRunStateKind = 'running' | 'paused' | 'idle';

export interface IBrowserRunState {
  readonly chatSessionId: string;
  readonly tabId: string | null;
  readonly tabs: readonly string[];
  readonly state: BrowserRunStateKind;
  readonly note: string;
  /** Why it is paused: the user took over, or Pause was pressed. */
  readonly by: 'user' | 'handoff' | null;
}

export interface IBrowserAutomationTabRequest {
  readonly tabId: string;
  readonly chatSessionId: string;
  readonly openerTabId: string | null;
  readonly reveal: boolean;
}

/**
 * What the Browser extension provides: it shows broker-created tabs as editor
 * panes and displays run state. It cannot create ownership or dispatch actions.
 */
export interface IBrowserAutomationHost {
  openTab(tab: IBrowserAutomationTabRequest): void | Promise<void>;
  closeTab(tabId: string): void | Promise<void>;
  revealTab(tabId: string): void | Promise<void>;
  setRunState(state: IBrowserRunState): void;
}

export type BrowserControlAction = 'pause' | 'resume' | 'takeover' | 'stop';

export interface IBrowserAutomationHostRegistration extends IDisposable {
  /** The user's controls from the Assistant Browser tab. Resolves true when applied. */
  control(action: BrowserControlAction): Promise<boolean>;
}

export interface IBrowserAutomationService {
  readonly hasHost: boolean;
  /** Register the host. The browser tools exist from now until the returned registration is disposed. */
  registerHost(host: IBrowserAutomationHost, ownerToolId: string): IBrowserAutomationHostRegistration;
}

export const IBrowserAutomationService = createServiceIdentifier<IBrowserAutomationService>('IBrowserAutomationService');

/** The main-process transport (the preload's browser.automation + onEvent), injectable for tests. */
export interface IBrowserAutomationTransport {
  call(method: string, payload?: unknown, budget?: number): Promise<unknown>;
  onEvent(listener: (event: { type: string; payload: unknown }) => void): () => void;
}

/** Fired by the chat service once per request on every terminal path. */
export interface IChatRequestCompletion {
  readonly sessionId: string;
  readonly turnId: string;
}

export type ChatRequestCompletionEvent = Event<IChatRequestCompletion>;
