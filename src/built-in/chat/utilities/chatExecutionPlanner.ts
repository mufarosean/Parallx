/**
 * M38 Execution Planner — builds a typed execution plan from route + scope.
 *
 * Each workflow type maps to an ordered sequence of execution steps.  The
 * planner does not execute anything — it only produces the plan that the
 * evidence gatherer (Phase 3) will consume.
 */

import type {
  IChatTurnRoute,
  IExecutionPlan,
  IExecutionStep,
  IOutputConstraints,
  IQueryScope,
  WorkflowType,
} from '../chatTypes.js';

/**
 * Build a typed execution plan from the routing decision and resolved scope.
 *
 * For `generic-grounded` queries, the plan wraps the existing IChatContextPlan
 * behavior — no behavioral change for simple RAG queries.
 */
export function buildExecutionPlan(
  route: IChatTurnRoute,
  scope: IQueryScope,
): IExecutionPlan {
  const workflowType = route.workflowType ?? 'generic-grounded';
  const targetPaths = scope.pathPrefixes ? [...scope.pathPrefixes] : undefined;

  const steps = buildSteps(workflowType, targetPaths);
  const outputConstraints = buildOutputConstraints(workflowType);

  return {
    workflowType,
    steps,
    outputConstraints,
    scope,
  };
}

function buildSteps(
  workflowType: WorkflowType,
  targetPaths?: string[],
): IExecutionStep[] {
  switch (workflowType) {
    case 'generic-grounded':
      // Equivalent to the existing IChatContextPlan grounded path:
      // useRetrieval: true, citationMode: 'required', single retrieval pass.
      // No behavioral change for standard RAG queries (Task 2.4 contract).
      return [
        { kind: 'scoped-retrieve', label: 'Retrieve relevant context' },
        { kind: 'synthesize', label: 'Generate grounded response' },
      ];

    case 'scoped-topic':
      return [
        { kind: 'scoped-retrieve', label: 'Retrieve within resolved scope', targetPaths },
        { kind: 'synthesize', label: 'Synthesize scoped answer' },
      ];

    case 'folder-summary':
      return [
        { kind: 'enumerate', label: 'List files in scope', targetPaths },
        { kind: 'scoped-retrieve', label: 'Retrieve from each enumerated source', targetPaths },
        { kind: 'synthesize', label: 'Synthesize folder summary' },
      ];

    case 'document-summary':
      return [
        { kind: 'deterministic-read', label: 'Read target document', targetPaths },
        { kind: 'synthesize', label: 'Synthesize document summary' },
      ];

    case 'comparative':
      return [
        { kind: 'deterministic-read', label: 'Read first entity', targetPaths: targetPaths?.slice(0, 1) },
        { kind: 'deterministic-read', label: 'Read second entity', targetPaths: targetPaths?.slice(1, 2) },
        { kind: 'synthesize', label: 'Synthesize comparison' },
      ];

    case 'exhaustive-extraction':
      return [
        { kind: 'enumerate', label: 'Enumerate all scope contents', targetPaths },
        { kind: 'deterministic-read', label: 'Read every enumerated source', targetPaths },
        { kind: 'synthesize', label: 'Synthesize exhaustive extraction' },
      ];

    case 'mixed':
      return [
        { kind: 'structural-inspect', label: 'Inspect structural layout', targetPaths },
        { kind: 'scoped-retrieve', label: 'Retrieve semantic context', targetPaths },
        { kind: 'synthesize', label: 'Synthesize mixed-cue response' },
      ];
  }
}

function buildOutputConstraints(workflowType: WorkflowType): IOutputConstraints {
  switch (workflowType) {
    case 'comparative':
      return { format: 'table' };
    case 'exhaustive-extraction':
      return { format: 'list', requireExhaustiveCitation: true };
    case 'folder-summary':
      return { format: 'list', requireExhaustiveCitation: true };
    case 'document-summary':
      return { format: 'prose' };
    default:
      return {};
  }
}
