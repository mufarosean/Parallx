// chatModeService.ts — IChatModeService implementation (M9 Task 2.3)
//
// Mode state management: Ask / Edit / Agent.
// Tracks the user's current mode selection and available modes.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatModes.ts

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { ChatMode } from './chatTypes.js';
import type { IChatModeService } from './chatTypes.js';

/** All available modes in order. */
const ALL_MODES: readonly ChatMode[] = [ChatMode.Ask, ChatMode.Edit, ChatMode.Agent];

/**
 * Chat mode service — manages Ask/Edit/Agent mode state.
 *
 * Default mode is Ask (safe, no side effects).
 */
export class ChatModeService extends Disposable implements IChatModeService {

  private _currentMode: ChatMode = ChatMode.Agent;

  // ── Events ──

  private readonly _onDidChangeMode = this._register(new Emitter<ChatMode>());
  readonly onDidChangeMode: Event<ChatMode> = this._onDidChangeMode.event;

  // ── Mode Access ──

  getMode(): ChatMode {
    return this._currentMode;
  }

  setMode(mode: ChatMode): void {
    if (this._currentMode === mode) {
      return;
    }
    this._currentMode = mode;
    this._onDidChangeMode.fire(mode);
  }

  getAvailableModes(): readonly ChatMode[] {
    return ALL_MODES;
  }
}
