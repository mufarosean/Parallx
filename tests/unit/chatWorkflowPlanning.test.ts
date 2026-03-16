import { describe, expect, it } from 'vitest';

import { determineChatTurnRoute } from '../../src/built-in/chat/utilities/chatTurnRouter';
import { buildExecutionPlan } from '../../src/built-in/chat/utilities/chatExecutionPlanner';
import type { IQueryScope } from '../../src/built-in/chat/chatTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

function workspaceScope(overrides?: Partial<IQueryScope>): IQueryScope {
  return {
    level: 'workspace',
    derivedFrom: 'contextual',
    confidence: 0.3,
    ...overrides,
  };
}

function folderScope(prefix: string): IQueryScope {
  return {
    level: 'folder',
    pathPrefixes: [prefix],
    derivedFrom: 'explicit-mention',
    confidence: 1.0,
  };
}

function documentScope(docId: string): IQueryScope {
  return {
    level: 'document',
    pathPrefixes: [docId],
    documentIds: [docId],
    derivedFrom: 'explicit-mention',
    confidence: 1.0,
  };
}

// ── Workflow Type Classification (via determineChatTurnRoute) ───────────────

describe('workflow type classification', () => {
  it('classifies plain grounded queries as generic-grounded', () => {
    const route = determineChatTurnRoute('what does my policy cover?');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('generic-grounded');
  });

  it('classifies entity + topic questions as scoped-topic', () => {
    const route = determineChatTurnRoute('What does the Claims Guide say about liability?');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('scoped-topic');
  });

  it('classifies comparison requests as comparative', () => {
    const route = determineChatTurnRoute('compare the deductible amounts in my two plans');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('comparative');
  });

  it('classifies entity + summary verb as document-summary', () => {
    const route = determineChatTurnRoute('Summarize the Auto Insurance Policy');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('document-summary');
  });

  it('classifies entity + summary verb + folder cue as folder-summary', () => {
    const route = determineChatTurnRoute('Describe all the files in the RF Guides folder');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('folder-summary');
  });

  it('classifies exhaustive + extraction verbs as exhaustive-extraction', () => {
    const route = determineChatTurnRoute('Extract every phone number from each file in this folder and list them all.');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('exhaustive-extraction');
    expect(route.coverageMode).toBe('exhaustive');
  });

  it('classifies exhaustive review without extraction verbs as folder-summary', () => {
    const route = determineChatTurnRoute('Summarize each file in this directory in one sentence.');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('folder-summary');
    expect(route.coverageMode).toBe('exhaustive');
  });

  it('classifies natural summary phrasing as exhaustive folder-summary', () => {
    const route = determineChatTurnRoute('Can you provide a one paragraph summary for each of the files in the RF Guides folder?');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('folder-summary');
    expect(route.coverageMode).toBe('exhaustive');
  });

  it('classifies file enumeration as folder-summary with enumeration coverage', () => {
    const route = determineChatTurnRoute('How many files are in the Guides directory?');
    expect(route.kind).toBe('grounded');
    expect(route.workflowType).toBe('folder-summary');
    expect(route.coverageMode).toBe('enumeration');
  });
});

// ── Execution Plan Building ────────────────────────────────────────────────

describe('buildExecutionPlan', () => {
  it('produces scoped-retrieve + synthesize for generic-grounded', () => {
    const route = determineChatTurnRoute('what does my policy cover?');
    const plan = buildExecutionPlan(route, workspaceScope());

    expect(plan.workflowType).toBe('generic-grounded');
    expect(plan.steps.map(s => s.kind)).toEqual(['scoped-retrieve', 'synthesize']);
    expect(plan.outputConstraints).toEqual({});
  });

  it('produces scoped-retrieve with targetPaths for scoped-topic', () => {
    const scope = folderScope('Claims Guide/');
    const route = determineChatTurnRoute('What does the Claims Guide say about liability?');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('scoped-topic');
    expect(plan.steps.map(s => s.kind)).toEqual(['scoped-retrieve', 'synthesize']);
    expect(plan.steps[0].targetPaths).toEqual(['Claims Guide/']);
  });

  it('produces enumerate + deterministic-read + synthesize for folder-summary', () => {
    const scope = folderScope('RF Guides/');
    const route = determineChatTurnRoute('How many files are in the RF Guides directory?');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('folder-summary');
    expect(plan.steps.map(s => s.kind)).toEqual(['enumerate', 'deterministic-read', 'synthesize']);
    expect(plan.outputConstraints.format).toBe('list');
    expect(plan.outputConstraints.requireExhaustiveCitation).toBe(true);
  });

  it('produces deterministic-read + synthesize for document-summary', () => {
    const scope = documentScope('Auto Insurance Policy.md');
    const route = determineChatTurnRoute('Summarize the Auto Insurance Policy');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('document-summary');
    expect(plan.steps.map(s => s.kind)).toEqual(['deterministic-read', 'synthesize']);
    expect(plan.outputConstraints.format).toBe('prose');
  });

  it('produces two deterministic-reads + synthesize for comparative', () => {
    const scope = folderScope('Plans/');
    const route = determineChatTurnRoute('compare the deductible amounts in my two plans');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('comparative');
    expect(plan.steps.map(s => s.kind)).toEqual([
      'deterministic-read',
      'deterministic-read',
      'synthesize',
    ]);
    expect(plan.outputConstraints.format).toBe('table');
  });

  it('produces enumerate + deterministic-read + synthesize for exhaustive-extraction', () => {
    const scope = folderScope('Docs/');
    const route = determineChatTurnRoute('Extract every phone number from each file in this folder and list them all.');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('exhaustive-extraction');
    expect(plan.steps.map(s => s.kind)).toEqual([
      'enumerate',
      'deterministic-read',
      'synthesize',
    ]);
    expect(plan.outputConstraints.format).toBe('list');
    expect(plan.outputConstraints.requireExhaustiveCitation).toBe(true);
  });

  it('produces structural-inspect + scoped-retrieve + synthesize for mixed', () => {
    const route = { kind: 'grounded' as const, reason: 'test', workflowType: 'mixed' as const };
    const scope = folderScope('Project/');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('mixed');
    expect(plan.steps.map(s => s.kind)).toEqual([
      'structural-inspect',
      'scoped-retrieve',
      'synthesize',
    ]);
  });

  it('preserves the input scope on the plan', () => {
    const scope = folderScope('Claims/');
    const route = determineChatTurnRoute('what does my policy cover?');
    const plan = buildExecutionPlan(route, scope);

    expect(plan.scope).toBe(scope);
  });

  it('defaults to generic-grounded when route has no workflowType', () => {
    const route = { kind: 'grounded' as const, reason: 'test' };
    const scope = workspaceScope();
    const plan = buildExecutionPlan(route, scope);

    expect(plan.workflowType).toBe('generic-grounded');
    expect(plan.steps.map(s => s.kind)).toEqual(['scoped-retrieve', 'synthesize']);
  });
});
