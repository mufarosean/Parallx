import { Disposable } from '../platform/lifecycle.js';
import type {
  AgentActionClass,
  AgentBoundaryDecision,
  AgentInteractionMode,
  AgentPolicyDecision,
  AgentProposedAction,
} from '../agent/agentTypes.js';
import type { IAgentPolicyService, IWorkspaceBoundaryService } from './serviceTypes.js';

const READ_TOOLS = ['read', 'list', 'schema', 'cell', 'rows', 'output'];
const SEARCH_TOOLS = ['search', 'grep', 'semantic', 'retrieval', 'usage'];
const EDIT_TOOLS = ['apply_patch', 'edit_file', 'rename'];
const WRITE_TOOLS = ['create_file', 'write_file', 'insert', 'replace'];
const DELETE_TOOLS = ['delete'];
const COMMAND_TOOLS = ['terminal', 'command', 'task'];

export class AgentPolicyService extends Disposable implements IAgentPolicyService {
  constructor(
    private readonly _workspaceBoundaryService: IWorkspaceBoundaryService,
  ) {
    super();
  }

  classifyAction(action: AgentProposedAction): AgentActionClass {
    if (action.actionClass && action.actionClass !== 'unknown') {
      return action.actionClass;
    }

    const toolName = action.toolName?.toLowerCase() ?? '';
    if (!toolName) {
      return 'unknown';
    }

    if (DELETE_TOOLS.some((token) => toolName.includes(token))) {
      return 'delete';
    }

    if (EDIT_TOOLS.some((token) => toolName.includes(token))) {
      return 'edit';
    }

    if (WRITE_TOOLS.some((token) => toolName.includes(token))) {
      return 'write';
    }

    if (COMMAND_TOOLS.some((token) => toolName.includes(token))) {
      return 'command';
    }

    if (SEARCH_TOOLS.some((token) => toolName.includes(token))) {
      return 'search';
    }

    if (READ_TOOLS.some((token) => toolName.includes(token))) {
      return 'read';
    }

    return 'unknown';
  }

  evaluateAction(action: AgentProposedAction): AgentPolicyDecision {
    const actionClass = this.classifyAction(action);
    const boundaryDecisions = (action.targetUris ?? []).map((uri) => this._evaluateBoundary(uri));
    const blockedBoundary = boundaryDecisions.find((decision) => !decision.allowed);
    if (blockedBoundary) {
      return {
        actionClass,
        policy: 'deny',
        reason: blockedBoundary.reason,
        boundaryDecisions,
      };
    }

    if (actionClass === 'unknown') {
      return {
        actionClass,
        policy: 'deny',
        reason: `Unsupported or unregistered agent action${action.toolName ? `: ${action.toolName}` : ''}.`,
        boundaryDecisions,
      };
    }

    if (this._modeDeniesAction(action.interactionMode, actionClass)) {
      return {
        actionClass,
        policy: 'deny',
        reason: `Interaction mode "${action.interactionMode}" does not allow ${actionClass} actions by default.`,
        boundaryDecisions,
      };
    }

    return {
      actionClass,
      policy: this._defaultPolicyForActionClass(actionClass),
      reason: this._reasonForPolicy(actionClass),
      boundaryDecisions,
    };
  }

  private _evaluateBoundary(uri: import('../platform/uri.js').URI): AgentBoundaryDecision {
    if (uri.scheme !== 'file') {
      return {
        allowed: false,
        reason: `Agent action targets a non-file URI and is outside the workspace contract: ${uri.toString()}`,
        violationType: 'non-file-uri',
      };
    }

    const folders = this._workspaceBoundaryService.folders;
    if (folders.length === 0) {
      return {
        allowed: false,
        reason: 'Agent action targets the filesystem but no workspace folders are open.',
        normalizedPath: uri.fsPath,
        violationType: 'no-workspace',
      };
    }

    const containingFolder = folders.find((folder) => this._workspaceBoundaryService.isUriWithinWorkspace(uri) && (
      uri.path.toLowerCase() === folder.uri.path.toLowerCase() ||
      uri.path.toLowerCase().startsWith(folder.uri.path.toLowerCase() + '/')
    ));

    if (!containingFolder) {
      return {
        allowed: false,
        reason: `Agent action targets a path outside the active workspace: ${uri.fsPath}`,
        normalizedPath: uri.fsPath,
        violationType: 'outside-workspace',
      };
    }

    return {
      allowed: true,
      reason: 'Target path is inside the active workspace.',
      normalizedPath: uri.fsPath,
      workspaceRoot: containingFolder.uri.fsPath,
    };
  }

  private _defaultPolicyForActionClass(actionClass: AgentActionClass): 'allow' | 'require-approval' {
    switch (actionClass) {
      case 'read':
      case 'search':
      case 'task-state':
        return 'allow';
      case 'write':
      case 'edit':
      case 'delete':
      case 'command':
      case 'approval-sensitive':
        return 'require-approval';
      default:
        return 'require-approval';
    }
  }

  private _reasonForPolicy(actionClass: AgentActionClass): string {
    switch (actionClass) {
      case 'read':
        return 'Workspace reads are allowed inside the active workspace boundary.';
      case 'search':
        return 'Workspace search and analysis actions are allowed inside the active workspace boundary.';
      case 'task-state':
        return 'Task-state actions are internal runtime updates and may proceed automatically.';
      case 'write':
      case 'edit':
        return 'Workspace mutations require user approval by default.';
      case 'delete':
        return 'Destructive workspace mutations require user approval by default.';
      case 'command':
        return 'Shell and command execution require user approval by default.';
      case 'approval-sensitive':
        return 'This action class is marked approval-sensitive and requires user approval.';
      default:
        return 'Unsupported actions are denied by default.';
    }
  }

  private _modeDeniesAction(mode: AgentInteractionMode | undefined, actionClass: AgentActionClass): boolean {
    if (!mode) {
      return false;
    }

    if (mode === 'advisor' || mode === 'researcher' || mode === 'reviewer') {
      return actionClass === 'command' || actionClass === 'delete';
    }

    return false;
  }
}