// @vitest-environment jsdom
// archivedRunViewer.test.ts — M91 S3: read-only transcript renderer.
import { describe, expect, it } from 'vitest';
import { renderArchivedRun } from '../../src/built-in/chat/archivedRunViewer';
import { ChatContentPartKind } from '../../src/services/chatTypes';
import type { IChatSession } from '../../src/services/chatTypes';

function run(): IChatSession {
  return {
    id: 'ephemeral-x', title: 'Morning brief', mode: 'agent' as never, modelId: 'llama3',
    createdAt: Date.now(), updatedAt: Date.now(), requestInProgress: false,
    sessionResource: { toString: () => 'x' } as never,
    messages: [{
      request: { text: 'summarize my day', timestamp: 1, id: 'u1' } as never,
      response: { parts: [{ kind: ChatContentPartKind.Markdown, content: 'You have 3 tasks.' }], modelId: 'llama3', isComplete: true, timestamp: 2 } as never,
    }],
  } as IChatSession;
}

describe('renderArchivedRun (M91 S3)', () => {
  it('renders the header, seed prompt, and assistant content', () => {
    const c = document.createElement('div');
    renderArchivedRun(c, run(), 'heartbeat');
    expect(c.querySelector('.archived-run-view__title')?.textContent).toBe('Morning brief');
    expect(c.querySelector('.archived-run-view__sub')?.textContent).toContain('Heartbeat');
    expect(c.querySelector('.archived-run-msg--user')?.textContent).toBe('summarize my day');
    expect(c.textContent).toContain('You have 3 tasks.');
  });

  it('shows a graceful message when the run was pruned (null)', () => {
    const c = document.createElement('div');
    renderArchivedRun(c, null, 'cron');
    expect(c.querySelector('.archived-run-view__empty')?.textContent).toContain('no longer available');
  });

  it('dispose clears the container', () => {
    const c = document.createElement('div');
    const h = renderArchivedRun(c, run());
    h.dispose();
    expect(c.innerHTML).toBe('');
  });
});
