// chatModeCapabilities.ts — Mode capability matrix (M9 Task 4.1)
//
// Defines what each chat mode can do at the service level.
// Enforcement happens in the request-building phase — even programmatic
// requests respect mode boundaries.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatModes.ts — ChatModeKind enum,
//   src/vs/workbench/contrib/chat/common/chatAgents.ts — mode checked in invokeAgent()

import { ChatMode } from '../../../services/chatTypes.js';
import type { IChatModeCapabilities } from '../chatTypes.js';

// IChatModeCapabilities — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatModeCapabilities } from '../chatTypes.js';

/**
 * Frozen capability objects — one per mode.
 *
 * M44: Ask mode removed. Only Edit and Agent remain.
 * Edit gets read-only tools so it can look up context.
 *
 *   | Capability            | Edit | Agent |
 *   |-----------------------|------|-------|
 *   | Read context          | ✅   | ✅    |
 *   | Invoke tools          | ✅🔒 | ✅    |
 *   | Propose edits         | ✅   | ✅    |
 *   | Autonomous multi-step | ❌   | ✅    |
 *
 *   🔒 = read-only tools only (no write/delete/run_command)
 */
const MODE_CAPABILITIES: Readonly<Record<ChatMode, IChatModeCapabilities>> = Object.freeze({
  [ChatMode.Edit]: Object.freeze({
    canReadContext: true,
    canInvokeTools: true,   // read-only tools for context lookup
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
 * Falls back to Agent capabilities for unknown/legacy modes (e.g. persisted 'ask' sessions).
 */
export function getModeCapabilities(mode: ChatMode): IChatModeCapabilities {
  return MODE_CAPABILITIES[mode] ?? MODE_CAPABILITIES[ChatMode.Agent];
}

/**
 * Should tool definitions be included in the Ollama request for this mode?
 */
export function shouldIncludeTools(mode: ChatMode): boolean {
  return (MODE_CAPABILITIES[mode] ?? MODE_CAPABILITIES[ChatMode.Agent]).canInvokeTools;
}

/**
 * Should the request use JSON structured output format (edit proposals)?
 *
 * M41 Phase 9: Only Edit mode uses structured JSON output.
 * Ask and Agent use free-form text + tools.
 */
export function shouldUseStructuredOutput(mode: ChatMode): boolean {
  return mode === ChatMode.Edit;
}
