// chunkingService.test.ts — Unit tests for ChunkingService (M10 Task 1.3)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChunkingService } from '../../src/services/chunkingService.js';
import { buildContextPrefix, extractTextFromBlock, hashText } from '../../src/services/chunkingService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a TipTap doc with the given blocks. */
function makeTipTapDoc(blocks: Record<string, unknown>[]) {
  return JSON.stringify({
    schemaVersion: 2,
    doc: { type: 'doc', content: blocks },
  });
}

/** Build a heading block. */
function heading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

/** Build a paragraph block. */
function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** Build a code block. */
function codeBlock(code: string, language = '') {
  return {
    type: 'codeBlock',
    attrs: { language },
    content: [{ type: 'text', text: code }],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(() => {
    service = new ChunkingService();
  });

  afterEach(() => {
    service.dispose();
  });

  // ── Canvas Page Chunking ──

  describe('chunkPage()', () => {
    it('chunks a simple page into a single chunk', async () => {
      const content = makeTipTapDoc([
        heading(1, 'My Page Title'),
        paragraph('This is some content about the topic.'),
      ]);

      const chunks = await service.chunkPage('page-123', 'My Page', content);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].sourceType).toBe('page_block');
      expect(chunks[0].sourceId).toBe('page-123');
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].text).toContain('My Page Title');
      expect(chunks[0].text).toContain('some content about the topic');
      expect(chunks[0].contentHash).toHaveLength(64); // SHA-256 hex
    });

    it('creates separate chunks at heading boundaries', async () => {
      const content = makeTipTapDoc([
        heading(1, 'Introduction'),
        paragraph('This is the introduction section with enough content to be meaningful.'),
        paragraph('More introduction text that provides additional context and detail about the topic.'),
        heading(2, 'Methods'),
        paragraph('This section describes the methods used in our research and analysis.'),
        paragraph('We used a combination of quantitative and qualitative approaches.'),
      ]);

      const chunks = await service.chunkPage('page-456', 'Research Paper', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // First chunk should have Introduction content
      expect(chunks[0].text).toContain('Introduction');
      expect(chunks[0].text).toContain('introduction section');

      // Second chunk should have Methods content
      const methodsChunk = chunks.find((c) => c.text.includes('Methods'));
      expect(methodsChunk).toBeDefined();
      expect(methodsChunk!.text).toContain('methods used');
    });

    it('includes context prefix with page title and heading', async () => {
      const content = makeTipTapDoc([
        heading(1, 'Architecture'),
        paragraph('The system uses microservices for scalability and maintainability.'),
        paragraph('Each service communicates via event-driven messaging patterns.'),
      ]);

      const chunks = await service.chunkPage('page-789', 'Backend Design', content);
      expect(chunks[0].contextPrefix).toContain('Backend Design');
      expect(chunks[0].contextPrefix).toContain('Architecture');
    });

    it('returns empty array for empty content', async () => {
      const chunks = await service.chunkPage('page-000', 'Empty Page', '{}');
      expect(chunks).toHaveLength(0);
    });

    it('returns empty array for null/empty string', async () => {
      const chunks = await service.chunkPage('page-000', 'Empty', '');
      expect(chunks).toHaveLength(0);
    });

    it('handles raw doc format (no envelope)', async () => {
      const content = JSON.stringify({
        type: 'doc',
        content: [paragraph('Hello from legacy format with enough text to pass minimum.')],
      });

      const chunks = await service.chunkPage('page-legacy', 'Legacy', content);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].text).toContain('Hello from legacy format');
    });

    it('handles code blocks with language tags', async () => {
      const content = makeTipTapDoc([
        heading(1, 'Setup'),
        paragraph('Install the package first. This guide shows how to get started quickly.'),
        codeBlock('npm install express', 'bash'),
      ]);

      const chunks = await service.chunkPage('page-code', 'Getting Started', content);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Code block text should appear in a chunk
      const codeChunk = chunks.find((c) => c.text.includes('npm install'));
      expect(codeChunk).toBeDefined();
    });

    it('generates unique content hashes per chunk', async () => {
      const content = makeTipTapDoc([
        heading(1, 'Section A'),
        paragraph('Content for section A with enough text to form a proper meaningful chunk.'),
        heading(2, 'Section B'),
        paragraph('Content for section B with different text that should hash differently.'),
      ]);

      const chunks = await service.chunkPage('page-hash', 'Hash Test', content);
      if (chunks.length >= 2) {
        expect(chunks[0].contentHash).not.toBe(chunks[1].contentHash);
      }
    });

    it('carries overlap on size-limit flushes within a page section', async () => {
      // Build a page with many paragraph blocks under one heading that exceed MAX_CHUNK_CHARS (1024)
      const blocks = [heading(1, 'Long Section')];
      for (let i = 0; i < 10; i++) {
        blocks.push(paragraph('This is a substantial paragraph with plenty of text to fill up space. '.repeat(3)));
      }
      const content = makeTipTapDoc(blocks);

      const chunks = await service.chunkPage('page-overlap', 'Overlap Test', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // The tail of chunk 0 should appear at the start of chunk 1 (overlap)
      const tail = chunks[0].text.slice(-80);
      expect(chunks[1].text).toContain(tail);
    });

    it('does NOT carry overlap at heading boundaries in a page', async () => {
      const content = makeTipTapDoc([
        heading(1, 'First Section'),
        paragraph('Content for the first section that is meaningful and complete. '.repeat(5)),
        heading(2, 'Second Section'),
        paragraph('Content for the second section that is also meaningful and has its own substance. '.repeat(5)),
      ]);

      const chunks = await service.chunkPage('page-no-overlap', 'Heading Test', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // The second chunk should start with the heading text, not overlap from chunk 0
      const secondChunk = chunks.find(c => c.text.includes('Second Section'));
      expect(secondChunk).toBeDefined();
      expect(secondChunk!.text).toMatch(/^Second Section/);
    });
  });

  // ── File Chunking ──

  describe('chunkFile()', () => {
    it('chunks a markdown file by headings', async () => {
      const md = [
        '# Overview',
        'This is the overview section with descriptive content about the project goal.',
        'It spans multiple lines to provide adequate chunking material.',
        '',
        '## Details',
        'This is the details section with specific implementation information.',
        'It also has multiple lines for proper chunking boundaries.',
      ].join('\n');

      const chunks = await service.chunkFile('README.md', md, 'markdown');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].sourceType).toBe('file_chunk');
      expect(chunks[0].sourceId).toBe('README.md');
    });

    it('detects markdown by file extension', async () => {
      const md = '# Title\nSome content with enough text for a proper chunk.';
      const chunks = await service.chunkFile('docs/guide.md', md);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].contextPrefix).toContain('docs/guide.md');
    });

    it('chunks plain text by paragraph', async () => {
      const text = 'First paragraph with enough content to be meaningful.\n\nSecond paragraph with more text that adds context.';
      const chunks = await service.chunkFile('notes.txt', text);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].sourceType).toBe('file_chunk');
    });

    it('returns empty for empty content', async () => {
      const chunks = await service.chunkFile('empty.md', '');
      expect(chunks).toHaveLength(0);
    });

    it('includes language in context prefix for code files', async () => {
      const code = 'function hello() { return "world"; }\n'.repeat(5);
      const chunks = await service.chunkFile('app.ts', code, 'typescript');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].contextPrefix).toContain('typescript');
    });
  });

  // ── Helper Functions ──

  describe('buildContextPrefix()', () => {
    it('builds prefix with source only', () => {
      const prefix = buildContextPrefix('My Page');
      expect(prefix).toBe('[Source: "My Page"]');
    });

    it('includes section when provided', () => {
      const prefix = buildContextPrefix('My Page', 'Auth Section');
      expect(prefix).toBe('[Source: "My Page" | Section: "Auth Section"]');
    });

    it('includes type when not paragraph', () => {
      const prefix = buildContextPrefix('My Page', undefined, 'codeBlock');
      expect(prefix).toBe('[Source: "My Page" | Type: codeBlock]');
    });

    it('omits type for paragraph nodes', () => {
      const prefix = buildContextPrefix('My Page', undefined, 'paragraph');
      expect(prefix).toBe('[Source: "My Page"]');
    });

    it('includes all parts when present', () => {
      const prefix = buildContextPrefix('Backend Design', 'API Layer', 'codeBlock');
      expect(prefix).toBe('[Source: "Backend Design" | Section: "API Layer" | Type: codeBlock]');
    });
  });

  describe('extractTextFromBlock()', () => {
    it('extracts text from paragraph', () => {
      const text = extractTextFromBlock({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello world' }],
      });
      expect(text).toBe('Hello world');
    });

    it('extracts text from heading', () => {
      const text = extractTextFromBlock({
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'My Title' }],
      });
      expect(text).toBe('My Title');
    });

    it('returns empty for image blocks', () => {
      const text = extractTextFromBlock({
        type: 'image',
        attrs: { src: 'photo.jpg' },
      });
      expect(text).toBe('');
    });

    it('extracts code with language tag', () => {
      const text = extractTextFromBlock({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      });
      expect(text).toContain('typescript');
      expect(text).toContain('const x = 1;');
    });

    it('handles nested bullet lists', () => {
      const text = extractTextFromBlock({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Item one' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Item two' }] },
            ],
          },
        ],
      });
      expect(text).toContain('Item one');
      expect(text).toContain('Item two');
    });
  });

  describe('hashText()', () => {
    it('produces consistent 64-char hex hash', async () => {
      const hash = await hashText('Hello world');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      // Same input = same hash
      const hash2 = await hashText('Hello world');
      expect(hash2).toBe(hash);
    });

    it('produces different hashes for different inputs', async () => {
      const hash1 = await hashText('Hello');
      const hash2 = await hashText('World');
      expect(hash1).not.toBe(hash2);
    });
  });

  // ── Chunk Overlap ──

  describe('chunk overlap for files', () => {
    it('carries overlap text between consecutive plain text chunks', async () => {
      // Build content that exceeds MAX_CHUNK_CHARS (1024) to force a split
      const line = 'ABCDEFGHIJ'.repeat(10) + '\n'; // 101 chars per line
      const content = line.repeat(15); // ~1515 chars → should produce 2 chunks

      const chunks = await service.chunkFile('test.txt', content);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // The tail of chunk 0 should appear at the start of chunk 1 (overlap)
      const tail = chunks[0].text.slice(-100);
      expect(chunks[1].text).toContain(tail);
    });

    it('carries overlap text between consecutive markdown chunks', async () => {
      // Build a long section under one heading to trigger size-based flush
      const longLine = 'Lorem ipsum dolor sit amet. '.repeat(10) + '\n'; // ~280 chars
      const content = '# Section\n' + longLine.repeat(6); // ~1680 chars under one heading

      const chunks = await service.chunkFile('test.md', content, 'markdown');
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // The tail of chunk 0 should appear at the start of chunk 1 (overlap)
      const tail = chunks[0].text.slice(-100);
      expect(chunks[1].text).toContain(tail);
    });

    it('does NOT carry overlap at heading boundaries in markdown', async () => {
      // Two sections each fitting in a single chunk — heading = clean break
      const sectionContent = 'Content line.\n'.repeat(10);
      const content = `# Section One\n${sectionContent}\n# Section Two\n${sectionContent}`;

      const chunks = await service.chunkFile('test.md', content, 'markdown');
      expect(chunks.length).toBe(2);

      // The start of chunk 1 should be the heading, not overlap from chunk 0
      expect(chunks[1].text).toMatch(/^# Section Two/);
    });
  });

  // ── D.1: Table-aware chunk boundaries ──

  describe('table-aware chunking (D.1)', () => {
    it('keeps a small table in a single chunk', async () => {
      const table = [
        '| Name | Age |',
        '|------|-----|',
        '| Alice | 30 |',
        '| Bob | 25 |',
      ].join('\n');
      const content = `# People\n\n${table}\n\n# Other`;
      const chunks = await service.chunkFile('data.md', content, 'markdown');

      // Table should stay intact in one chunk
      const tableChunk = chunks.find(c => c.text.includes('| Name'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk!.text).toContain('| Alice');
      expect(tableChunk!.text).toContain('| Bob');
    });

    it('keeps medium table (< 2× max) as single chunk', async () => {
      // Build a table with enough rows to exceed MAX_CHUNK_CHARS (1024) but under 2048
      const header = '| Col A | Col B | Col C |';
      const sep = '|-------|-------|-------|';
      const rows = Array.from({ length: 30 }, (_, i) => `| Row${i} data item | More data here | Even more ${i} |`);
      const table = [header, sep, ...rows].join('\n');
      expect(table.length).toBeGreaterThan(1024);
      expect(table.length).toBeLessThan(2048);

      const chunks = await service.chunkFile('report.md', table, 'markdown');

      // Entire table in one chunk since < 2× max
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain('| Col A');
      expect(chunks[0].text).toContain(rows[rows.length - 1]);
    });

    it('splits very large table at row boundaries with header prefix', async () => {
      const header = '| ID | Name | Description |';
      const sep = '|----|------|-------------|';
      // Make enough rows to exceed 2× max (2048 chars)
      const rows = Array.from({ length: 100 }, (_, i) =>
        `| ${i} | Item_${i}_name | This is a longer description for row number ${i} in the table |`,
      );
      const table = [header, sep, ...rows].join('\n');
      expect(table.length).toBeGreaterThan(2048);

      const chunks = await service.chunkFile('big-table.md', table, 'markdown');

      // Should be split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should start with the table header (for context)
      for (const chunk of chunks) {
        expect(chunk.text).toContain('| ID | Name | Description |');
      }

      // No chunk should split mid-row (each | line should be complete)
      for (const chunk of chunks) {
        for (const line of chunk.text.split('\n')) {
          if (line.startsWith('|')) {
            expect(line).toMatch(/\|$/); // line ends with |
          }
        }
      }
    });

    it('table preceded by heading gets correct contextPrefix', async () => {
      const content = `# Results\n\n| A | B |\n|---|---|\n| 1 | 2 |`;
      const chunks = await service.chunkFile('report.md', content, 'markdown');

      const tableChunk = chunks.find(c => c.text.includes('| A | B |'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk!.contextPrefix).toContain('Results');
    });
  });

  // ── D.2: Code block integrity ──

  describe('code block integrity (D.2)', () => {
    it('keeps a small code block in a single chunk', async () => {
      const content = [
        '# Setup',
        '',
        '```python',
        'def hello():',
        '    print("Hello, world!")',
        '```',
        '',
        '# Usage',
      ].join('\n');

      const chunks = await service.chunkFile('guide.md', content, 'markdown');
      const codeChunk = chunks.find(c => c.text.includes('def hello'));
      expect(codeChunk).toBeDefined();
      expect(codeChunk!.text).toContain('```python');
      expect(codeChunk!.text).toContain('```');
    });

    it('keeps medium code block (< 2× max) as single chunk', async () => {
      const codeLines = Array.from({ length: 40 }, (_, i) => `  const item_${i} = compute(${i}); // line ${i}`);
      const content = [
        '```typescript',
        ...codeLines,
        '```',
      ].join('\n');
      expect(content.length).toBeGreaterThan(1024);
      expect(content.length).toBeLessThan(2048);

      const chunks = await service.chunkFile('big-fn.md', content, 'markdown');
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toContain('```typescript');
      expect(chunks[0].text.endsWith('```')).toBe(true);
    });

    it('splits very large code block preserving fence markers', async () => {
      const codeLines = Array.from({ length: 100 }, (_, i) => `  const item_${i} = compute(${i}); // detailed line ${i} with longer text`);
      const content = [
        '```javascript',
        ...codeLines,
        '```',
      ].join('\n');
      expect(content.length).toBeGreaterThan(2048);

      const chunks = await service.chunkFile('huge-fn.md', content, 'markdown');
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be properly fenced
      for (const chunk of chunks) {
        expect(chunk.text).toContain('```javascript');
        expect(chunk.text.trimEnd().endsWith('```')).toBe(true);
      }
    });

    it('code block preceded by heading gets correct contextPrefix', async () => {
      const content = [
        '# Installation',
        '',
        '```bash',
        'pip install docling',
        '```',
      ].join('\n');

      const chunks = await service.chunkFile('setup.md', content, 'markdown');
      const codeChunk = chunks.find(c => c.text.includes('pip install'));
      expect(codeChunk).toBeDefined();
      expect(codeChunk!.contextPrefix).toContain('Installation');
    });
  });
});
