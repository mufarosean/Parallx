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
import type { IChatModeCapabilities } from './chatTypes.js';

// IChatModeCapabilities — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatModeCapabilities } from './chatTypes.js';

/**
 * Frozen capability objects — one per mode.
 *
 *   | Capability            | Ask | Edit | Agent |
 *   |-----------------------|-----|------|-------|
 *   | Read context          | ✅  | ✅   | ✅    |
 *   | Invoke tools          | 🔒  | ❌   | ✅    |
 *   | Propose edits         | ❌  | ✅   | ✅    |
 *   | Autonomous multi-step | ❌  | ❌   | ✅    |
 *
 *   🔒 = read-only tools only (list, read, search — no create/modify)
 */
const MODE_CAPABILITIES: Readonly<Record<ChatMode, IChatModeCapabilities>> = Object.freeze({
  [ChatMode.Ask]: Object.freeze({
    canReadContext: true,
    canInvokeTools: true,   // read-only tools — gated at invocation layer
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
