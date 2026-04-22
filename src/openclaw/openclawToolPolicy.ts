/**
 * Tool policy pipeline for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - tool-policy-pipeline.ts:44-154 — applyToolPolicyPipeline multi-step filtering
 *   - tool-policy-shared.ts:0-49 — profiles: minimal | coding | messaging | full
 *   - tool-policy-match.ts:0-44 — isToolAllowedByPolicyName: deny-first, allow-second
 *
 * Parallx adaptation:
 *   - Upstream profiles (minimal/coding/messaging/full) mapped to Parallx modes
 *   - M11 3-tier permissions: always-allowed / requires-approval / never-allowed
 *   - Tools filtered BEFORE reaching the model, not after (upstream pattern)
 */

import type { IToolDefinition, ToolPermissionLevel } from '../services/chatTypes.js';
import type { IAgentToolsConfig } from './agents/openclawAgentConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Tool profile determines the base set of allowed tools.
 *
 * Maps upstream profiles (minimal/coding/messaging/full) to Parallx modes:
 *   readonly  → restricted read-only tools (maps to upstream 'minimal')
 *   standard  → all except dangerous tools (maps to upstream 'coding')
 *   full      → everything allowed (maps to upstream 'full')
 */
export type OpenclawToolProfile = 'readonly' | 'standard' | 'full';

/**
 * Per-tool permission overrides from M11 3-tier permissions.
 * Maps tool name → permission level.
 */
export type IToolPermissions = Record<string, ToolPermissionLevel>;

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

/**
 * Profile-based tool policy.
 *
 * Upstream: resolveToolProfilePolicy from tool-policy-shared.ts
 *
 * - deny list is checked first (deny-first pattern from tool-policy-match.ts)
 * - allow list with '*' means "allow everything not denied"
 */
const TOOL_PROFILES: Record<OpenclawToolProfile, {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}> = {
  readonly: {
    allow: ['*'],
    deny: ['write_file', 'edit_file', 'delete_file', 'run_command', 'create_page'],
  },
  standard: {
    allow: ['*'],
    deny: ['run_command'],
  },
  full: {
    allow: ['*'],
    deny: [],
  },
};

// ---------------------------------------------------------------------------
// Policy pipeline
// ---------------------------------------------------------------------------

/**
 * Check whether a tool name appears on the deny list for a given profile.
 */
export function isToolDeniedByProfile(toolName: string, mode: OpenclawToolProfile): boolean {
  return TOOL_PROFILES[mode].deny.includes(toolName);
}

/**
 * Filter tools through the policy pipeline.
 *
 * Upstream pattern: applyToolPolicyPipeline (tool-policy-pipeline.ts:44-154)
 * applies a sequence of ToolPolicyPipelineStep functions.
 *
 * Parallx simplified pipeline:
 *   Step 1: Profile filter (deny-first, then allow)
 *   Step 2: Permission filter (M11 3-tier: never-allowed tools removed)
 *
 * Tools that require approval are NOT removed — the approval gate is
 * handled by the caller (invokeToolWithRuntimeControl). This function
 * only removes tools the model should never see.
 */
export function applyOpenclawToolPolicy(params: {
  tools: readonly IToolDefinition[];
  mode: OpenclawToolProfile;
  permissions?: IToolPermissions;
  agentTools?: IAgentToolsConfig;
}): IToolDefinition[] {
  const profile = TOOL_PROFILES[params.mode];

  return params.tools.filter(tool => {
    // Step 1: Profile filter (upstream: resolveToolProfilePolicy)
    // Deny-first: if tool is on deny list, exclude it
    if (profile.deny.includes(tool.name)) {
      return false;
    }
    // Allow: if not wildcard, tool must be on allow list
    if (!profile.allow.includes('*') && !profile.allow.includes(tool.name)) {
      return false;
    }

    // Step 1b: D8 Agent tool policy (per-agent allow/deny)
    if (params.agentTools) {
      // Deny-first for agent tools
      if (params.agentTools.deny?.includes(tool.name)) {
        return false;
      }
      // If agent has an explicit allow list, tool must be on it
      if (params.agentTools.allow && params.agentTools.allow.length > 0 && !params.agentTools.allow.includes(tool.name)) {
        return false;
      }
    }

    // Step 2: Permission filter (Parallx M11: 3-tier)
    // Never-allowed tools are always excluded
    if (params.permissions?.[tool.name] === 'never-allowed') {
      return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Surface routing approval policy (M58 W6)
// ---------------------------------------------------------------------------

/**
 * Surfaces that require user approval before an agent can write to them.
 *
 * Upstream parity: channel outbound-policy inspection (github.com/openclaw/openclaw
 * src/channels/) — persistent / user-destructive channels are gated.
 *
 * Parallx posture (M58):
 *   - filesystem, canvas → persistence risk → approval required
 *   - chat, notifications, status → ephemeral / user-visible only → free
 *
 * NOTE for M58: the `surface_send` tool is shipped with uniform
 * `requires-approval` at the tool level, so every send is approved today.
 * This helper is consumed by the tool handler to surface per-surface
 * metadata (`approvalRequiredForSurface`) and by `surface_list` for
 * introspection, and is the hook W2+ AI settings will loosen.
 */
const APPROVAL_REQUIRED_SURFACES: ReadonlySet<string> = new Set([
  'filesystem',
  'canvas',
]);

/**
 * Whether a `surface_send` targeting the given surface id requires approval
 * under the default M58 policy.
 */
export function surfaceSendRequiresApproval(surfaceId: string): boolean {
  return APPROVAL_REQUIRED_SURFACES.has(surfaceId);
}

// ---------------------------------------------------------------------------
// Cron tool approval policy (M58 W4)
// ---------------------------------------------------------------------------

/**
 * Cron tool actions that mutate scheduler state and therefore require user
 * approval before the agent can invoke them.
 *
 * Upstream parity: cron-tool.ts gates create/update/delete actions behind
 * user confirmation in the OpenClaw reply orchestration (write actions are
 * never auto-approved). Read-only (status/list/runs) and user-initiated
 * (run/wake) actions are free.
 *
 * Parallx posture (M58 W4):
 *   - cron_add / cron_update / cron_remove → schedule mutation → approval
 *   - cron_status / cron_list / cron_runs / cron_run / cron_wake → free
 *     - status/list/runs are pure reads
 *     - run/wake are user-initiated triggers that can only act on jobs the
 *       user already approved into existence via cron_add
 */
const APPROVAL_REQUIRED_CRON_ACTIONS: ReadonlySet<string> = new Set([
  'cron_add',
  'cron_update',
  'cron_remove',
]);

/**
 * Whether the given cron tool name requires user approval under the default
 * M58 policy. Unknown tool names return `false` (caller controls the
 * registry; unregistered cron names aren't reachable).
 */
export function cronToolRequiresApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_CRON_ACTIONS.has(toolName);
}

/**
 * Resolve the default permission level for a cron tool.
 * Centralised so both `cronTools.ts` (registration) and introspection
 * surfaces use the same source of truth.
 */
export function cronToolPermissionLevel(toolName: string): ToolPermissionLevel {
  return cronToolRequiresApproval(toolName) ? 'requires-approval' : 'always-allowed';
}

/**
 * Resolve the tool profile from a chat mode.
 *
 * Maps Parallx chat modes to tool profiles.
 */
export function resolveToolProfile(mode: string | undefined): OpenclawToolProfile {
  // M41 Phase 9: Most modes get full tool access. Edit mode uses standard
  // profile (no command execution). Approval gates on write tools are the
  // real safety boundary, not mode-based tool denial.
  switch (mode) {
    case 'edit':
      return 'standard'; // Edit mode: standard tools (no command execution)
    default:
      return 'full';     // Ask + Agent: full tools with approval gates
  }
}
