import { describe, expect, it } from 'vitest';

import { categorizeChatRequestError } from '../../src/built-in/chat/utilities/chatRequestErrorCategorizer';

describe('chat request error categorizer', () => {
  it('returns empty message for aborts', () => {
    const result = categorizeChatRequestError(new DOMException('aborted', 'AbortError'));
    expect(result).toEqual({ message: '' });
  });

  it('returns timeout guidance for timeouts', () => {
    const result = categorizeChatRequestError(new DOMException('timed out', 'TimeoutError'));
    expect(result.message).toContain('Request timed out');
  });

  it('maps fetch failures to the ollama guidance', () => {
    const result = categorizeChatRequestError(new Error('fetch failed'));
    expect(result.message).toContain('Ollama is not running');
  });

  it('extracts model names from model-not-found errors', () => {
    const result = categorizeChatRequestError(new Error('model qwen3.5 not found 404'));
    expect(result.message).toContain('ollama pull qwen3.5');
  });

  it('falls back to the original message for other errors', () => {
    const result = categorizeChatRequestError(new Error('boom'));
    expect(result).toEqual({ message: 'boom' });
  });
});