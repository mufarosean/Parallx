/**
 * Shared runtime type contracts used by both the built-in chat runtime ("claw")
 * and the OpenClaw runtime. Extracted from duplicated definitions in
 * `src/openclaw/openclawTypes.ts` and `src/built-in/chat/chatTypes.ts` to
 * provide a single source of truth.
 *
 * Neither runtime should define these types locally — import from here.
 */

import type {
  ICancellationToken,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  IToolResult,
  ToolPermissionLevel,
} from './chatTypes.js';
import type { AgentApprovalRequest, AgentTaskDiagnostics, AgentTaskRecord } from '../agent/agentTypes.js';

// ---------------------------------------------------------------------------
// Runtime state unions
// ---------------------------------------------------------------------------

export type ChatRuntimeKind = 'claw' | 'openclaw';
export type ChatRuntimeRunState = 'prepared' | 'executing' | 'awaiting-approval' | 'completed' | 'aborted' | 'failed';
export type ChatRuntimeApprovalState = 'not-required' | 'pending' | 'approved' | 'denied' | 'auto-approved';

// ---------------------------------------------------------------------------
// Canvas/workspace data shapes
// ---------------------------------------------------------------------------

export interface IPageSummary {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

export interface IBlockSummary {
  readonly id: string;
  readonly blockType: string;
  readonly parentBlockId: string | null;
  readonly sortOrder: number;
  readonly textPreview: string;
}

export interface IPageStructure {
  readonly pageId: string;
  readonly title: string;
  readonly icon?: string;
  readonly blocks: readonly IBlockSummary[];
}

// ---------------------------------------------------------------------------
// Bootstrap / system prompt debug types
// ---------------------------------------------------------------------------

export interface IOpenclawBootstrapDebugFile {
  readonly name: string;
  readonly path: string;
  readonly missing: boolean;
  readonly rawChars: number;
  readonly injectedChars: number;
  readonly truncated: boolean;
  readonly causes: readonly ('per-file-limit' | 'total-limit')[];
}

export interface IOpenclawBootstrapDebugReport {
  readonly maxChars: number;
  readonly totalMaxChars: number;
  readonly totalRawChars: number;
  readonly totalInjectedChars: number;
  readonly files: readonly IOpenclawBootstrapDebugFile[];
  readonly warningLines: readonly string[];
}

export interface IOpenclawSkillPromptEntry {
  readonly name: string;
  readonly location: string;
  readonly blockChars: number;
}

export interface IOpenclawSkillCatalogReportEntry {
  readonly name: string;
  readonly kind: string;
  readonly location?: string;
  readonly modelVisible: boolean;
  readonly modelVisibilityReason: 'workflow-visible' | 'model-invocation-disabled' | 'non-workflow';
}

export type IOpenclawToolFilterReason =
  | 'tool-profile-deny'
  | 'tool-profile-not-allowed'
  | 'permission-never-allowed'
  | 'name-collision';

export interface IOpenclawToolPromptEntry {
  readonly name: string;
  readonly summaryChars: number;
  readonly schemaChars: number;
  readonly propertiesCount?: number;
}

export interface IOpenclawToolCapabilityReportEntry extends IOpenclawToolPromptEntry {
  readonly source: 'platform' | 'skill';
  readonly skillLocation?: string;
  readonly exposed: boolean;
  readonly available: boolean;
  readonly filteredReason?: IOpenclawToolFilterReason;
}

export interface IOpenclawSystemPromptReport {
  readonly source: 'run' | 'estimate';
  readonly generatedAt: number;
  readonly workspaceName?: string;
  readonly promptText?: string;
  readonly bootstrapMaxChars: number;
  readonly bootstrapTotalMaxChars: number;
  readonly systemPrompt: {
    readonly chars: number;
    readonly projectContextChars: number;
    readonly nonProjectContextChars: number;
  };
  readonly injectedWorkspaceFiles: readonly IOpenclawBootstrapDebugFile[];
  readonly bootstrapWarningLines: readonly string[];
  readonly skills: {
    readonly promptChars: number;
    readonly totalCount: number;
    readonly visibleCount: number;
    readonly hiddenCount: number;
    readonly entries: readonly IOpenclawSkillPromptEntry[];
    readonly catalog: readonly IOpenclawSkillCatalogReportEntry[];
  };
  readonly tools: {
    readonly listChars: number;
    readonly schemaChars: number;
    readonly totalCount: number;
    readonly availableCount: number;
    readonly filteredCount: number;
    readonly skillDerivedCount: number;
    readonly entries: readonly IOpenclawToolCapabilityReportEntry[];
  };
  readonly promptProvenance?: {
    readonly rawUserInput: string;
    readonly parsedUserText: string;
    readonly contextQueryText: string;
    readonly participantId?: string;
    readonly command?: string;
    readonly attachmentCount: number;
    readonly historyTurns: number;
    readonly seedMessageCount: number;
    readonly modelMessageCount: number;
    readonly modelMessageRoles: readonly string[];
    readonly finalUserMessage: string;
  };
}

// ---------------------------------------------------------------------------
// Runtime tool metadata
// ---------------------------------------------------------------------------

export interface IChatRuntimeToolMetadata {
  readonly name: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly enabled: boolean;
  readonly requiresApproval: boolean;
  readonly autoApproved: boolean;
  readonly approvalSource: 'default' | 'session' | 'persistent' | 'global-auto' | 'strictness' | 'missing-permission-service';
  readonly source?: 'built-in' | 'bridge';
  readonly ownerToolId?: string;
  readonly description?: string;
}

export interface IChatRuntimeToolInvocationObserver {
  onValidated?(metadata: IChatRuntimeToolMetadata): void;
  onApprovalRequested?(metadata: IChatRuntimeToolMetadata): void;
  onApprovalResolved?(metadata: IChatRuntimeToolMetadata, approved: boolean): void;
  onExecuted?(metadata: IChatRuntimeToolMetadata, result: IToolResult): void;
}

// ---------------------------------------------------------------------------
// Memory / lifecycle
// ---------------------------------------------------------------------------

export interface IChatRuntimeMemoryCheckpoint {
  readonly checkpoint: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export interface IChatSlashCommand {
  readonly name: string;
  readonly description: string;
  readonly promptTemplate: string;
  readonly isBuiltIn: boolean;
  readonly specialHandler?: string;
}

export interface IParsedSlashCommand {
  readonly command: IChatSlashCommand | undefined;
  readonly commandName: string | undefined;
  readonly remainingText: string;
}

// ---------------------------------------------------------------------------
// Autonomy mirror
// ---------------------------------------------------------------------------

export interface IChatRuntimeAutonomyMirror {
  readonly taskId: string;
  begin(): Promise<void>;
  createToolObserver(
    toolName: string,
    args: Record<string, unknown>,
    downstream?: IChatRuntimeToolInvocationObserver,
  ): IChatRuntimeToolInvocationObserver;
  complete(note?: string): Promise<void>;
  fail(note?: string): Promise<void>;
  abort(note?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Runtime interface
// ---------------------------------------------------------------------------

export interface IChatParticipantRuntime {
  readonly kind: ChatRuntimeKind;
  handleTurn(
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult>;
}

// ---------------------------------------------------------------------------
// Agent task view model
// ---------------------------------------------------------------------------

export interface IChatAgentTaskViewModel {
  readonly task: AgentTaskRecord;
  readonly diagnostics?: AgentTaskDiagnostics;
  readonly pendingApprovals: readonly AgentApprovalRequest[];
}
