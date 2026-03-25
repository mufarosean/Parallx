import { describe, expect, it, vi } from 'vitest';

import { ChatMode } from '../../src/services/chatTypes';
import {
  buildDefaultRuntimePromptEnvelope,
  buildDefaultRuntimePromptSeed,
} from '../../src/built-in/chat/utilities/chatDefaultRuntimePromptStage';

describe('chat default runtime prompt stage', () => {
  it('builds the prompt seed with system prompt and history messages', async () => {
    const result = await buildDefaultRuntimePromptSeed({
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn().mockResolvedValue(2),
      getCurrentPageTitle: () => 'Claims Guide',
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getWorkspaceDigest: vi.fn().mockResolvedValue('DIGEST'),
      getPreferencesForPrompt: vi.fn().mockResolvedValue('PREFS'),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { systemPrompt: 'OVERLAY', workspaceDescription: 'Insurance workspace' },
        } as any),
      } as any,
    }, {
      mode: ChatMode.Ask,
      history: [{
        request: { text: 'Summarize the policy.' },
        response: { parts: [{ content: 'Policy summary.' }] },
      } as any],
    });

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('OVERLAY');
    expect(result.messages[0].content).toContain('PREFS');
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Summarize the policy.',
    });
    expect(result.messages[2]).toEqual({
      role: 'assistant',
      content: 'Policy summary.',
    });
  });

  it('builds the final runtime prompt envelope and carries only image attachments forward', () => {
    const result = buildDefaultRuntimePromptEnvelope({
      request: {
        text: 'What does the policy say?',
        mode: ChatMode.Agent,
        attachments: [
          { kind: 'image', id: 'img-1', name: 'photo.png', fullPath: 'parallx-image://1', isImplicit: false, mimeType: 'image/png', data: 'abc' },
          { kind: 'file', id: 'file-1', name: 'Policy.md', fullPath: 'D:/AI/Parallx/Policy.md', isImplicit: false },
        ],
      } as any,
      turn: {
        slashResult: {},
        effectiveText: 'What does the policy say?',
        userText: 'What does the policy say?',
        retrievalPlan: {
          intent: 'question',
          reasoning: 'Needs evidence',
          needsRetrieval: true,
          queries: ['policy coverage'],
        },
      } as any,
      preparedContext: {
        messages: [{ role: 'system', content: 'System prompt' }],
        contextParts: ['[Retrieved Context]\nPolicy excerpt'],
        evidenceAssessment: { status: 'weak', reasons: ['Need direct quote'] },
        coverageRecord: undefined,
      } as any,
      applyCommandTemplate: vi.fn(),
      buildEvidenceResponseConstraint: vi.fn().mockReturnValue('Use grounded evidence only.'),
    });

    expect(result.userContent).toContain('[User Request]');
    expect(result.userContent).toContain('[Supporting Context]');
    expect(result.userContent).toContain('Use grounded evidence only.');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].images).toHaveLength(1);
    expect(result.messages[1].images?.[0].name).toBe('photo.png');
  });
});