// Unit tests for M9.2 follow-up suggestion chips

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatMode, ChatContentPartKind } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantResult,
  IChatFollowup,
} from '../../src/services/chatTypes';
import { renderFollowups } from '../../src/built-in/chat/chatContentParts';

// ── Helpers ──

function createService() {
  const agentService = new ChatAgentService();
  const modeService = new ChatModeService();
  const lmService = new LanguageModelsService();
  const chatService = new ChatService(agentService, modeService, lmService);
  return { agentService, modeService, lmService, chatService };
}

function makeAgent(
  handler: IChatParticipant['handler'],
  provideFollowups?: IChatParticipant['provideFollowups'],
): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Test',
    description: 'Test agent',
    commands: [],
    handler,
    provideFollowups,
  };
}

// ── IChatFollowup Type Tests ──

describe('IChatFollowup type contract', () => {
  it('accepts minimal followup with only message', () => {
    const followup: IChatFollowup = { message: 'Tell me more' };
    expect(followup.message).toBe('Tell me more');
    expect(followup.label).toBeUndefined();
    expect(followup.tooltip).toBeUndefined();
  });

  it('accepts full followup with all fields', () => {
    const followup: IChatFollowup = {
      message: 'Explain this code',
      label: 'Explain',
      tooltip: 'Get a detailed explanation',
    };
    expect(followup.label).toBe('Explain');
    expect(followup.tooltip).toBe('Get a detailed explanation');
  });
});

// ── provideFollowups Integration ──

describe('provideFollowups in sendRequest', () => {
  it('stores followups on the assistant response after handler completes', async () => {
    const { agentService, chatService } = createService();
    const followups: IChatFollowup[] = [
      { message: 'Tell me more', label: 'More' },
      { message: 'Give an example', label: 'Example' },
    ];

    agentService.registerAgent(
      makeAgent(
        async (_req, _ctx, resp) => {
          resp.markdown('Hello!');
          return {};
        },
        async () => followups,
      ),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hi');

    // Wait for the async follow-up fetch (fire-and-forget with microtask)
    await new Promise((r) => setTimeout(r, 50));

    const response = session.messages[0].response;
    expect(response.followups).toBeDefined();
    expect(response.followups).toHaveLength(2);
    expect(response.followups![0].message).toBe('Tell me more');
    expect(response.followups![1].label).toBe('Example');
  });

  it('does not call provideFollowups when response has incomplete error', async () => {
    const { agentService, chatService } = createService();
    const spy = vi.fn().mockResolvedValue([{ message: 'test' }]);

    agentService.registerAgent(
      makeAgent(
        async () => ({
          errorDetails: { message: 'fail', responseIsIncomplete: true },
        }),
        spy,
      ),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hi');
    await new Promise((r) => setTimeout(r, 50));

    expect(spy).not.toHaveBeenCalled();
    expect(session.messages[0].response.followups).toBeUndefined();
  });

  it('gracefully handles provideFollowups that throws', async () => {
    const { agentService, chatService } = createService();

    agentService.registerAgent(
      makeAgent(
        async (_req, _ctx, resp) => {
          resp.markdown('OK');
          return {};
        },
        async () => { throw new Error('followup generation failed'); },
      ),
    );

    const session = chatService.createSession();
    // Should not throw
    await chatService.sendRequest(session.id, 'Hi');
    await new Promise((r) => setTimeout(r, 50));

    expect(session.messages[0].response.followups).toBeUndefined();
  });

  it('does not set followups when provider returns empty array', async () => {
    const { agentService, chatService } = createService();

    agentService.registerAgent(
      makeAgent(
        async (_req, _ctx, resp) => {
          resp.markdown('OK');
          return {};
        },
        async () => [],
      ),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hi');
    await new Promise((r) => setTimeout(r, 50));

    // Empty array means no followups set
    expect(session.messages[0].response.followups).toBeUndefined();
  });

  it('works when participant has no provideFollowups', async () => {
    const { agentService, chatService } = createService();

    agentService.registerAgent(
      makeAgent(async (_req, _ctx, resp) => {
        resp.markdown('Hello');
        return {};
      }),
    );

    const session = chatService.createSession();
    await chatService.sendRequest(session.id, 'Hi');
    await new Promise((r) => setTimeout(r, 50));

    expect(session.messages[0].response.followups).toBeUndefined();
  });
});

// ── IChatParticipant.provideFollowups on IChatParticipant ──

describe('IChatParticipant with provideFollowups', () => {
  it('provideFollowups is optional on IChatParticipant', () => {
    const agent: IChatParticipant = {
      id: 'test',
      displayName: 'Test',
      description: 'desc',
      commands: [],
      handler: async () => ({}),
    };
    expect(agent.provideFollowups).toBeUndefined();
  });

  it('provideFollowups can be set on IChatParticipant', () => {
    const agent: IChatParticipant = {
      id: 'test',
      displayName: 'Test',
      description: 'desc',
      commands: [],
      handler: async () => ({}),
      provideFollowups: async () => [{ message: 'hi' }],
    };
    expect(agent.provideFollowups).toBeDefined();
  });
});

// ── renderFollowups DOM Tests ──

describe('renderFollowups', () => {
  it('renders chips for each followup', () => {
    const el = renderFollowups([
      { message: 'Tell me more', label: 'More' },
      { message: 'Give an example' },
    ]);

    expect(el.className).toBe('parallx-chat-followups');
    const chips = el.querySelectorAll('.parallx-chat-followup-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('More');
    expect(chips[1].textContent).toBe('Give an example'); // Falls back to message
  });

  it('sets tooltip from followup.tooltip', () => {
    const el = renderFollowups([
      { message: 'Explain', tooltip: 'Get detailed explanation' },
    ]);
    const chip = el.querySelector('.parallx-chat-followup-chip') as HTMLButtonElement;
    expect(chip.title).toBe('Get detailed explanation');
  });

  it('dispatches parallx-followup-click event on chip click', () => {
    const el = renderFollowups([
      { message: 'Run this command', label: 'Run' },
    ]);
    document.body.appendChild(el);

    let receivedMessage = '';
    el.addEventListener('parallx-followup-click', ((e: CustomEvent) => {
      receivedMessage = e.detail.message;
    }) as EventListener);

    const chip = el.querySelector('.parallx-chat-followup-chip') as HTMLButtonElement;
    chip.click();

    expect(receivedMessage).toBe('Run this command');
    el.remove();
  });

  it('returns empty container for empty followups array', () => {
    const el = renderFollowups([]);
    expect(el.className).toBe('parallx-chat-followups');
    expect(el.children).toHaveLength(0);
  });

  it('chips are button elements with correct type', () => {
    const el = renderFollowups([{ message: 'test' }]);
    const chip = el.querySelector('.parallx-chat-followup-chip') as HTMLButtonElement;
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.type).toBe('button');
  });
});
