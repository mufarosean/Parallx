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
    allow: ['search_knowledge', 'list_files', 'read_file'],
    deny: ['write_file', 'edit_file', 'delete_file', 'run_command'],
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

    // Step 2: Permission filter (Parallx M11: 3-tier)
    // Never-allowed tools are always excluded
    if (params.permissions?.[tool.name] === 'never-allowed') {
      return false;
    }

    return true;
  });
}

/**
 * Resolve the tool profile from a chat mode.
 *
 * Maps Parallx chat modes to tool profiles.
 */
export function resolveToolProfile(mode: string | undefined): OpenclawToolProfile {
  // M41 Phase 9: All modes get full tool access. Approval gates
  // on write tools are the real safety boundary, not mode-based
  // tool denial.
  switch (mode) {
    case 'edit':
      return 'standard'; // Edit mode: read-only tools only
    default:
      return 'full';     // Ask + Agent: full tools with approval gates
  }
}
