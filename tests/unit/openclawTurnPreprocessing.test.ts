import { describe, expect, it, vi } from 'vitest';

import {
  extractMentions,
  stripMentions,
  resolveMentions,
  resolveVariables,
  isValidWorkspaceRelativePath,
} from '../../src/openclaw/openclawTurnPreprocessing';
import type { IDefaultParticipantServices } from '../../src/openclaw/openclawTypes';

// ---------------------------------------------------------------------------
// isValidWorkspaceRelativePath
// ---------------------------------------------------------------------------

describe('isValidWorkspaceRelativePath', () => {
  it('accepts normal relative paths', () => {
    expect(isValidWorkspaceRelativePath('src/main.ts')).toBe(true);
    expect(isValidWorkspaceRelativePath('README.md')).toBe(true);
    expect(isValidWorkspaceRelativePath('docs/guide/intro.md')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidWorkspaceRelativePath('')).toBe(false);
  });

  it('rejects path traversal with ..', () => {
    expect(isValidWorkspaceRelativePath('../secret.txt')).toBe(false);
    expect(isValidWorkspaceRelativePath('foo/../../etc/passwd')).toBe(false);
    expect(isValidWorkspaceRelativePath('a/b/../../../c')).toBe(false);
  });

  it('rejects absolute paths with drive letters', () => {
    expect(isValidWorkspaceRelativePath('C:/Windows/System32/config/SAM')).toBe(false);
    expect(isValidWorkspaceRelativePath('D:/secret/file.txt')).toBe(false);
  });

  it('rejects absolute paths with leading slash', () => {
    expect(isValidWorkspaceRelativePath('/etc/passwd')).toBe(false);
    expect(isValidWorkspaceRelativePath('/usr/local/bin/node')).toBe(false);
  });

  it('handles backslash path traversal', () => {
    expect(isValidWorkspaceRelativePath('..\\secret.txt')).toBe(false);
    expect(isValidWorkspaceRelativePath('foo\\..\\..\\etc\\passwd')).toBe(false);
  });

  it('accepts paths with valid dots (not traversal)', () => {
    expect(isValidWorkspaceRelativePath('.gitignore')).toBe(true);
    expect(isValidWorkspaceRelativePath('src/.env')).toBe(true);
    expect(isValidWorkspaceRelativePath('file.test.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractMentions
// ---------------------------------------------------------------------------

describe('extractMentions', () => {
  it('extracts @file mentions', () => {
    const result = extractMentions('look at @file:src/main.ts please');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'file', path: 'src/main.ts' });
  });

  it('extracts @file mentions with quoted paths', () => {
    const result = extractMentions('check @file:"src/my file.ts"');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'file', path: 'src/my file.ts' });
  });

  it('extracts @folder mentions', () => {
    const result = extractMentions('scan @folder:src/utils');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'folder', path: 'src/utils' });
  });

  it('extracts @workspace mention', () => {
    const result = extractMentions('search @workspace for errors');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'workspace' });
  });

  it('extracts @terminal mention', () => {
    const result = extractMentions('read @terminal output');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'terminal' });
  });

  it('extracts multiple mentions', () => {
    const result = extractMentions('@file:a.ts and @file:b.ts with @workspace');
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe('file');
    expect(result[1].kind).toBe('file');
    expect(result[2].kind).toBe('workspace');
  });

  it('returns empty for text without mentions', () => {
    expect(extractMentions('just a normal question')).toEqual([]);
  });

  it('captures start and end indices', () => {
    const result = extractMentions('look at @file:test.ts here');
    expect(result[0].start).toBe(8);
    expect(result[0].end).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// stripMentions
// ---------------------------------------------------------------------------

describe('stripMentions', () => {
  it('strips mentions and collapses whitespace', () => {
    const mentions = extractMentions('look at @file:test.ts please');
    const result = stripMentions('look at @file:test.ts please', mentions);
    expect(result).toBe('look at please');
  });

  it('returns original text when no mentions', () => {
    expect(stripMentions('hello world', [])).toBe('hello world');
  });

  it('strips multiple mentions', () => {
    const text = '@file:a.ts and @file:b.ts';
    const mentions = extractMentions(text);
    const result = stripMentions(text, mentions);
    expect(result).toBe('and');
  });
});

// ---------------------------------------------------------------------------
// resolveMentions
// ---------------------------------------------------------------------------

function createMockServices(overrides: Partial<IDefaultParticipantServices> = {}): IDefaultParticipantServices {
  return {
    sendChatRequest: vi.fn() as any,
    getWorkspaceName: () => 'test-workspace',
    readFileRelative: vi.fn().mockResolvedValue('file content'),
    listFolderFiles: vi.fn().mockResolvedValue([
      { relativePath: 'src/a.ts', content: 'const a = 1;' },
    ]),
    getTerminalOutput: vi.fn().mockResolvedValue('$ npm test\nAll tests passed'),
    getCurrentPageContent: vi.fn().mockResolvedValue({
      pageId: 'page-1',
      title: 'My Page',
      textContent: 'page content here',
    }),
    ...overrides,
  };
}

describe('resolveMentions', () => {
  it('resolves @file mention to context block', async () => {
    const services = createMockServices();
    const result = await resolveMentions('read @file:test.ts', services);
    expect(result.strippedText).toBe('read');
    expect(result.contextBlocks).toHaveLength(1);
    expect(result.contextBlocks[0]).toContain('[Mentioned file: test.ts]');
    expect(result.pills).toHaveLength(1);
  });

  it('blocks path traversal in @file mention', async () => {
    const services = createMockServices();
    const result = await resolveMentions('read @file:../../etc/passwd', services);
    expect(result.contextBlocks).toHaveLength(0);
    expect(services.readFileRelative).not.toHaveBeenCalled();
  });

  it('blocks absolute path in @file mention', async () => {
    const services = createMockServices();
    const result = await resolveMentions('read @file:C:/Windows/System32/config/SAM', services);
    expect(result.contextBlocks).toHaveLength(0);
    expect(services.readFileRelative).not.toHaveBeenCalled();
  });

  it('blocks path traversal in @folder mention', async () => {
    const services = createMockServices();
    const result = await resolveMentions('scan @folder:../../secret', services);
    expect(result.contextBlocks).toHaveLength(0);
    expect(services.listFolderFiles).not.toHaveBeenCalled();
  });

  it('resolves @workspace mention to pill only', async () => {
    const services = createMockServices();
    const result = await resolveMentions('@workspace search', services);
    expect(result.pills).toHaveLength(1);
    expect(result.pills[0].label).toBe('test-workspace');
    expect(result.contextBlocks).toHaveLength(0);
  });

  it('resolves @terminal mention', async () => {
    const services = createMockServices();
    const result = await resolveMentions('show @terminal', services);
    expect(result.contextBlocks).toHaveLength(1);
    expect(result.contextBlocks[0]).toContain('[Terminal output]');
  });

  it('returns passthrough for no mentions', async () => {
    const services = createMockServices();
    const result = await resolveMentions('hello world', services);
    expect(result.strippedText).toBe('hello world');
    expect(result.contextBlocks).toEqual([]);
    expect(result.pills).toEqual([]);
  });

  it('handles readFileRelative error gracefully', async () => {
    const services = createMockServices({
      readFileRelative: vi.fn().mockRejectedValue(new Error('not found')),
    });
    const result = await resolveMentions('read @file:missing.ts', services);
    expect(result.contextBlocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveVariables
// ---------------------------------------------------------------------------

describe('resolveVariables', () => {
  it('resolves #file:path variable', async () => {
    const services = createMockServices();
    const result = await resolveVariables('check #file:src/main.ts', services);
    expect(result.strippedText).toBe('check');
    expect(result.contextBlocks).toHaveLength(1);
    expect(result.contextBlocks[0]).toContain('[Variable #file: src/main.ts]');
    expect(result.pills).toHaveLength(1);
  });

  it('resolves #file with quoted path', async () => {
    const services = createMockServices();
    const result = await resolveVariables('check #file:"my file.ts"', services);
    expect(services.readFileRelative).toHaveBeenCalledWith('my file.ts');
  });

  it('blocks path traversal in #file variable', async () => {
    const services = createMockServices();
    const result = await resolveVariables('check #file:../../secret.txt', services);
    expect(result.contextBlocks).toHaveLength(0);
    expect(services.readFileRelative).not.toHaveBeenCalled();
  });

  it('blocks absolute path in #file variable', async () => {
    const services = createMockServices();
    const result = await resolveVariables('check #file:C:/secret.txt', services);
    expect(result.contextBlocks).toHaveLength(0);
    expect(services.readFileRelative).not.toHaveBeenCalled();
  });

  it('resolves #activeFile variable', async () => {
    const services = createMockServices();
    const result = await resolveVariables('summarize #activeFile', services);
    expect(result.strippedText).toBe('summarize');
    expect(result.contextBlocks).toHaveLength(1);
    expect(result.contextBlocks[0]).toContain('Active document');
    expect(result.pills).toHaveLength(1);
  });

  it('resolves only once for multiple #activeFile', async () => {
    const services = createMockServices();
    const result = await resolveVariables('#activeFile and again #activeFile', services);
    expect(services.getCurrentPageContent).toHaveBeenCalledTimes(1);
  });

  it('returns passthrough for no variables', async () => {
    const services = createMockServices();
    const result = await resolveVariables('no variables here', services);
    expect(result.strippedText).toBe('no variables here');
    expect(result.contextBlocks).toEqual([]);
    expect(result.pills).toEqual([]);
  });
});
