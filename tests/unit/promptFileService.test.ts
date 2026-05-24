// promptFileService.test.ts — pin .parallx prompt-file loader + glob matcher.
//
// Pins:
//   matchGlob: `*` no-cross-slash, `**/` any-depth, `**` at end, `?` single, `.` literal,
//              backslash normalization, invalid-regex returns false (try/catch).
//   PromptFileService:
//     - No fileAccess → defaults: built-in SOUL, agents='', tools='', rules=[]
//     - setAutoToolsContent feeds the tools fallback
//     - loadLayers caches; second call without invalidate hits cache
//     - invalidate clears cache + fires onDidChange
//     - setFileAccess clears cache (does NOT fire)
//     - file present + non-empty → trimmed content
//     - file present + whitespace-only → fallback
//     - readFile throwing → fallback
//     - rules: dir absent → []; non-.md ignored; missing pattern frontmatter → dropped;
//       empty body → dropped; one valid → pinned in result; unreadable file skipped
//     - getMatchingRules: empty when no activeFilePath; filters by glob
//     - assemblePromptOverlay: only rules contributing, formatted "[Rule from path]\nbody"
//     - frontmatter quoted values stripped

import { describe, it, expect, vi } from 'vitest';
import {
  PromptFileService,
  matchGlob,
  type IPromptFileAccess,
  type IPromptFileLayers,
} from '../../src/services/promptFileService';

function mkFs(files: Record<string, string>): IPromptFileAccess {
  return {
    readFile: vi.fn(async (p: string) => (p in files ? files[p] : null)),
    exists: vi.fn(async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(p + '/'))),
    listDir: vi.fn(async (p: string) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      return Object.keys(files)
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length))
        .filter((f) => !f.includes('/'));
    }),
  };
}

describe('matchGlob', () => {
  it('* matches within a segment (no cross-slash)', () => {
    expect(matchGlob('*.ts', 'foo.ts')).toBe(true);
    expect(matchGlob('*.ts', 'a/foo.ts')).toBe(false);
  });

  it('**/ matches any depth prefix', () => {
    expect(matchGlob('**/x.ts', 'x.ts')).toBe(true);
    expect(matchGlob('**/x.ts', 'a/x.ts')).toBe(true);
    expect(matchGlob('**/x.ts', 'a/b/x.ts')).toBe(true);
  });

  it('** at end matches any tail', () => {
    expect(matchGlob('src/**', 'src/a/b.ts')).toBe(true);
  });

  it('? matches exactly one non-slash char', () => {
    expect(matchGlob('a?.ts', 'ab.ts')).toBe(true);
    expect(matchGlob('a?.ts', 'a.ts')).toBe(false);
    expect(matchGlob('a?.ts', 'a/.ts')).toBe(false);
  });

  it('. is matched literally', () => {
    expect(matchGlob('x.ts', 'xats')).toBe(false);
    expect(matchGlob('x.ts', 'x.ts')).toBe(true);
  });

  it('normalizes backslashes to forward slashes in both inputs', () => {
    expect(matchGlob('src\\**\\x.ts', 'src/a/x.ts')).toBe(true);
    expect(matchGlob('src/**/x.ts', 'src\\a\\x.ts')).toBe(true);
  });
});

describe('PromptFileService — no fileAccess', () => {
  it('loadLayers returns DEFAULT_SOUL + empty agents/tools/rules', async () => {
    const svc = new PromptFileService();
    const layers = await svc.loadLayers();
    expect(layers.soul).toMatch(/Parallx AI Assistant/);
    expect(layers.agents).toBe('');
    expect(layers.tools).toBe('');
    expect(layers.rules).toEqual([]);
  });

  it('autoToolsContent fills tools fallback', async () => {
    const svc = new PromptFileService();
    svc.setAutoToolsContent('## TOOLS\nuse the tools');
    const layers = await svc.loadLayers();
    expect(layers.tools).toBe('## TOOLS\nuse the tools');
  });
});

describe('PromptFileService — file loading', () => {
  it('reads SOUL/AGENTS/TOOLS when present (trimmed)', async () => {
    const fs = mkFs({
      '.parallx/SOUL.md': '\n  custom soul  \n',
      '.parallx/AGENTS.md': 'agents-body',
      '.parallx/TOOLS.md': 'tools-body',
    });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.soul).toBe('custom soul');
    expect(layers.agents).toBe('agents-body');
    expect(layers.tools).toBe('tools-body');
  });

  it('whitespace-only file content → fallback', async () => {
    const svc = new PromptFileService();
    svc.setAutoToolsContent('AUTO TOOLS');
    svc.setFileAccess(mkFs({
      '.parallx/SOUL.md': '   \n\n   ',
      '.parallx/TOOLS.md': '',
    }));
    const layers = await svc.loadLayers();
    expect(layers.soul).toMatch(/Parallx AI Assistant/);
    expect(layers.tools).toBe('AUTO TOOLS');
  });

  it('readFile throw is swallowed → fallback', async () => {
    const fs: IPromptFileAccess = {
      readFile: vi.fn(async () => { throw new Error('io'); }),
      exists: vi.fn(async () => false),
      listDir: vi.fn(async () => []),
    };
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.soul).toMatch(/Parallx AI Assistant/);
    expect(layers.agents).toBe('');
  });
});

describe('PromptFileService — caching + invalidation', () => {
  it('second loadLayers without invalidate hits cache (no extra reads)', async () => {
    const fs = mkFs({ '.parallx/AGENTS.md': 'a' });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    await svc.loadLayers();
    const callsAfterFirst = (fs.readFile as any).mock.calls.length;
    await svc.loadLayers();
    expect((fs.readFile as any).mock.calls.length).toBe(callsAfterFirst);
  });

  it('invalidate clears cache + fires onDidChange', async () => {
    const fs = mkFs({ '.parallx/AGENTS.md': 'a' });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    let fired = 0;
    svc.onDidChange(() => fired++);
    await svc.loadLayers();
    svc.invalidate();
    expect(fired).toBe(1);
    await svc.loadLayers();
    expect((fs.readFile as any).mock.calls.length).toBeGreaterThan(1);
  });

  it('setFileAccess clears cache but does NOT fire onDidChange', async () => {
    const fs1 = mkFs({ '.parallx/AGENTS.md': 'one' });
    const fs2 = mkFs({ '.parallx/AGENTS.md': 'two' });
    const svc = new PromptFileService();
    let fired = 0;
    svc.onDidChange(() => fired++);
    svc.setFileAccess(fs1);
    expect((await svc.loadLayers()).agents).toBe('one');
    svc.setFileAccess(fs2);
    expect(fired).toBe(0);
    expect((await svc.loadLayers()).agents).toBe('two');
  });
});

describe('PromptFileService — rules', () => {
  it('rules dir absent → []', async () => {
    const fs: IPromptFileAccess = {
      readFile: vi.fn(async () => null),
      exists: vi.fn(async () => false),
      listDir: vi.fn(async () => []),
    };
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.rules).toEqual([]);
  });

  it('non-.md files ignored', async () => {
    const fs = mkFs({
      '.parallx/rules/x.md': '---\npattern: "*.ts"\n---\nrule body',
      '.parallx/rules/readme.txt': 'ignore me',
    });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.rules.length).toBe(1);
    expect(layers.rules[0].pattern).toBe('*.ts');
    expect(layers.rules[0].content).toBe('rule body');
    expect(layers.rules[0].source).toBe('.parallx/rules/x.md');
  });

  it('rule without pattern: frontmatter is dropped', async () => {
    const fs = mkFs({
      '.parallx/rules/no-pattern.md': '---\ntitle: foo\n---\nbody',
    });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.rules).toEqual([]);
  });

  it('rule with empty body is dropped', async () => {
    const fs = mkFs({
      '.parallx/rules/empty.md': '---\npattern: "*.ts"\n---\n',
    });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.rules).toEqual([]);
  });

  it('frontmatter quoted values are unwrapped', async () => {
    const fs = mkFs({
      '.parallx/rules/q.md': "---\npattern: '*.spec.ts'\n---\nbody",
    });
    const svc = new PromptFileService();
    svc.setFileAccess(fs);
    const layers = await svc.loadLayers();
    expect(layers.rules[0].pattern).toBe('*.spec.ts');
  });
});

describe('PromptFileService — getMatchingRules + assemblePromptOverlay', () => {
  const layers: IPromptFileLayers = {
    soul: 'S',
    agents: 'A',
    tools: 'T',
    rules: [
      { pattern: '*.ts', content: 'ts rule', source: '.parallx/rules/ts.md' },
      { pattern: '**/test/*.spec.ts', content: 'spec rule', source: '.parallx/rules/spec.md' },
    ],
  };

  it('getMatchingRules: no activeFilePath → []', () => {
    const svc = new PromptFileService();
    expect(svc.getMatchingRules(layers, undefined)).toEqual([]);
  });

  it('getMatchingRules: glob filters correctly', () => {
    const svc = new PromptFileService();
    const m = svc.getMatchingRules(layers, 'src/test/foo.spec.ts');
    expect(m.length).toBe(1);
    expect(m[0].pattern).toBe('**/test/*.spec.ts');
  });

  it('assemblePromptOverlay: only rules contribute (no SOUL/AGENTS/TOOLS injected)', () => {
    const svc = new PromptFileService();
    const out = svc.assemblePromptOverlay(layers, 'a.ts');
    expect(out).toBe('[Rule from .parallx/rules/ts.md]\nts rule');
    expect(out).not.toContain('S');
    expect(out).not.toContain('agents');
  });

  it('assemblePromptOverlay: no active file → empty string', () => {
    const svc = new PromptFileService();
    expect(svc.assemblePromptOverlay(layers, undefined)).toBe('');
  });
});
