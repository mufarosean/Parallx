// copyDiagnostics.test.ts — Help › Copy Diagnostics: the recent-error log,
// the scrubber that keeps paths and keys out of a bug report, and the report.
import { describe, expect, it } from 'vitest';
import {
  RecentErrorLog,
  describeArgs,
  installRecentErrorCapture,
  scrubForReport,
  scrubSensitive,
  type RecentErrorCaptureTarget,
} from '../../src/platform/recentErrors';
import { formatDiagnosticsReport, type DiagnosticsSnapshot } from '../../src/commands/diagnosticsReport';
import { ALL_BUILTIN_COMMANDS } from '../../src/commands/structuralCommands';

describe('scrubSensitive', () => {
  it('keeps only the basename of absolute paths', () => {
    expect(scrubSensitive('ENOENT: no such file, open /home/ana/notes/secret plan.md')).toBe('ENOENT: no such file, open <path>/secret plan.md');
    expect(scrubSensitive("failed to read '/Users/ana/Work/My Docs/a.pdf'")).toBe("failed to read '<path>/a.pdf'");
    expect(scrubSensitive('open C:\\Users\\Ana Smith\\Documents\\b.docx failed')).toBe('open <path>/b.docx failed');
    expect(scrubSensitive('path=D:/data/x/y.json')).toBe('path=<path>/y.json');
    expect(scrubSensitive('share \\\\nas\\private\\c.txt')).toBe('share <path>/c.txt');
    expect(scrubSensitive('see ~/projects/d.md')).toBe('see <path>/d.md');
  });

  it('turns a home folder itself into <home>, never the user name', () => {
    expect(scrubSensitive('cwd /home/ana')).toBe('cwd <home>');
    expect(scrubSensitive('cwd C:\\Users\\ana')).toBe('cwd <home>');
    expect(scrubSensitive('cwd /Users/ana/')).toBe('cwd <home>');
  });

  it('scrubs file:// URLs in stack frames, keeping line and column', () => {
    expect(scrubSensitive('at run (file:///C:/Users/ana/Parallx/dist/renderer/main.js:12:5)'))
      .toBe('at run (<path>/main.js:12:5)');
    expect(scrubSensitive('at file:///opt/parallx/app/x.js:1:2')).toBe('at <path>/x.js:1:2');
  });

  it('replaces known folders with whatever follows them', () => {
    const known = ['/srv/ws/Private Clients'];
    expect(scrubSensitive('indexing /srv/ws/Private Clients/acme/q3.md failed', known)).toBe('indexing <path>/q3.md failed');
    expect(scrubSensitive('root is /srv/ws/Private Clients', known)).toBe('root is <path>');
    expect(scrubSensitive('E:\\Vault\\Notes\\x.md', ['E:\\Vault'])).toBe('<path>/x.md');
  });

  it('leaves web URLs, relative paths and ordinary text alone', () => {
    expect(scrubSensitive('POST http://localhost:11434/api/chat 500')).toBe('POST http://localhost:11434/api/chat 500');
    expect(scrubSensitive('chunk 3/4 of notes/a.md, ratio 1/2')).toBe('chunk 3/4 of notes/a.md, ratio 1/2');
    expect(scrubSensitive('TypeError: x is undefined')).toBe('TypeError: x is undefined');
  });

  it('hides keys and tokens', () => {
    expect(scrubSensitive('401 with api_key=abc123def')).toBe('401 with api_key=<hidden>');
    expect(scrubSensitive('Authorization: Bearer eyJhbGciOi.abc.def')).toContain('Bearer <hidden>');
    expect(scrubSensitive('Authorization: Bearer eyJhbGciOi.abc.def')).not.toContain('eyJ');
    expect(scrubSensitive('key sk-ant-api03-ABCDEFGHIJKLMNOP rejected')).toBe('key <key> rejected');
    expect(scrubSensitive('{"password": "hunter2"}')).not.toContain('hunter2');
    expect(scrubSensitive('max tokens: 512')).toBe('max tokens: 512');
  });

  it('shortens after scrubbing', () => {
    const long = `boom /home/ana/a/${'x'.repeat(50)}.md ${'y'.repeat(400)}`;
    const out = scrubForReport(long);
    expect(out.length).toBe(300);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('ana');
  });
});

describe('RecentErrorLog', () => {
  it('is bounded, drops warnings before errors, and counts repeats', () => {
    let t = 1000;
    const log = new RecentErrorLog(3, () => t);
    log.record('warn', 'w1');
    log.record('error', 'e1');
    t += 500;
    log.record('error', 'e1');
    log.record('error', 'e2');
    log.record('rejection', 'r1');
    const entries = log.entries();
    expect(entries.map((e) => e.message)).toEqual(['e1', 'e2', 'r1']);
    expect(entries[0].count).toBe(2);
    expect(entries[0].atMs).toBe(500);
    log.record('warn', 'w2');
    expect(log.entries().map((e) => e.message)).toEqual(['e2', 'r1', 'w2']);
  });

  it('describes console arguments without serialising objects', () => {
    expect(describeArgs(['[X] failed:', new TypeError('bad'), { pageText: 'private' }, [1], 3])).toBe('[X] failed: TypeError: bad {…} […] 3');
  });

  it('captures console.error, console.warn, uncaught errors and rejections', () => {
    const printed: unknown[][] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const target = {
      console: { error: (...a: unknown[]) => printed.push(a), warn: (...a: unknown[]) => printed.push(a) },
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    } as unknown as RecentErrorCaptureTarget;
    const log = new RecentErrorLog(20, () => 0);
    installRecentErrorCapture(target, log);
    installRecentErrorCapture(target, log); // twice is once
    target.console.error('oops', 1);
    target.console.warn('careful');
    listeners.error({ error: new RangeError('too far'), filename: 'file:///a/b.js', lineno: 7 });
    listeners.unhandledrejection({ reason: new Error('nope') });
    expect(printed).toEqual([['oops', 1], ['careful']]);
    expect(log.entries().map((e) => `${e.level}:${e.message}`)).toEqual([
      'error:oops 1',
      'warn:careful',
      'uncaught:RangeError: too far (file:///a/b.js:7)',
      'rejection:Error: nope',
    ]);
  });
});

describe('formatDiagnosticsReport', () => {
  const snapshot: DiagnosticsSnapshot = {
    app: { version: '1.2.3', electron: '33.0.0', chrome: '130.0.1', node: '20.18.0', platform: 'win32', osRelease: '10.0.22631', arch: 'x64', screenScale: 1.5, textSize: 1 },
    workspaceFolderCount: 2,
    tools: [
      { name: 'Zeta', version: '0.2.0', enabled: false, builtin: false },
      { name: 'Alpha', version: '1.0.0', enabled: true, builtin: true },
    ],
    ai: { provider: 'Local Engine', model: 'model-a:8b', contextSetting: 0, modelContextLength: 32768, index: { kind: 'ready', sources: 12, chunks: 340 } },
    errors: [{ level: 'error', message: 'read failed C:\\Users\\ana\\ws\\a.md', atMs: 12400, count: 3 }],
  };

  it('prints versions, tools, AI and scrubbed errors', () => {
    const text = formatDiagnosticsReport(snapshot);
    expect(text).toContain('- Parallx 1.2.3');
    expect(text).toContain('- Electron 33.0.0, Chromium 130.0.1, Node 20.18.0');
    expect(text).toContain('- OS: Windows 10.0.22631, x64');
    expect(text).toContain('- Display: screen scale 150%, text size 100%');
    expect(text).toContain('- Folders: 2 (names hidden)');
    expect(text).toContain('### Tools (2 installed, 1 on)\n- Alpha 1.0.0: on\n- Zeta 0.2.0: off (installed)');
    expect(text).toContain('- Provider: Local Engine');
    expect(text).toContain("- Context size setting: the model's own (model reports 32768)");
    expect(text).toContain('- Retrieval index: ready, 12 sources, 340 chunks');
    expect(text).toContain('- +12.4s error (×3): read failed <path>/a.md');
    expect(text).not.toContain('ana');
  });

  it('says plainly when there is nothing', () => {
    const text = formatDiagnosticsReport({ ...snapshot, tools: [], errors: [], workspaceFolderCount: 0, ai: { index: { kind: 'none' } } });
    expect(text).toContain('- None registered');
    expect(text).toContain('- None since start');
    expect(text).toContain('- Folders: 0\n');
    expect(text).toContain('- Model: none selected');
    expect(text).toContain('- Context size setting: unknown');
  });
});

describe('Copy Diagnostics command', () => {
  it('is a built-in command under Help', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find((c) => c.id === 'workbench.action.copyDiagnostics');
    expect(cmd?.title).toBe('Copy Diagnostics');
    expect(cmd?.category).toBe('Help');
  });
});
