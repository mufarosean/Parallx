// appConnections.ts — a mini-app or an extension using one of the person's tools.
//
// Apps the assistant builds become useful when they can reach the person's
// other tools (their Planner, their pages, their flashcards). They do it
// through the same tools the assistant uses, and only with the person's
// permission: chat owns the gate (built-in/chat/rendering/appConnections.ts:
// the policy check, the permission dialog, the grants and the settings page
// that revokes them) and sets it here. The extension API calls in through
// `callToolAsApp`; a mini-app's frame reaches the same gate from the ui layer.

export interface AppRef {
  /** A mini-app's code fingerprint, or an extension's id. */
  readonly id: string;
  /** The name the person knows it by. */
  readonly title: string;
  readonly kind: 'mini-app' | 'extension';
}

/** What a tool call gives an app: the tool's text, and that text parsed when it is JSON. */
export interface AppToolResult {
  readonly content: string;
  readonly data?: unknown;
}

export type AppToolCaller = (app: AppRef, tool: string, args: Record<string, unknown>) => Promise<AppToolResult>;

let _caller: AppToolCaller | null = null;

/** Chat sets the gate when it starts (and clears it when it stops). */
export function setAppToolCaller(caller: AppToolCaller | null): void {
  _caller = caller;
}

/** Use a tool for `app`, through the person's permission; rejects with the reason when it may not. */
export function callToolAsApp(app: AppRef, tool: string, args: Record<string, unknown>): Promise<AppToolResult> {
  if (!_caller) return Promise.reject(new Error('Tools cannot be used here.'));
  return _caller(app, tool, args && typeof args === 'object' ? args : {});
}
