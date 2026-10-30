// @vitest-environment jsdom
// runViewerLive.test.ts — Watch on a running background run: the transcript
// fills in as the run streams, then becomes the archived transcript once the
// run ends (even when the archive lands a moment after).
import { describe, it, expect, vi } from 'vitest';
import { mountRunViewer } from '../../src/built-in/chat/archivedRunViewer';
import { ChatContentPartKind, type IChatSession } from '../../src/services/chatTypes';

const session = (answer: string): IChatSession => ({
  id: 'run-1', title: 'Morning Brief', createdAt: 0, messages: [{ request: { text: 'Write the brief', requestId: 'r', timestamp: 0 }, response: { parts: [{ kind: ChatContentPartKind.Markdown, content: answer }], isComplete: false, modelId: 'm', timestamp: 0 } }],
} as unknown as IChatSession);

describe('watching a background run', () => {
  it('fills in live, then shows the archive once it is written', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const host = document.createElement('div');
    let live: IChatSession | undefined = session('Today');
    let archive: IChatSession | null = null;
    const listeners = new Set<() => void>();
    const fire = () => listeners.forEach((l) => l());
    const v = mountRunViewer(host, { live: () => live, onChange: (fn) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, archived: async () => archive }, 'cron');
    expect(host.textContent).toContain('Write the brief');
    expect(host.querySelector('.archived-run-view__sub')?.textContent).toContain('running');

    live = session('Today you have three classes');
    fire(); fire(); // two changes in one frame: one redraw
    await new Promise((r) => setTimeout(r, 5));
    expect(host.textContent).toContain('three classes');

    live = undefined; // the run ended; its archive is not written yet
    fire();
    await new Promise((r) => setTimeout(r, 5));
    expect(host.textContent).toContain('no longer available');

    archive = { ...session('Today you have three classes. Done.'), title: 'Morning Brief' } as IChatSession;
    fire(); // the archive landed
    await new Promise((r) => setTimeout(r, 5));
    expect(host.textContent).toContain('Done.');
    expect(host.querySelector('.archived-run-view__sub')?.textContent).not.toContain('running');
    v.dispose();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
});
