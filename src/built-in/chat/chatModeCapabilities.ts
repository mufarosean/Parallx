// chatModeCapabilities.ts — Mode capability matrix (M9 Task 4.1)
//
// Defines what each chat mode can do at the service level.
// Enforcement happens in the request-building phase — even programmatic
// requests respect mode boundaries.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatModes.ts — ChatModeKind enum,
//   src/vs/workbench/contrib/chat/common/chatAgents.ts — mode checked in invokeAgent()

import { ChatMode } from '../../services/chatTypes.js';

// ── Capability Matrix ──

/**
 * Per-mode capability flags.
 *
 * Used by participants and the request pipeline to gate features.
 */
export interface IChatModeCapabilities {
  /** Can the mode read workspace/canvas context? (All modes can.) */
  readonly canReadContext: boolean;
  /** Can the mode invoke tools via the agentic loop? */
  readonly canInvokeTools: boolean;
  /** Can the mode propose edits to canvas blocks? */
  readonly canProposeEdits: boolean;
  /** Can the mode run autonomous multi-step reasoning? */
  readonly canAutonomous: boolean;
}

/**
 * Frozen capability objects — one per mode.
 *
 *   | Capability            | Ask | Edit | Agent |
 *   |-----------------------|-----|------|-------|
 *   | Read context          | ✅  | ✅   | ✅    |
 *   | Invoke tools          | ❌  | ❌   | ✅    |
 *   | Propose edits         | ❌  | ✅   | ✅    |
 *   | Autonomous multi-step | ❌  | ❌   | ✅    |
 */
const MODE_CAPABILITIES: Readonly<Record<ChatMode, IChatModeCapabilities>> = Object.freeze({
  [ChatMode.Ask]: Object.freeze({
    canReadContext: true,
    canInvokeTools: false,
    canProposeEdits: false,
    canAutonomous: false,
  }),
  [ChatMode.Edit]: Object.freeze({
    canReadContext: true,
    canInvokeTools: false,
    canProposeEdits: true,
    canAutonomous: false,
  }),
  [ChatMode.Agent]: Object.freeze({
    canReadContext: true,
    canInvokeTools: true,
    canProposeEdits: true,
    canAutonomous: true,
  }),
});

/**
 * Look up the capability flags for a given chat mode.
 */
export function getModeCapabilities(mode: ChatMode): IChatModeCapabilities {
  return MODE_CAPABILITIES[mode];
}

/**
 * Should tool definitions be included in the Ollama request for this mode?
 */
export function shouldIncludeTools(mode: ChatMode): boolean {
  return MODE_CAPABILITIES[mode].canInvokeTools;
}

/**
 * Should the request use JSON structured output format (edit proposals)?
 */
export function shouldUseStructuredOutput(mode: ChatMode): boolean {
  return MODE_CAPABILITIES[mode].canProposeEdits && !MODE_CAPABILITIES[mode].canAutonomous;
  // Edit mode = structured output; Agent mode = tools + free-form
}
