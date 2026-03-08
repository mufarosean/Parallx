import { describe, expect, it } from 'vitest';
import { URI } from '../../src/platform/uri';
import { AgentPolicyService } from '../../src/services/agentPolicyService';
import { WorkspaceBoundaryService } from '../../src/services/workspaceBoundaryService';

function createPolicyService(
  folderPaths: readonly string[] = ['/workspace'],
  overrides?: { verbosity?: 'concise' | 'balanced' | 'detailed'; approvalStrictness?: 'strict' | 'balanced' | 'streamlined' },
): AgentPolicyService {
  const boundaryService = new WorkspaceBoundaryService();
  boundaryService.setHost({
    folders: folderPaths.map((path, index) => ({ uri: URI.file(path), name: `root-${index}`, index })),
  });
  return new AgentPolicyService(boundaryService, {
    getEffectiveConfig: () => ({ agent: overrides ?? {} }),
  });
}

describe('AgentPolicyService', () => {
  it('allows workspace reads inside the boundary', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'read_file',
      targetUris: [URI.file('/workspace/README.md')],
      interactionMode: 'operator',
    });

    expect(decision.actionClass).toBe('read');
    expect(decision.policy).toBe('allow');
    expect(decision.boundaryDecisions[0]?.allowed).toBe(true);
  });

  it('requires approval for workspace edits', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'apply_patch',
      targetUris: [URI.file('/workspace/docs/README.md')],
      interactionMode: 'operator',
    });

    expect(decision.actionClass).toBe('edit');
    expect(decision.policy).toBe('require-approval');
  });

  it('tightens read policy when approval strictness is strict', () => {
    const service = createPolicyService(['/workspace'], { approvalStrictness: 'strict' });
    const decision = service.evaluateAction({
      toolName: 'read_file',
      targetUris: [URI.file('/workspace/README.md')],
      interactionMode: 'operator',
    });

    expect(decision.policy).toBe('require-approval');
  });

  it('streamlines routine edits when approval strictness is streamlined', () => {
    const service = createPolicyService(['/workspace'], { approvalStrictness: 'streamlined' });
    const decision = service.evaluateAction({
      toolName: 'apply_patch',
      targetUris: [URI.file('/workspace/docs/README.md')],
      interactionMode: 'operator',
    });

    expect(decision.policy).toBe('allow-with-notification');
  });

  it('denies boundary-violating actions', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'read_file',
      targetUris: [URI.file('/outside/secret.txt')],
      interactionMode: 'operator',
    });

    expect(decision.policy).toBe('deny');
    expect(decision.boundaryDecisions[0]?.violationType).toBe('outside-workspace');
  });

  it('denies unsupported tools', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'mystery_tool',
      interactionMode: 'operator',
    });

    expect(decision.actionClass).toBe('unknown');
    expect(decision.policy).toBe('deny');
  });

  it('denies destructive command execution in reviewer mode', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'run_in_terminal',
      interactionMode: 'reviewer',
    });

    expect(decision.actionClass).toBe('command');
    expect(decision.policy).toBe('deny');
  });

  it('denies path-bearing non-file uris', () => {
    const service = createPolicyService();
    const decision = service.evaluateAction({
      toolName: 'read_file',
      targetUris: [URI.parse('untitled:Untitled-1')],
      interactionMode: 'operator',
    });

    expect(decision.policy).toBe('deny');
    expect(decision.boundaryDecisions[0]?.violationType).toBe('non-file-uri');
  });
});