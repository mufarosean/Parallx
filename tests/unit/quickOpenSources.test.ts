// Quick Open sources: a running tool lists its own things in Ctrl+P, and
// they leave when the tool does.
import { describe, it, expect } from 'vitest';
import { registerQuickOpenSource, getQuickOpenSources } from '../../src/services/quickOpenSources';

describe('quickOpenSources', () => {
  it('lists a source while it is registered, and drops it when disposed', async () => {
    const d = registerQuickOpenSource({
      id: 'test.pages',
      group: 'pages',
      listItems: async () => [{ id: 'p1', label: 'Loss Development Factors', detail: 'Course Notes', open: () => {} }],
    });
    expect(getQuickOpenSources().map((s) => s.id)).toContain('test.pages');
    expect((await getQuickOpenSources()[0].listItems())[0].label).toBe('Loss Development Factors');
    d.dispose();
    expect(getQuickOpenSources().map((s) => s.id)).not.toContain('test.pages');
  });

  it('keeps the newer registration when an older one with the same id is disposed', () => {
    const first = registerQuickOpenSource({ id: 'same', group: 'a', listItems: async () => [] });
    const second = registerQuickOpenSource({ id: 'same', group: 'b', listItems: async () => [] });
    first.dispose();
    expect(getQuickOpenSources().find((s) => s.id === 'same')?.group).toBe('b');
    second.dispose();
  });
});
