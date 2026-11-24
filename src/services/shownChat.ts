// shownChat.ts — which conversation the chat has open, and whether it is on screen, for any tool
//
// A tool that opens the chat on something of its own (a staged prompt about
// one of its items) may need to know afterwards which conversation that was,
// and later whether that conversation is the one a person is looking at. The
// chat's widget says which conversation it is bound to and whether it is laid
// out; a tool reads it through `api.chat.shownSession()` and hears a change of
// conversation through `api.chat.onDidChangeShownSession`. Whether the panel
// is on screen is asked when read, never pushed: nothing runs for it.

import { Emitter, type Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** The conversation the chat is bound to; `showing` is false while its panel is closed, behind another view, or the window hidden. */
export interface IShownChat { readonly id: string; readonly showing: boolean }

let _source: (() => IShownChat | undefined) | undefined;
const _onDidChange = new Emitter<void>();

/** Fires when the chat is bound to another conversation. */
export const onDidChangeShownChat: Event<void> = _onDidChange.event;

/** The chat's widget says what it is bound to (again at every change of conversation). */
export function noteShownChat(source: (() => IShownChat | undefined) | undefined): void {
  _source = source;
  _onDidChange.fire();
}

export function shownChat(): IShownChat | undefined {
  try { return _source?.(); } catch { return undefined; }
}

/** The two members `api.chat` gains; `keep` ties a listener to the tool that asked. */
export function shownChatApi(keep: (d: IDisposable) => IDisposable) {
  return {
    /** The conversation the chat has open and whether it is on screen now; undefined when it has none. */
    shownSession: (): IShownChat | undefined => shownChat(),
    /** Fires when the chat opens another conversation. */
    onDidChangeShownSession: (listener: () => void): IDisposable => keep(onDidChangeShownChat(() => listener())),
  };
}
export type ShownChatApi = ReturnType<typeof shownChatApi>;
