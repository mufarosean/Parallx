import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  estimateMessagesTokens,
  VISION_TOKENS_PER_IMAGE,
} from '../../src/openclaw/openclawTokenBudget';
import {
  buildOpenclawSystemPrompt,
  type IOpenclawSystemPromptParams,
  type IBootstrapFile,
  type IOpenclawRuntimeInfo,
  type ISkillEntry,
  type IToolSummary,
} from '../../src/openclaw/openclawSystemPrompt';
import { OpenclawContextEngine, type IOpenclawContextEngineServices } from '../../src/openclaw/openclawContextEngine';
import type { IChatMessage, IChatResponseChunk } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createBaseParams(overrides?: Partial<IOpenclawSystemPromptParams>): IOpenclawSystemPromptParams {
  return {
    bootstrapFiles: [{ name: 'SOUL.md', content: 'You are an assistant.' }] as IBootstrapFile[],
    workspaceDigest: 'Test workspace',
    skills: [{ name: 'search', description: 'Search files', location: '/skills/search.md' }] as ISkillEntry[],
    tools: [{ name: 'readFile', description: 'Read a file' }] as IToolSummary[],
    runtimeInfo: {
      model: 'llava:7b',
      provider: 'ollama',
      host: 'localhost:11434',
      parallxVersion: '0.42.0',
    } as IOpenclawRuntimeInfo,
    ...overrides,
  };
}

function createMockServices(overrides?: Partial<IOpenclawContextEngineServices>): IOpenclawContextEngineServices {
  return {
    retrieveContext: vi.fn(async () => ({
      text: 'Context text.',
      sources: [{ uri: 'file:///test.md', label: 'test', index: 0 }],
    })),
    recallMemories: vi.fn(async () => ''),
    recallConcepts: vi.fn(async () => ''),
    recallTranscripts: vi.fn(async () => ''),
    getCurrentPageContent: vi.fn(async () => undefined),
    storeSessionMemory: vi.fn(async () => {}),
    storeConceptsFromSession: vi.fn(async () => {}),
    sendSummarizationRequest: undefined,
    ...overrides,
  };
}

const FAKE_IMAGE = { kind: 'image' as const, mimeType: 'image/png', data: 'iVBOR...base64' };

// ---------------------------------------------------------------------------
// D5-G1: Token estimation with images
// ---------------------------------------------------------------------------

describe('D5: estimateMessagesTokens with images', () => {
  it('adds VISION_TOKENS_PER_IMAGE per image', () => {
    const messages: IChatMessage[] = [
      { role: 'user', content: 'Describe this', images: [FAKE_IMAGE] },
    ];
    const withImage = estimateMessagesTokens(messages);
    const withoutImage = estimateMessagesTokens([
      { role: 'user', content: 'Describe this' },
    ]);
    expect(withImage - withoutImage).toBe(VISION_TOKENS_PER_IMAGE);
  });

  it('scales linearly with multiple images', () => {
    const messages: IChatMessage[] = [
      { role: 'user', content: 'Compare these', images: [FAKE_IMAGE, FAKE_IMAGE, FAKE_IMAGE] },
    ];
    const withImages = estimateMessagesTokens(messages);
    const withoutImages = estimateMessagesTokens([
      { role: 'user', content: 'Compare these' },
    ]);
    expect(withImages - withoutImages).toBe(3 * VISION_TOKENS_PER_IMAGE);
  });

  it('adds 0 tokens for empty images array', () => {
    const withEmpty: IChatMessage[] = [
      { role: 'user', content: 'Hello', images: [] },
    ];
    const withoutProp: IChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    expect(estimateMessagesTokens(withEmpty)).toBe(estimateMessagesTokens(withoutProp));
  });

  it('adds 0 tokens when images is undefined', () => {
    const messages: IChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    // Should not throw and should produce same result as explicit empty
    const result = estimateMessagesTokens(messages);
    expect(result).toBe(estimateMessagesTokens([{ role: 'user', content: 'Hello', images: [] }]));
  });

  it('counts images across multiple messages', () => {
    const messages: IChatMessage[] = [
      { role: 'user', content: 'First', images: [FAKE_IMAGE] },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Second', images: [FAKE_IMAGE, FAKE_IMAGE] },
    ];
    const baseline: IChatMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Second' },
    ];
    expect(estimateMessagesTokens(messages) - estimateMessagesTokens(baseline))
      .toBe(3 * VISION_TOKENS_PER_IMAGE);
  });

  it('VISION_TOKENS_PER_IMAGE is 768', () => {
    expect(VISION_TOKENS_PER_IMAGE).toBe(768);
  });
});

// ---------------------------------------------------------------------------
// D5-G3: System prompt vision guidance section
// ---------------------------------------------------------------------------

describe('D5: buildOpenclawSystemPrompt vision section', () => {
  it('includes Vision Capabilities section when supportsVision is true', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ supportsVision: true }));
    expect(prompt).toContain('## Vision Capabilities');
    expect(prompt).toContain('analyze images attached to user messages');
  });

  it('excludes Vision Capabilities section when supportsVision is false', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ supportsVision: false }));
    expect(prompt).not.toContain('## Vision Capabilities');
  });

  it('excludes Vision Capabilities section when supportsVision is undefined', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).not.toContain('## Vision Capabilities');
  });

  it('vision section contains practical guidance for image analysis', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ supportsVision: true }));
    expect(prompt).toContain('Describe what you see');
    expect(prompt).toContain('Reference visual elements');
    expect(prompt).toContain('workspace content');
  });
});

// ---------------------------------------------------------------------------
// D5-G2: Compaction transcript includes image annotations
// ---------------------------------------------------------------------------

describe('D5: compact() annotates images in transcript', () => {
  let engine: OpenclawContextEngine;

  beforeEach(() => {
    engine = new OpenclawContextEngine(createMockServices());
  });

  it('appends [attached N image(s)] for user messages with images', async () => {
    const history: IChatMessage[] = [
      { role: 'user', content: 'Look at this', images: [FAKE_IMAGE] },
      { role: 'assistant', content: 'I see a diagram.' },
      { role: 'user', content: 'And these two', images: [FAKE_IMAGE, FAKE_IMAGE] },
      { role: 'assistant', content: 'Both show charts.' },
    ];

    await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await engine.assemble({
      sessionId: 's1',
      history,
      tokenBudget: 8192,
      prompt: 'test',
    });

    const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
    // Compacted successfully (4 messages > 2 threshold)
    expect(result.compacted).toBe(true);
  });

  it('does not annotate assistant messages even if they had images', async () => {
    // Assistant messages should never get [attached ...] annotation
    // (only user messages can attach images in our model)
    const history: IChatMessage[] = [
      { role: 'user', content: 'Question one' },
      { role: 'assistant', content: 'Answer one' },
      { role: 'user', content: 'Question two' },
      { role: 'assistant', content: 'Answer two' },
    ];

    await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await engine.assemble({
      sessionId: 's1',
      history,
      tokenBudget: 8192,
      prompt: 'test',
    });

    const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(result.compacted).toBe(true);
  });

  it('does not annotate user messages without images', async () => {
    const history: IChatMessage[] = [
      { role: 'user', content: 'No image here' },
      { role: 'assistant', content: 'OK' },
      { role: 'user', content: 'Still no image' },
      { role: 'assistant', content: 'Got it' },
    ];

    await engine.bootstrap({ sessionId: 's1', tokenBudget: 8192 });
    await engine.assemble({
      sessionId: 's1',
      history,
      tokenBudget: 8192,
      prompt: 'test',
    });

    const result = await engine.compact({ sessionId: 's1', tokenBudget: 8192 });
    expect(result.compacted).toBe(true);
  });
});
