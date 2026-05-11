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
 * Upstream evidence (raw.githubusercontent.com/openclaw/openclaw/main):
 *   - src/agents/tool-policy-shared.ts — resolveToolProfilePolicy:
 *       Profiles `minimal`, `coding`, `messaging`, `full`. Only `full` is
 *       `allow: ["*"]`. The others are explicit allowlists of specific tool
 *       ids — tools default to EXCLUDED unless they appear in the profile
 *       allowlist (or their CoreToolDefinition.profiles[] includes the
 *       profile name).
 *   - src/agents/tool-catalog.ts — CoreToolDefinition.profiles[]:
 *       Per-tool profile membership tags. Tools default to `profiles: []`
 *       (excluded from all profiles except `full`).
 *
 * Parallx implementation (M65 parity fix):
 *   - `readonly`  → upstream `minimal` analogue (read-only browsing).
 *   - `standard`  → upstream `coding` analogue (read + safe writes, no shell).
 *   - `full`      → upstream `full` (allow everything).
 *
 *   Tools may declare `IToolDefinition.profiles` to opt in. Built-in tools
 *   that omit `profiles` are matched against the static allowlist below —
 *   this is the centralised equivalent of upstream's per-tool tags.
 *
 *   For MCP / extension tools without `profiles`, the default is EXCLUDED
 *   from non-`full` profiles (matches upstream `profiles: []` default).
 *
 *   `deny` is preserved as a deny-first override (upstream parity:
 *   tool-policy-match.ts deny-first, allow-second).
 */
const TOOL_PROFILES: Record<OpenclawToolProfile, {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}> = {
  // Read-only browsing. Mirrors upstream `minimal` profile shape — explicit
  // allowlist of safe, side-effect-free tools. No writes, no shell, no
  // schedule mutation, no subagent spawn.
  readonly: {
    allow: [
      // Workspace files (read-only)
      'list_files', 'read_file', 'search_files', 'grep_search',
      // Canvas pages (read-only)
      'find_pages', 'read_page', 'get_page',
      'list_property_definitions', 'read_block',
      // Knowledge & memory & transcripts (read-only)
      'search_knowledge', 'memory_get', 'memory_search',
      'transcript_get', 'transcript_search',
      // Cron & surface (read-only introspection)
      'cron_status', 'cron_list', 'cron_runs', 'surface_list',
      // Autonomy log (read-only)
      'autonomy_log',
    ],
    deny: [],
  },
  // Read + safe writes (no shell, no destructive deletes, no schedule writes,
  // no subagent spawn). Mirrors upstream `coding` profile shape.
  standard: {
    allow: [
      // All of readonly:
      'list_files', 'read_file', 'search_files', 'grep_search',
      'find_pages', 'read_page', 'get_page',
      'list_property_definitions', 'read_block',
      'search_knowledge', 'memory_get', 'memory_search',
      'transcript_get', 'transcript_search',
      'cron_status', 'cron_list', 'cron_runs', 'surface_list',
      'autonomy_log',
      // Safe writes:
      'write_file', 'edit_file',
      'create_page', 'compose_page', 'set_page_property', 'set_page_style',
      'edit_block', 'insert_block_after', 'link_block',
    ],
    deny: [],
  },
  // Allow everything (matches upstream `full` profile).
  full: {
    allow: ['*'],
    deny: [],
  },
};

// ---------------------------------------------------------------------------
// Policy pipeline
// ---------------------------------------------------------------------------

/**
 * Whether a tool name is EXCLUDED by the given profile.
 *
 * Replaces the prior deny-list semantics with allowlist semantics:
 *   - `full` profile never excludes.
 *   - Other profiles exclude when the tool is not on the allow list.
 *
 * Note: this is a name-only check; tools that declare their own
 * `profiles` membership are out of scope here — use `isToolAllowedByProfile`
 * when an `IToolDefinition` is available.
 *
 * Upstream parity: tool-policy-shared.ts — exclusion is the default when
 * a profile is not `full`.
 */
export function isToolDeniedByProfile(toolName: string, mode: OpenclawToolProfile): boolean {
  const profile = TOOL_PROFILES[mode];
  if (profile.deny.includes(toolName)) {
    return true;
  }
  if (profile.allow.includes('*')) {
    return false;
  }
  return !profile.allow.includes(toolName);
}

/**
 * Check tool membership in a profile, including the tool's own
 * `profiles` declaration (upstream parity:
 * tool-catalog.ts CoreToolDefinition.profiles[]).
 *
 * Allow-precedence:
 *   1. Deny list (always excludes).
 *   2. Profile is `full` or static allowlist is `*` → allow.
 *   3. Tool name in static allow list → allow.
 *   4. Tool's own `profiles` array includes the active profile → allow.
 *   5. Otherwise exclude.
 */
function isToolAllowedByProfile(tool: IToolDefinition, mode: OpenclawToolProfile): boolean {
  const profile = TOOL_PROFILES[mode];
  if (profile.deny.includes(tool.name)) {
    return false;
  }
  if (profile.allow.includes('*')) {
    return true;
  }
  if (profile.allow.includes(tool.name)) {
    return true;
  }
  if (tool.profiles && tool.profiles.includes(mode)) {
    return true;
  }
  return false;
}

/**
 * Filter tools through the policy pipeline.
 *
 * Upstream pattern: applyToolPolicyPipeline (tool-policy-pipeline.ts:44-154)
 * applies a sequence of ToolPolicyPipelineStep functions.
 *
 * Parallx pipeline:
 *   Step 1: Profile filter (allowlist + per-tool `profiles[]` + deny-first)
 *   Step 1b: D8 agent tool policy (per-agent allow/deny)
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
  return params.tools.filter(tool => {
    // Step 1: Profile filter
    if (!isToolAllowedByProfile(tool, params.mode)) {
      return false;
    }

    // Step 1b: D8 Agent tool policy (per-agent allow/deny)
    if (params.agentTools) {
      if (params.agentTools.deny?.includes(tool.name)) {
        return false;
      }
      if (params.agentTools.allow && params.agentTools.allow.length > 0 && !params.agentTools.allow.includes(tool.name)) {
        return false;
      }
    }

    // Step 2: Permission filter (Parallx M11: 3-tier)
    if (params.permissions?.[tool.name] === 'never-allowed') {
      return false;
    }

    return true;
  });
}

/**
 * Tier→profile coupling (M65 parity fix, divergence 5).
 *
 * Small models choke on large tool catalogs. Upstream addresses this by
 * letting deployments select a tighter profile (e.g. `coding` instead of
 * `full`). Parallx couples this to the detected model tier so the user
 * does not have to configure it manually.
 *
 * - `small`  → never expose `full`; downgrade to `standard`.
 * - `medium` → pass-through.
 * - `large`  → pass-through.
 *
 * `readonly` is never upgraded — if the caller asked for read-only access,
 * a larger model does not change that intent.
 */
export function applyTierToProfile(
  profile: OpenclawToolProfile,
  tier: 'small' | 'medium' | 'large' | undefined,
): OpenclawToolProfile {
  if (tier === 'small' && profile === 'full') {
    return 'standard';
  }
  return profile;
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

// ---------------------------------------------------------------------------
// Subagent tool approval policy (M58 W5)
// ---------------------------------------------------------------------------

/**
 * The `sessions_spawn` tool (M58 W5) delegates work to an isolated
 * subagent turn that runs a real LLM call against an ephemeral session.
 *
 * **Subagent spawn is ALWAYS approval-gated** — no read-only exemption, no
 * dev-mode bypass, no per-surface loosening (unlike the `surface_send`
 * helper in this file which has a per-surface carve-out map). Spawning a
 * subagent is a privileged action: it consumes model tokens, runs with
 * full tool access inside an isolated session, and returns a result the
 * parent agent will treat as trusted context. The user must approve every
 * spawn.
 *
 * Upstream parity: subagent-spawn.ts + sessions-spawn-tool.ts in
 * github.com/openclaw/openclaw require explicit caller opt-in for each
 * spawn. Parallx enforces this via the M11 3-tier permission system.
 */
export function subagentToolRequiresApproval(_toolName: string): boolean {
  return true;
}

/**
 * Permission level for subagent tools. Always `requires-approval` by
 * design (see `subagentToolRequiresApproval`). Kept as a function to match
 * the shape of `cronToolPermissionLevel` / `surfaceSendRequiresApproval`.
 */
export function subagentToolPermissionLevel(_toolName: string): ToolPermissionLevel {
  return 'requires-approval';
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
