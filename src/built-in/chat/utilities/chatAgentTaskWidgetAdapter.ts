import type { IChatWidgetServices } from '../chatTypes.js';
import type {
  IAgentApprovalService,
  IAgentExecutionService,
  IAgentSessionService,
  IAgentTraceService,
} from '../../../services/serviceTypes.js';

export interface IChatAgentTaskWidgetAdapterDeps {
  readonly agentSessionService?: IAgentSessionService;
  readonly agentApprovalService?: IAgentApprovalService;
  readonly agentExecutionService?: IAgentExecutionService;
  readonly agentTraceService?: IAgentTraceService;
}

export function buildChatAgentTaskWidgetServices(
  deps: IChatAgentTaskWidgetAdapterDeps,
): Pick<
  IChatWidgetServices,
  'getAgentTasks'
  | 'resolveAgentApproval'
  | 'continueAgentTask'
  | 'stopAgentTaskAfterStep'
  | 'onDidChangeAgentTasks'
  | 'onDidChangeAgentApprovals'
> {
  return {
    getAgentTasks: deps.agentSessionService
      ? () => {
        const tasks = deps.agentSessionService!.listActiveWorkspaceTasks();
        return [...tasks]
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((task) => ({
            task,
            diagnostics: deps.agentTraceService?.getTaskDiagnostics(task.id),
            pendingApprovals: deps.agentApprovalService?.listApprovalRequestsForTask(task.id)
              .filter((request) => request.status === 'pending') ?? [],
          }));
      }
      : undefined,
    resolveAgentApproval: (deps.agentSessionService && deps.agentExecutionService)
      ? async (taskId, requestId, resolution) => {
        const task = await deps.agentSessionService!.resolveTaskApproval(taskId, requestId, resolution);
        if (resolution === 'approve-once' || resolution === 'approve-for-task' || task.status === 'planning') {
          await deps.agentExecutionService!.runTask(taskId);
        }
      }
      : undefined,
    continueAgentTask: (deps.agentSessionService && deps.agentExecutionService)
      ? async (taskId) => {
        await deps.agentSessionService!.continueTask(taskId);
        await deps.agentExecutionService!.runTask(taskId);
      }
      : undefined,
    stopAgentTaskAfterStep: deps.agentSessionService
      ? async (taskId) => {
        await deps.agentSessionService!.requestStopAfterCurrentStep(taskId);
      }
      : undefined,
    onDidChangeAgentTasks: deps.agentSessionService?.onDidChangeTasks,
    onDidChangeAgentApprovals: deps.agentApprovalService?.onDidChangeApprovalRequests,
  };
}