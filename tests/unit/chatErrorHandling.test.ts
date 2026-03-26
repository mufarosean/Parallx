// Unit tests for M9.2 error handling, token estimation, and edit mode parsing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatMode, ChatContentPartKind } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
} from '../../src/services/chatTypes';

// ── Helpers ──

function createService() {
  const agentService = new ChatAgentService();
  const modeService = new ChatModeService();
  const lmService = new LanguageModelsService();
  const chatService = new ChatService(agentService, modeService, lmService);
  return { agentService, modeService, lmService, chatService };
}

function makeAgent(handler: IChatParticipant['handler']): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Test',
    description: 'Test agent',
    commands: [],
    handler,
  };
}

// ── Error Details Rendering ──

describe('Error handling in sendRequest', () => {
  it('renders errorDetails as a warning part when agent returns error', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, _resp, _tok) => {
        return {
          errorDetails: {
            message: 'Model not found. Run `ollama pull llama3.2` to download it.',
            responseIsIncomplete: true,
          },
        };
      }),
    );

    const session = chatService.createSession();
    const result = await chatService.sendRequest(session.id, 'Hello');

    // errorDetails should be returned
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails!.message).toContain('Model not found');

    // The response should have a warning part
    const responseParts = session.messages[0].response.parts;
    const warnings = responseParts.filter(
      (p) => (p as any).kind === ChatContentPartKind.Warning,
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect((warnings[0] as any).message).toContain('Model not found');
  });

  it('marks response incomplete when errorDetails.responseIsIncomplete is true', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, _resp, _tok) => {
        return {
          errorDetails: {
            message: 'Stream interrupted',
            responseIsIncomplete: true,
          },
        };
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hello');

    // The assistant response should be marked incomplete
    expect(session.messages[0].response.isComplete).toBe(false);
  });

  it('handles thrown exceptions from agent handler', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async () => {
        throw new Error('Unexpected failure');
      }),
    );

    const session = chatService.createSession();
    const result = await chatService.sendRequest(session.id, 'Hello');

    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails!.message).toBe('Unexpected failure');
  });

  it('preserves partial response when errorDetails indicates incomplete', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp, _tok) => {
        // Write some content before failing
        resp.markdown('Partial response content...');
        return {
          errorDetails: {
            message: 'Connection lost',
            responseIsIncomplete: true,
          },
        };
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hello');

    const parts = session.messages[0].response.parts;
    // Should have both the markdown content AND the warning
    const markdownParts = parts.filter((p) => (p as any).kind === ChatContentPartKind.Markdown);
    const warningParts = parts.filter((p) => (p as any).kind === ChatContentPartKind.Warning);
    expect(markdownParts.length).toBeGreaterThan(0);
    expect(warningParts.length).toBeGreaterThan(0);
  });
});

// ── Empty Response ──

describe('Empty response detection', () => {
  it('warning() is usable for empty response scenario', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp, _tok) => {
        // Agent detects empty response and warns
        resp.warning('The model returned an empty response.');
        return {};
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hello');

    const warnings = session.messages[0].response.parts.filter(
      (p) => (p as any).kind === ChatContentPartKind.Warning,
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ── Stream with warning parts ──

describe('IChatResponseStream.warning()', () => {
  it('pushes a Warning content part', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp, _tok) => {
        resp.warning('Test warning message');
        return {};
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hello');

    const parts = session.messages[0].response.parts;
    const warning = parts.find((p) => (p as any).kind === ChatContentPartKind.Warning);
    expect(warning).toBeDefined();
    expect((warning as any).message).toBe('Test warning message');
  });
});

// ── Edit Proposal stream methods ──

describe('IChatResponseStream edit methods', () => {
  it('editProposal pushes an EditProposal part', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp, _tok) => {
        resp.editProposal('page-1', 'insert', 'New content', { blockId: 'block-1' });
        return {};
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Edit something');

    const parts = session.messages[0].response.parts;
    const editPart = parts.find((p) => (p as any).kind === ChatContentPartKind.EditProposal);
    expect(editPart).toBeDefined();
    expect((editPart as any).pageId).toBe('page-1');
    expect((editPart as any).operation).toBe('insert');
    expect((editPart as any).after).toBe('New content');
    expect((editPart as any).blockId).toBe('block-1');
  });

  it('editBatch pushes an EditBatch part', async () => {
    const { agentService, chatService } = createService();
    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp, _tok) => {
        resp.editBatch('Adding a new block', [
          {
            kind: ChatContentPartKind.EditProposal,
            pageId: 'page-1',
            operation: 'insert',
            after: 'Hello world',
            status: 'pending',
          },
        ]);
        return {};
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Add block');

    const parts = session.messages[0].response.parts;
    const batchPart = parts.find((p) => (p as any).kind === ChatContentPartKind.EditBatch);
    expect(batchPart).toBeDefined();
    expect((batchPart as any).explanation).toBe('Adding a new block');
    expect((batchPart as any).proposals).toHaveLength(1);
  });
});

// ── Mode Commands ──

describe('ChatModeService', () => {
  it('cycles through modes via setMode', () => {
    const modeService = new ChatModeService();
    // M41 Phase 9: default is now Agent, available modes are [Agent, Edit]
    expect(modeService.getMode()).toBe(ChatMode.Agent);

    const modes = modeService.getAvailableModes();
    expect(modes).toContain(ChatMode.Agent);
    expect(modes).toContain(ChatMode.Edit);
    expect(modes).not.toContain(ChatMode.Ask);

    modeService.setMode(ChatMode.Edit);
    expect(modeService.getMode()).toBe(ChatMode.Edit);

    modeService.setMode(ChatMode.Agent);
    expect(modeService.getMode()).toBe(ChatMode.Agent);
  });

  it('fires onDidChangeMode when mode changes', () => {
    const modeService = new ChatModeService();
    const listener = vi.fn();
    modeService.onDidChangeMode(listener);

    modeService.setMode(ChatMode.Edit);
    expect(listener).toHaveBeenCalledWith(ChatMode.Edit);
  });
});
