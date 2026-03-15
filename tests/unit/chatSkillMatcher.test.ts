// chatSkillMatcher.test.ts — Unit tests for skill matching & activation (M39 Phase C)

import { describe, it, expect } from 'vitest';
import { matchWorkflowSkill, activateSkill } from '../../src/built-in/chat/utilities/chatSkillMatcher.js';
import type { ISkillCatalogEntry, IChatTurnRoute, IQueryScope } from '../../src/built-in/chat/chatTypes.js';
import type { ISkillManifest } from '../../src/services/skillLoaderService.js';

// ── Test fixtures ──

const exhaustiveSummarySkill: ISkillCatalogEntry = {
  name: 'exhaustive-summary',
  description: 'Summarize every file in a folder or the entire workspace',
  kind: 'workflow',
  tags: ['workflow', 'summary', 'exhaustive'],
};

const folderOverviewSkill: ISkillCatalogEntry = {
  name: 'folder-overview',
  description: 'Provide an overview of a folder contents including file count and descriptions',
  kind: 'workflow',
  tags: ['workflow', 'overview', 'structural'],
};

const docComparisonSkill: ISkillCatalogEntry = {
  name: 'document-comparison',
  description: 'Compare two or more documents in detail analyzing differences',
  kind: 'workflow',
  tags: ['workflow', 'comparison', 'analysis'],
};

const scopedExtractionSkill: ISkillCatalogEntry = {
  name: 'scoped-extraction',
  description: 'Extract specific information from all files in a scope',
  kind: 'workflow',
  tags: ['workflow', 'extraction', 'exhaustive'],
};

const allSkills: readonly ISkillCatalogEntry[] = [
  exhaustiveSummarySkill,
  folderOverviewSkill,
  docComparisonSkill,
  scopedExtractionSkill,
];

function groundedRoute(workflowType: string): IChatTurnRoute {
  return {
    kind: 'grounded',
    reason: 'test',
    workflowType: workflowType as IChatTurnRoute['workflowType'],
  };
}

const workspaceScope: IQueryScope = {
  level: 'workspace',
  derivedFrom: 'inferred',
  confidence: 1.0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// matchWorkflowSkill
// ═══════════════════════════════════════════════════════════════════════════════

describe('matchWorkflowSkill', () => {
  it('matches exhaustive-summary for folder-summary workflow', () => {
    const result = matchWorkflowSkill(
      'Summarize every file in this workspace',
      groundedRoute('folder-summary'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    expect(result.skill?.name).toBe('exhaustive-summary');
  });

  it('matches document-comparison for comparative workflow', () => {
    const result = matchWorkflowSkill(
      'Compare the two policy documents',
      groundedRoute('comparative'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    expect(result.skill?.name).toBe('document-comparison');
  });

  it('matches scoped-extraction for exhaustive-extraction workflow', () => {
    const result = matchWorkflowSkill(
      'Extract all deductible amounts from every policy',
      groundedRoute('exhaustive-extraction'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    expect(result.skill?.name).toBe('scoped-extraction');
  });

  it('matches a summary skill for document-summary workflow', () => {
    const result = matchWorkflowSkill(
      'Summarize the auto policy document',
      groundedRoute('document-summary'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    // Both exhaustive-summary and folder-overview have 'summary' or related tags
    expect(result.skill?.tags).toContain('summary');
  });

  it('returns no match for generic-grounded workflow', () => {
    const result = matchWorkflowSkill(
      'What is the collision deductible?',
      groundedRoute('generic-grounded'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('generic-grounded');
  });

  it('returns no match for mixed workflow', () => {
    const result = matchWorkflowSkill(
      'Tell me about the workspace',
      groundedRoute('mixed'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(false);
  });

  it('returns no match for non-grounded route', () => {
    const conversationalRoute: IChatTurnRoute = {
      kind: 'conversational',
      reason: 'greeting',
    };
    const result = matchWorkflowSkill('Hey there', conversationalRoute, workspaceScope, allSkills);
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('Non-grounded');
  });

  it('returns no match when catalog is empty', () => {
    const result = matchWorkflowSkill(
      'Summarize everything',
      groundedRoute('folder-summary'),
      workspaceScope,
      [],
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('No skills');
  });

  it('returns no match when no skills have required tags', () => {
    const onlyComparison = [docComparisonSkill];
    const result = matchWorkflowSkill(
      'Summarize all files',
      groundedRoute('folder-summary'),
      workspaceScope,
      onlyComparison,
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('No skills');
  });

  it('uses keyword overlap to pick best match among tag-matched skills', () => {
    // Both exhaustive-summary and a hypothetical skill could match 'summary' tag
    // but keyword overlap should prefer the one whose description matches user text
    const result = matchWorkflowSkill(
      'Summarize every file in the workspace exhaustively',
      groundedRoute('folder-summary'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    expect(result.skill?.name).toBe('exhaustive-summary');
    expect(result.reason).toContain('keyword overlap');
  });

  it('falls back to first tag match when keywords are sparse', () => {
    const result = matchWorkflowSkill(
      'do a thing',
      groundedRoute('comparative'),
      workspaceScope,
      allSkills,
    );
    expect(result.matched).toBe(true);
    expect(result.skill?.name).toBe('document-comparison');
    expect(result.reason).toContain('fallback');
  });

  it('match result includes a descriptive reason', () => {
    const result = matchWorkflowSkill(
      'Compare documents side by side',
      groundedRoute('comparative'),
      workspaceScope,
      allSkills,
    );
    expect(result.reason).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// activateSkill
// ═══════════════════════════════════════════════════════════════════════════════

describe('activateSkill', () => {
  const testManifest: ISkillManifest = {
    name: 'test-skill',
    description: 'A test skill',
    version: '1.0.0',
    author: 'test',
    permission: 'requires-approval',
    parameters: [],
    tags: ['workflow', 'test'],
    body: 'Step 1: Process $ARGUMENTS\nStep 2: Summarize results for $ARGUMENTS',
    relativePath: '.parallx/skills/test-skill/SKILL.md',
    kind: 'workflow',
    disableModelInvocation: false,
    userInvocable: true,
  };

  it('substitutes $ARGUMENTS with user text', () => {
    const result = activateSkill(testManifest, 'all policy files', 'planner');
    expect(result.resolvedBody).toBe(
      'Step 1: Process all policy files\nStep 2: Summarize results for all policy files',
    );
  });

  it('preserves body when no $ARGUMENTS placeholder exists', () => {
    const noArgManifest = { ...testManifest, body: 'Do a fixed task with no arguments' };
    const result = activateSkill(noArgManifest, 'some user text', 'user');
    expect(result.resolvedBody).toBe('Do a fixed task with no arguments');
  });

  it('sets activatedBy to planner when triggered by matcher', () => {
    const result = activateSkill(testManifest, 'test', 'planner');
    expect(result.activatedBy).toBe('planner');
  });

  it('sets activatedBy to user when triggered by slash command', () => {
    const result = activateSkill(testManifest, 'test', 'user');
    expect(result.activatedBy).toBe('user');
  });

  it('includes scope when provided', () => {
    const result = activateSkill(testManifest, 'test', 'planner', workspaceScope);
    expect(result.scope).toEqual(workspaceScope);
  });

  it('scope is undefined when not provided', () => {
    const result = activateSkill(testManifest, 'test', 'planner');
    expect(result.scope).toBeUndefined();
  });

  it('preserves manifest reference', () => {
    const result = activateSkill(testManifest, 'test', 'planner');
    expect(result.manifest).toBe(testManifest);
  });
});
