import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryEditTool, createMemoryGetTool } from '../../src/built-in/chat/tools/memoryTools';
import type { IBuiltInToolWorkspaceMemory } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

// ─── In-memory IBuiltInToolWorkspaceMemory mock ───────────────────────────────

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MEMORY_INDEX_LINE_REGEX = /^- \[([^\]]+)\]\(lessons\/([^)]+)\.md\)\s+—\s+(.+)$/;
const MEMORY_INDEX_HEADER = [
  '# Memory Index',
  '',
  'Long-term lessons. Each line points to a lesson file with the full',
  'body. Bounded — when the index is full the agent removes an old entry',
  'before adding a new one.',
  '',
].join('\n');

function humanizeSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) { return ''; }
  const words = trimmed.replace(/[_\s]+/g, '-').split('-').filter((p) => p.length > 0);
  if (words.length === 0) { return ''; }
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

function createMemoryMock(): IBuiltInToolWorkspaceMemory & {
  files: Map<string, string>;
  reset(): void;
} {
  const files = new Map<string, string>();
  const memory: IBuiltInToolWorkspaceMemory & { files: Map<string, string>; reset(): void } = {
    files,
    reset() { files.clear(); },
    getUserFileRelativePath: () => '.parallx/USER.md',
    getDurableMemoryRelativePath: () => '.parallx/memory/MEMORY.md',
    getDailyMemoryRelativePath: (date: Date = new Date()) => `.parallx/memory/${isoDate(date)}.md`,
    async readUserFile() { return files.get('.parallx/USER.md') ?? ''; },
    async writeUserFile(content: string) { files.set('.parallx/USER.md', content); },
    async readDurableMemory() { return files.get('.parallx/memory/MEMORY.md') ?? ''; },
    async writeDurableMemory(content: string) { files.set('.parallx/memory/MEMORY.md', content); },
    async readDailyMemory(date: Date = new Date()) {
      return files.get(`.parallx/memory/${isoDate(date)}.md`) ?? '';
    },
    async appendDailyMemory(text: string, date: Date = new Date()) {
      const path = `.parallx/memory/${isoDate(date)}.md`;
      const existing = files.get(path) ?? '';
      const base = existing.trim().length > 0 ? existing : `# ${isoDate(date)}\n`;
      const sep = existing.trim().length > 0 ? '\n\n' : '\n';
      files.set(path, `${base.trimEnd()}${sep}${text.trim()}\n`);
    },
    async writeDailyMemory(body: string, date: Date = new Date()) {
      const path = `.parallx/memory/${isoDate(date)}.md`;
      const trimmed = body.trim();
      files.set(path, trimmed ? `# ${isoDate(date)}\n\n${trimmed}\n` : `# ${isoDate(date)}\n`);
    },
    async ensureDailyMemory(date: Date = new Date()) {
      const path = `.parallx/memory/${isoDate(date)}.md`;
      if (!files.has(path)) {
        files.set(path, `# ${isoDate(date)}\n`);
      }
      return path;
    },
    // ── M81 Phase 8 lesson methods ──
    getLessonFileRelativePath: (slug: string) => `.parallx/memory/lessons/${slug}.md`,
    async readLessonFile(slug: string) {
      return files.get(`.parallx/memory/lessons/${slug}.md`) ?? '';
    },
    async writeLessonFile(slug: string, content: string) {
      files.set(`.parallx/memory/lessons/${slug}.md`, content.endsWith('\n') ? content : `${content}\n`);
    },
    async archiveLessonFile(slug: string) {
      const sourcePath = `.parallx/memory/lessons/${slug}.md`;
      if (!files.has(sourcePath)) {
        return false;
      }
      const content = files.get(sourcePath)!;
      files.set(`.parallx/memory/_archive/lessons/${slug}.md`, content);
      files.delete(sourcePath);
      return true;
    },
    async parseMemoryIndex() {
      const memoryContent = files.get('.parallx/memory/MEMORY.md') ?? '';
      if (!memoryContent.trim()) { return []; }
      const out: Array<{ slug: string; description: string; path: string }> = [];
      for (const rawLine of memoryContent.split('\n')) {
        const line = rawLine.trimEnd();
        const match = line.match(MEMORY_INDEX_LINE_REGEX);
        if (!match) { continue; }
        const [, , slug, description] = match;
        out.push({ slug, description: description.trim(), path: `lessons/${slug}.md` });
      }
      return out;
    },
    async addMemoryIndexEntry(slug: string, description: string) {
      const trimmedSlug = slug.trim();
      const truncatedDescription = (description ?? '').trim().slice(0, 120);
      const title = humanizeSlug(trimmedSlug);
      const newLine = `- [${title}](lessons/${trimmedSlug}.md) — ${truncatedDescription}`;
      const current = files.get('.parallx/memory/MEMORY.md') ?? '';
      const base = current.includes('# Memory Index') ? current : MEMORY_INDEX_HEADER;

      const lines = base.split('\n');
      let replaced = false;
      const nextLines = lines.map((line) => {
        const trimmed = line.trimEnd();
        const match = trimmed.match(MEMORY_INDEX_LINE_REGEX);
        if (match && match[2] === trimmedSlug) {
          replaced = true;
          return newLine;
        }
        return line;
      });

      let nextContent: string;
      if (replaced) {
        nextContent = nextLines.join('\n');
      } else {
        const trimmedBase = nextLines.join('\n').replace(/\n+$/, '');
        nextContent = `${trimmedBase}\n${newLine}\n`;
      }
      files.set('.parallx/memory/MEMORY.md', nextContent);
    },
    async removeMemoryIndexEntry(slug: string) {
      const trimmedSlug = slug.trim();
      const current = files.get('.parallx/memory/MEMORY.md') ?? '';
      if (!current) { return; }
      const lines = current.split('\n');
      let removed = false;
      const nextLines = lines.filter((line) => {
        const match = line.trimEnd().match(MEMORY_INDEX_LINE_REGEX);
        if (match && match[2] === trimmedSlug) {
          removed = true;
          return false;
        }
        return true;
      });
      if (!removed) { return; }
      files.set('.parallx/memory/MEMORY.md', nextLines.join('\n'));
    },
  };
  return memory;
}

const noopToken: ICancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('memory_write tool (M81 Phase 2)', () => {
  let memory: ReturnType<typeof createMemoryMock>;
  const tool = createMemoryEditTool(undefined as any); // placeholder, overridden per-test

  beforeEach(() => {
    memory = createMemoryMock();
  });

  describe('parameter validation', () => {
    it('returns isError when no workspace memory accessor is bound', async () => {
      const t = createMemoryEditTool(undefined);
      const result = await t.handler({ file: 'USER', action: 'add', entry: 'x' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('no workspace folder');
    });

    it('rejects invalid file values', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'INVALID', action: 'add', entry: 'x' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid `file`');
    });

    it('rejects invalid action values', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'USER', action: 'overwrite', entry: 'x' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid `action`');
    });

    it('requires entry for add', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'USER', action: 'add', entry: '' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('`entry` is required');
    });

    it('requires target for replace and remove', async () => {
      const t = createMemoryEditTool(memory);
      const a = await t.handler({ file: 'USER', action: 'replace', entry: 'new' }, noopToken);
      expect(a.isError).toBe(true);
      const b = await t.handler({ file: 'USER', action: 'remove' }, noopToken);
      expect(b.isError).toBe(true);
    });

    it('rejects malformed date for daily', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'daily', action: 'add', entry: 'note', date: 'not-a-date' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('YYYY-MM-DD');
    });
  });

  describe('action=add', () => {
    it('appends to an empty USER.md', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'USER', action: 'add', entry: 'prefers dark mode' }, noopToken);
      expect(result.isError).toBeFalsy();
      expect(memory.files.get('.parallx/USER.md')).toContain('prefers dark mode');
    });

    it('appends with a blank-line separator when file already has content', async () => {
      memory.files.set('.parallx/USER.md', '# User\n\n## About\n- existing\n');
      const t = createMemoryEditTool(memory);
      await t.handler({ file: 'USER', action: 'add', entry: '## Note\n- new fact' }, noopToken);
      const next = memory.files.get('.parallx/USER.md')!;
      expect(next).toMatch(/- existing\n+## Note/);
      expect(next).toContain('- new fact');
    });

    it('appends to MEMORY.md', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'MEMORY', action: 'add', entry: '- M81 ships memory_write' }, noopToken);
      expect(result.isError).toBeFalsy();
      expect(memory.files.get('.parallx/memory/MEMORY.md')).toContain('M81 ships memory_write');
    });

    it('appends to daily log via appendDailyMemory', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'daily', action: 'add', entry: 'shipped Phase 2', date: '2026-05-26' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      const daily = memory.files.get('.parallx/memory/2026-05-26.md')!;
      expect(daily).toContain('# 2026-05-26');
      expect(daily).toContain('shipped Phase 2');
    });
  });

  describe('bounded curation (USER.md cap = 1500, MEMORY.md cap = 2500)', () => {
    it('rejects USER add when it would exceed 1,500 chars and returns current contents', async () => {
      memory.files.set('.parallx/USER.md', 'x'.repeat(1490));
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'USER', action: 'add', entry: 'yyyyyyyyyyyyyyyy' }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Cannot add');
      expect(result.content).toContain('Current contents');
      // file should not have been mutated
      expect(memory.files.get('.parallx/USER.md')).toBe('x'.repeat(1490));
    });

    it('rejects MEMORY add when it would exceed 2,500 chars', async () => {
      memory.files.set('.parallx/memory/MEMORY.md', 'x'.repeat(2490));
      const t = createMemoryEditTool(memory);
      const result = await t.handler({ file: 'MEMORY', action: 'add', entry: 'a long entry that pushes past'.repeat(2) }, noopToken);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Cannot add');
    });

    it('allows daily appends past USER/MEMORY caps (daily is unbounded)', async () => {
      memory.files.set('.parallx/memory/2026-05-26.md', '# 2026-05-26\n' + 'x'.repeat(3000));
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'daily', action: 'add', entry: 'one more line', date: '2026-05-26' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe('action=replace', () => {
    it('replaces the first occurrence of target', async () => {
      memory.files.set('.parallx/USER.md', '# User\n\n## About\n- old: developer\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'USER', action: 'replace', target: 'old: developer', entry: 'role: senior developer' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      expect(memory.files.get('.parallx/USER.md')).toContain('role: senior developer');
      expect(memory.files.get('.parallx/USER.md')).not.toContain('old: developer');
    });

    it('returns isError when target is not found', async () => {
      memory.files.set('.parallx/USER.md', '# User\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'USER', action: 'replace', target: 'missing string', entry: 'x' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Could not find target');
    });

    it('replaces a substring in a daily file and preserves the date header', async () => {
      memory.files.set('.parallx/memory/2026-05-26.md', '# 2026-05-26\n\nfoo\nbar\nbaz\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'daily', action: 'replace', target: 'bar', entry: 'BAR', date: '2026-05-26' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      const next = memory.files.get('.parallx/memory/2026-05-26.md')!;
      expect(next).toContain('# 2026-05-26'); // header preserved (re-applied by writeDailyMemory)
      expect(next).toContain('BAR');
      expect(next).not.toContain('\nbar\n');
    });
  });

  describe('action=remove', () => {
    it('removes the first occurrence of target', async () => {
      memory.files.set('.parallx/USER.md', '# User\n\n- keep\n- delete me\n- keep too\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'USER', action: 'remove', target: '- delete me\n' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      const next = memory.files.get('.parallx/USER.md')!;
      expect(next).not.toContain('delete me');
      expect(next).toContain('- keep');
      expect(next).toContain('- keep too');
    });

    it('returns isError when target is not found', async () => {
      memory.files.set('.parallx/memory/MEMORY.md', '# Durable Memory\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'MEMORY', action: 'remove', target: 'nothing matches this' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Could not find target');
    });
  });

  describe('tool metadata', () => {
    it('declares requires-approval permission level', () => {
      const t = createMemoryEditTool(memory);
      expect(t.permissionLevel).toBe('requires-approval');
      expect(t.requiresConfirmation).toBe(true);
    });

    it('declares the required parameters', () => {
      const t = createMemoryEditTool(memory);
      expect(t.parameters.required).toEqual(['file', 'action']);
      expect(t.parameters.properties).toHaveProperty('file');
      expect(t.parameters.properties).toHaveProperty('action');
      expect(t.parameters.properties).toHaveProperty('entry');
      expect(t.parameters.properties).toHaveProperty('target');
      expect(t.parameters.properties).toHaveProperty('date');
    });
  });

  // Silence unused warning while keeping the placeholder for future cross-test sharing
  void tool;

  // ─── M81 Phase 8 — file=lesson ─────────────────────────────────────────────

  describe('file=lesson action=add', () => {
    it('writes the lesson body to disk and adds an index entry to MEMORY.md', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        {
          file: 'lesson',
          action: 'add',
          slug: 'canvas-no-move-tool',
          description: 'canvas_set_page_property only sets metadata; page hierarchy is not programmable',
          entry: '# Canvas: no page-move tool\n\n`canvas_set_page_property` only sets metadata. There is no API to reparent a page programmatically.',
        },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('canvas-no-move-tool');

      // Lesson file written
      const lesson = memory.files.get('.parallx/memory/lessons/canvas-no-move-tool.md')!;
      expect(lesson).toContain('Canvas: no page-move tool');
      expect(lesson).toContain('canvas_set_page_property');

      // MEMORY.md index entry added
      const memoryIndex = memory.files.get('.parallx/memory/MEMORY.md')!;
      expect(memoryIndex).toContain('# Memory Index');
      expect(memoryIndex).toMatch(/- \[Canvas no move tool\]\(lessons\/canvas-no-move-tool\.md\)\s+—/);
      expect(memoryIndex).toContain('canvas_set_page_property only sets metadata');
    });

    it('rejects an invalid slug (uppercase)', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'add', slug: 'BadSlug', description: 'x', entry: 'body' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('kebab-case');
    });

    it('rejects an invalid slug (special chars)', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'add', slug: 'foo_bar!', description: 'x', entry: 'body' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('kebab-case');
    });

    it('rejects an invalid slug (too long)', async () => {
      const t = createMemoryEditTool(memory);
      const longSlug = 'a'.repeat(41);
      const result = await t.handler(
        { file: 'lesson', action: 'add', slug: longSlug, description: 'x', entry: 'body' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('≤40');
    });

    it('rejects when description is missing', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'add', slug: 'foo-bar', entry: 'body' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('`description` is required');
    });

    it('rejects when entry is missing', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'add', slug: 'foo-bar', description: 'a summary' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('`entry`');
    });

    it('returns INDEX-phrased rejection when adding would exceed the 2,500-char cap', async () => {
      // Fill MEMORY.md with index lines until close to the cap.
      const t = createMemoryEditTool(memory);
      // Build a fat existing index — pad MEMORY.md to ~2480 chars, all valid index lines.
      const fillerLines: string[] = ['# Memory Index', ''];
      let total = fillerLines.join('\n').length + 1; // +1 for trailing \n
      let i = 0;
      while (total < 2480) {
        const slug = `filler-${i++}`;
        const line = `- [Filler ${i}](lessons/${slug}.md) — ${'x'.repeat(100)}`;
        fillerLines.push(line);
        total += line.length + 1;
      }
      memory.files.set('.parallx/memory/MEMORY.md', fillerLines.join('\n') + '\n');

      const result = await t.handler(
        {
          file: 'lesson',
          action: 'add',
          slug: 'one-more-lesson',
          description: 'this push should bust the index cap with the descriptive line',
          entry: 'body',
        },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('MEMORY.md INDEX');
      expect(result.content).toContain('Current index entries');
      expect(result.content).toContain("action='remove'");
      // No lesson body should have been written
      expect(memory.files.has('.parallx/memory/lessons/one-more-lesson.md')).toBe(false);
    });
  });

  describe('file=lesson action=replace', () => {
    it("returns isError when the lesson doesn't exist", async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'replace', slug: 'missing-lesson', entry: 'new body' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain("doesn't exist");
      expect(result.content).toContain('action=add');
    });

    it('overwrites the lesson body when it exists', async () => {
      memory.files.set('.parallx/memory/lessons/foo-bar.md', '# Foo\n\nold body\n');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'replace', slug: 'foo-bar', entry: '# Foo\n\nnew body' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('Replaced lessons/foo-bar.md.');
      const updated = memory.files.get('.parallx/memory/lessons/foo-bar.md')!;
      expect(updated).toContain('new body');
      expect(updated).not.toContain('old body');
    });

    it('updates index description when description is also supplied', async () => {
      memory.files.set('.parallx/memory/lessons/foo-bar.md', 'old body\n');
      // Seed an index entry so replace can update it.
      await memory.addMemoryIndexEntry('foo-bar', 'original description');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        {
          file: 'lesson',
          action: 'replace',
          slug: 'foo-bar',
          entry: 'new body',
          description: 'fresh description with new context',
        },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('updated index description');
      const index = memory.files.get('.parallx/memory/MEMORY.md')!;
      expect(index).toContain('fresh description with new context');
      expect(index).not.toContain('original description');
    });
  });

  describe('file=lesson action=remove', () => {
    it('archives the lesson file and removes the index entry', async () => {
      memory.files.set('.parallx/memory/lessons/foo-bar.md', '# Foo\n\nbody\n');
      await memory.addMemoryIndexEntry('foo-bar', 'a summary');
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'remove', slug: 'foo-bar' },
        noopToken,
      );
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('archived');
      expect(memory.files.has('.parallx/memory/lessons/foo-bar.md')).toBe(false);
      expect(memory.files.has('.parallx/memory/_archive/lessons/foo-bar.md')).toBe(true);
      // Index entry gone.
      const index = memory.files.get('.parallx/memory/MEMORY.md') ?? '';
      expect(index).not.toContain('foo-bar.md');
    });

    it('returns isError when neither file nor index entry exist', async () => {
      const t = createMemoryEditTool(memory);
      const result = await t.handler(
        { file: 'lesson', action: 'remove', slug: 'never-existed' },
        noopToken,
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });
});

// ─── memory_read name=<slug> (M81 Phase 8) ─────────────────────────────────────

describe('memory_read name=<slug> (M81 Phase 8)', () => {
  let memory: ReturnType<typeof createMemoryMock>;

  beforeEach(() => {
    memory = createMemoryMock();
  });

  it('returns the lesson body when the file exists', async () => {
    memory.files.set('.parallx/memory/lessons/canvas-no-move-tool.md', '# Canvas: no page-move tool\n\nbody\n');
    const t = createMemoryGetTool(undefined, memory);
    const result = await t.handler({ name: 'canvas-no-move-tool' }, noopToken);
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Lesson from lessons/canvas-no-move-tool.md');
    expect(result.content).toContain('Canvas: no page-move tool');
  });

  it('returns the "no lesson found" message when the file is missing', async () => {
    const t = createMemoryGetTool(undefined, memory);
    const result = await t.handler({ name: 'missing-lesson' }, noopToken);
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('No lesson found at lessons/missing-lesson.md.');
  });

  it('rejects an invalid slug', async () => {
    const t = createMemoryGetTool(undefined, memory);
    const result = await t.handler({ name: 'BadSlug' }, noopToken);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('kebab-case');
  });
});
