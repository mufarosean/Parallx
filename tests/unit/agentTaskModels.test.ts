import { describe, expect, it } from 'vitest';
import { createAgentTaskRecord, normalizeDelegatedTaskInput } from '../../src/agent/agentTaskModels';

describe('agentTaskModels', () => {
  it('normalizes delegated task input defaults and trimming', () => {
    const normalized = normalizeDelegatedTaskInput({
      goal: '  Review the workspace docs  ',
      constraints: [' keep it docs-only ', 'keep it docs-only', ' '],
      completionCriteria: [' summarize findings ', ''],
    });

    expect(normalized.goal).toBe('Review the workspace docs');
    expect(normalized.constraints).toEqual(['keep it docs-only']);
    expect(normalized.completionCriteria).toEqual(['summarize findings']);
    expect(normalized.mode).toBe('operator');
    expect(normalized.desiredAutonomy).toBe('allow-safe-actions');
    expect(normalized.allowedScope).toEqual({ kind: 'workspace' });
  });

  it('creates a pending task record from normalized input', () => {
    const record = createAgentTaskRecord('task-1', 'workspace-1', {
      goal: 'Prepare a migration checklist',
      mode: 'reviewer',
      desiredAutonomy: 'allow-readonly',
    }, '2026-03-08T10:00:00.000Z');

    expect(record.id).toBe('task-1');
    expect(record.workspaceId).toBe('workspace-1');
    expect(record.status).toBe('pending');
    expect(record.mode).toBe('reviewer');
    expect(record.desiredAutonomy).toBe('allow-readonly');
    expect(record.createdAt).toBe('2026-03-08T10:00:00.000Z');
    expect(record.updatedAt).toBe('2026-03-08T10:00:00.000Z');
    expect(record.artifactRefs).toEqual([]);
  });

  it('rejects empty delegated task goals', () => {
    expect(() => normalizeDelegatedTaskInput({ goal: '   ' })).toThrow('Delegated task goal is required.');
  });
});