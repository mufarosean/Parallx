// browserAutomationTypes.ts — the assistant's browser tools: contract types.
//
// docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md. The core service
// (browserAutomationService.ts) registers the tools the Browser extension
// brings while it is registered as the automation HOST; the main-process broker
// (electron/browserAutomationBroker.cjs) does the work. Results travel as
// versioned JSON inside IToolResult.content.

import { createServiceIdentifier } from '../platform/types.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

/** The one extension that may host browser automation. Its tools carry this owner id. */
export const BROWSER_OWNER_TOOL_ID = 'parallx.browser';

/**
 * One assistant tool the host brings when it registers (contract section 1).
 * The core holds no tool names, descriptions or schemas: the Browser declares
 * them, and the core turns each into a chat tool that drives one broker
 * operation. What reaches the broker is decided by the core, not the host: only
 * the arguments the schema declares (typed as declared), the call's identity
 * from the invocation, and an operation the broker knows. Confirmation, network
 * reach and the chat-turn requirement are enforced by the core per operation; a
 * spec can ask for more confirmation, never less.
 */
export interface IBrowserAutomationToolSpec {
  /** The chat tool's name. Unique among the host's tools. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema of type object. Its properties are the only arguments passed on. */
  readonly parameters: Record<string, unknown>;
  /** The broker operation this tool runs (electron/browserAutomationBroker.cjs). */
  readonly op: string;
  /** Ask the user first. An operation that acts on a page always asks, whatever this says. */
  readonly requiresConfirmation?: boolean;
}

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
  /** Where the next read continues: from for targets, textFrom for cut text. */
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
  /** A tab in a private session (an open with private: true): the host marks it. */
  readonly private?: boolean;
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
  /**
   * Register the host and the tools it brings. The tools exist from now until
   * the returned registration is disposed. Throws on an invalid spec, before
   * anything is registered.
   */
  registerHost(host: IBrowserAutomationHost, ownerToolId: string, tools: readonly IBrowserAutomationToolSpec[]): IBrowserAutomationHostRegistration;
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
