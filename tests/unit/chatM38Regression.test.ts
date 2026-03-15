// M38 Task 6.2 + 6.3 — Regression + scope resolution accuracy tests
//
// 6.2: Verify no regression for ordinary grounded Q&A (task class A).
// 6.3: Test scope resolution accuracy with demo workspace entities.

import { describe, it, expect, vi } from 'vitest';
import { resolveQueryScope } from '../../src/built-in/chat/utilities/chatScopeResolver';
import { buildExecutionPlan } from '../../src/built-in/chat/utilities/chatExecutionPlanner';
import type { IChatTurnRoute } from '../../src/built-in/chat/chatTypes';

// ── 6.3: Scope resolution accuracy with demo workspace files ───────────────

describe('M38 scope resolution — demo workspace entities', () => {
  // Simulated demo workspace root directory listing
  const demoWorkspaceEntries = [
    { name: 'Claims Guide.md', type: 'file' as const },
    { name: 'Agent Contacts.md', type: 'file' as const },
    { name: 'Auto Insurance Policy.md', type: 'file' as const },
    { name: 'Vehicle Info.md', type: 'file' as const },
    { name: 'Accident Quick Reference.md', type: 'file' as const },
    { name: 'Claims Workflow Architecture.md', type: 'file' as const },
  ];

  const deps = {
    listFilesRelative: vi.fn().mockResolvedValue(demoWorkspaceEntries),
  };

  const emptyMentions = { folders: [] as string[], files: [] as string[] };

  it('resolves "Claims Guide" entity from natural query', async () => {
    const scope = await resolveQueryScope(
      'What does the Claims Guide say about filing deadlines?',
      emptyMentions, deps,
    );
    expect(scope.level).toBe('document');
    expect(scope.pathPrefixes).toContain('Claims Guide.md');
    expect(scope.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('resolves "Vehicle Info" without extension', async () => {
    const scope = await resolveQueryScope(
      'Tell me about the Vehicle Info',
      emptyMentions, deps,
    );
    expect(scope.pathPrefixes).toContain('Vehicle Info.md');
  });

  it('resolves "Auto Insurance Policy" for policy questions', async () => {
    const scope = await resolveQueryScope(
      'Explain the Auto Insurance Policy deductibles',
      emptyMentions, deps,
    );
    expect(scope.pathPrefixes).toContain('Auto Insurance Policy.md');
  });

  it('resolves comparison queries to both files', async () => {
    const scope = await resolveQueryScope(
      'Compare Claims Guide and Accident Quick Reference',
      emptyMentions, deps,
    );
    expect(scope.pathPrefixes).toContain('Claims Guide.md');
    expect(scope.pathPrefixes).toContain('Accident Quick Reference.md');
  });

  it('falls back to workspace level for generic questions', async () => {
    const scope = await resolveQueryScope(
      'How do I file a claim?',
      emptyMentions, deps,
    );
    expect(scope.level).toBe('workspace');
    expect(scope.confidence).toBeLessThanOrEqual(0.5);
  });

  it('resolves "Agent Contacts" for contact queries', async () => {
    const scope = await resolveQueryScope(
      'Read the Agent Contacts file for Sarah Chen phone number',
      emptyMentions, deps,
    );
    expect(scope.pathPrefixes).toContain('Agent Contacts.md');
  });
});

// ── 6.2: Regression — generic grounded Q&A unchanged ───────────────────────

describe('M38 regression — generic grounded Q&A (task class A)', () => {
  function makeGroundedRoute(): IChatTurnRoute {
    return {
      route: 'grounded',
      intent: 'question',
      reasoning: 'test',
    };
  }

  it('buildExecutionPlan returns generic-grounded for untyped grounded route', async () => {
    const route = makeGroundedRoute();
    const scope = await resolveQueryScope('How do I file a claim?', { folders: [], files: [] }, {});
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('generic-grounded');
    expect(plan.steps.map(s => s.kind)).toEqual(['scoped-retrieve', 'synthesize']);
  });

  it('generic-grounded plan has no special output constraints', async () => {
    const route = makeGroundedRoute();
    const scope = await resolveQueryScope('What is my deductible?', { folders: [], files: [] }, {});
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('generic-grounded');
    expect(plan.outputConstraints.format).toBeUndefined();
    expect(plan.outputConstraints.requireExhaustiveCitation).toBeUndefined();
  });

  it('conversational route skips M38 pipeline entirely', async () => {
    const route: IChatTurnRoute = {
      route: 'conversational',
      intent: 'conversational',
      reasoning: 'test',
    };
    const scope = await resolveQueryScope('Hello!', { folders: [], files: [] }, {});
    const plan = buildExecutionPlan(route, scope);

    // Non-grounded routes get generic-grounded (no-op)
    expect(plan.workflowType).toBe('generic-grounded');
  });

  it('generic-grounded scoped-retrieve step has no targetPaths', async () => {
    const route = makeGroundedRoute();
    const scope = await resolveQueryScope('How do I file a claim?', { folders: [], files: [] }, {});
    const plan = buildExecutionPlan(route, scope);

    const retrieveStep = plan.steps.find(s => s.kind === 'scoped-retrieve');
    expect(retrieveStep).toBeDefined();
    expect(retrieveStep!.targetPaths).toBeUndefined();
  });
});
