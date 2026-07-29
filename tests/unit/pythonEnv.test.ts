// pythonEnv.test.ts — per-workspace Python runtime (M94).
//
// Two layers, both covering the parts that actually hold a boundary:
//
//   1. electron/pythonBridge.cjs — containment. Path validation, package
//      specifier validation, and the rebuilt child environment. These are the
//      checks a malformed or hostile input has to get past, so they are tested
//      against the real module rather than a mock.
//
//   2. parallxIgnore — the machinery/content split. A venv must be invisible
//      to the indexer and the AI file tools; scripts and outputs must stay
//      fully visible. Both directions are asserted, because an over-broad
//      ignore rule that hides the user's own scripts is as much a bug as one
//      that indexes site-packages.

import { describe, it, expect } from 'vitest';
import path from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { createParallxIgnore, WATCH_IGNORE_SEGMENTS } from '../../src/services/parallxIgnore.js';

const require = createRequire(import.meta.url);
// Plain CommonJS with no Electron imports at module scope, so it loads under
// vitest exactly as it does in the main process.
const pythonBridge = require('../../electron/pythonBridge.cjs');

const WS = process.platform === 'win32' ? 'C:\\work\\ws' : '/work/ws';

// ── Package specifier validation ────────────────────────────────────────────

describe('validatePackages', () => {
  it('accepts plain names, extras, and version constraints', () => {
    const ok = ['pandas', 'openpyxl==3.1.2', 'numpy>=1.20', 'httpx[cli]', 'ruamel.yaml', 'a-b_c'];
    for (const spec of ok) {
      expect(pythonBridge.validatePackages([spec]), spec).toMatchObject({ ok: true });
    }
  });

  it('rejects pip flags that would change where code comes from', () => {
    // Each of these turns "install a package" into "fetch and execute code
    // from a source the user did not choose".
    const bad = [
      '--index-url=http://evil.test/simple',
      '-e .',
      '--editable=.',
      '-r requirements.txt',
      '--pre',
    ];
    for (const spec of bad) {
      expect(pythonBridge.validatePackages([spec]), spec).toMatchObject({ ok: false });
    }
  });

  it('rejects paths, URLs, and VCS specifiers', () => {
    const bad = [
      '.',
      './local-package',
      '../escape',
      '/etc/passwd',
      'C:\\Windows\\System32',
      'https://evil.test/pkg.tar.gz',
      'git+https://github.com/x/y.git',
      'file:///tmp/pkg',
    ];
    for (const spec of bad) {
      expect(pythonBridge.validatePackages([spec]), spec).toMatchObject({ ok: false });
    }
  });

  it('rejects a second argument smuggled in behind whitespace', () => {
    // The specifier list becomes argv. A value containing a space must not
    // silently become two arguments.
    expect(pythonBridge.validatePackages(['pandas --index-url http://evil.test'])).toMatchObject({ ok: false });
    expect(pythonBridge.validatePackages(['pandas\n--pre'])).toMatchObject({ ok: false });
  });

  it('rejects an empty list', () => {
    expect(pythonBridge.validatePackages([])).toMatchObject({ ok: false });
    expect(pythonBridge.validatePackages(null)).toMatchObject({ ok: false });
  });

  it('reports the offending specifier so the failure is actionable', () => {
    const res = pythonBridge.validatePackages(['pandas', '--pre']);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('--pre');
  });
});

// ── Script path validation ──────────────────────────────────────────────────

describe('validateScriptPath', () => {
  it('rejects a path that escapes the workspace', () => {
    const res = pythonBridge.validateScriptPath(WS, '../../etc/evil.py');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('outside the workspace');
  });

  it('rejects an absolute path outside the workspace', () => {
    const outside = process.platform === 'win32' ? 'C:\\other\\x.py' : '/other/x.py';
    expect(pythonBridge.validateScriptPath(WS, outside)).toMatchObject({ ok: false });
  });

  it('rejects a script inside the environment directory', () => {
    // site-packages is machinery. A "script" in there is a traversal attempt,
    // not something the user wrote.
    const res = pythonBridge.validateScriptPath(WS, path.join('.parallx', 'venv', 'evil.py'));
    expect(res.ok).toBe(false);
    expect(res.message).toContain('environment directory');
  });

  it('rejects non-.py files', () => {
    const res = pythonBridge.validateScriptPath(WS, 'scripts/run.sh');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('.py');
  });

  it('rejects an empty path', () => {
    expect(pythonBridge.validateScriptPath(WS, '')).toMatchObject({ ok: false });
    expect(pythonBridge.validateScriptPath(WS, undefined)).toMatchObject({ ok: false });
  });

  it('reaches the existence check for a well-formed in-workspace path', () => {
    // The file does not exist here, which is the LAST check — proving the
    // path/extension/containment gates all passed.
    const res = pythonBridge.validateScriptPath(WS, 'scripts/ok.py');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('not found');
  });
});

// ── Interpreter detection ───────────────────────────────────────────────────

describe('detectSystemPython', () => {
  // Regression guard. Detection runs with the parent's inherited PATH, but
  // every later spawn runs with buildChildEnv's deliberately minimal PATH. A
  // per-user Python install puts py.exe in %LOCALAPPDATA%\…\Launcher, so
  // probing by NAME succeeded and then `spawn('py', …)` failed ENOENT — venv
  // creation returned "ok" shaped like a failure in 4ms. Resolving to
  // sys.executable at detection time is what closes that gap; if this ever
  // reverts to storing a bare command name, this test fails.
  const found = pythonBridge.detectSystemPython();

  it.skipIf(!found)('resolves to an absolute path that exists', () => {
    expect(path.isAbsolute(found.command)).toBe(true);
    expect(existsSync(found.command)).toBe(true);
  });

  it.skipIf(!found)('needs no launcher arguments', () => {
    // sys.executable is a real interpreter binary, never `py -3`.
    expect(found.launcherArgs).toEqual([]);
  });

  it.skipIf(!found)('reports a version at or above the floor', () => {
    expect(found.major).toBeGreaterThanOrEqual(pythonBridge.MIN_PYTHON.major);
    if (found.major === pythonBridge.MIN_PYTHON.major) {
      expect(found.minor).toBeGreaterThanOrEqual(pythonBridge.MIN_PYTHON.minor);
    }
  });

  it.skipIf(!found)('is findable from the rebuilt child PATH, or absolute enough not to need it', () => {
    // The actual invariant: spawning the resolved command must not depend on
    // whatever PATH the child gets.
    expect(path.isAbsolute(found.command)).toBe(true);
  });
});

// ── Environment paths ───────────────────────────────────────────────────────

describe('envPaths', () => {
  it('puts every machinery path under .parallx', () => {
    const p = pythonBridge.envPaths(WS);
    for (const key of ['venvDir', 'tmpDir', 'homeDir', 'pipCacheDir']) {
      expect(pythonBridge.isInside(path.join(WS, '.parallx'), p[key]), key).toBe(true);
    }
  });

  it('uses the platform-correct interpreter location', () => {
    const p = pythonBridge.envPaths(WS);
    if (process.platform === 'win32') {
      expect(p.binDir.endsWith('Scripts')).toBe(true);
      expect(p.pythonExe.endsWith('python.exe')).toBe(true);
    } else {
      expect(p.binDir.endsWith('bin')).toBe(true);
      expect(p.pythonExe.endsWith('python')).toBe(true);
    }
  });
});

// ── Child environment ───────────────────────────────────────────────────────

describe('buildChildEnv', () => {
  const env = () => pythonBridge.buildChildEnv(WS);

  it('points every cache and scratch location inside the workspace', () => {
    const e = env();
    // These are the paths that otherwise pool globally and let one workspace's
    // data end up somewhere another workspace can read it.
    for (const key of ['PIP_CACHE_DIR', 'TMPDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
      'APPDATA', 'LOCALAPPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
      expect(e[key], key).toBeTruthy();
      expect(pythonBridge.isInside(WS, e[key]), `${key} → ${e[key]}`).toBe(true);
    }
  });

  it('does not inherit ambient module paths', () => {
    const e = env();
    // PYTHONPATH would splice foreign directories onto sys.path; PYTHONHOME
    // would repoint the stdlib. Neither may survive from the parent process.
    expect(e.PYTHONPATH).toBeUndefined();
    expect(e.PYTHONHOME).toBeUndefined();
    expect(e.PYTHONNOUSERSITE).toBe('1');
  });

  it('is a rebuild, not a filtered copy of process.env', () => {
    // An allowlist cannot leak a variable nobody thought to deny. Prove the
    // parent's variables are absent rather than merely overridden.
    const marker = 'PARALLX_TEST_LEAK_CANARY';
    process.env[marker] = 'leaked';
    try {
      expect(env()[marker]).toBeUndefined();
    } finally {
      delete process.env[marker];
    }
  });

  it('puts the venv first on PATH', () => {
    const e = env();
    const first = String(e.PATH).split(path.delimiter)[0];
    expect(first).toBe(pythonBridge.envPaths(WS).binDir);
  });

  it('suppresses bytecode so script folders stay clean', () => {
    expect(env().PYTHONDONTWRITEBYTECODE).toBe('1');
  });

  it('gives the script a workspace handle and an output dir', () => {
    const e = pythonBridge.buildChildEnv(WS, { outDir: path.join(WS, 'output', 'r1'), runId: 'r1' });
    expect(e.PARALLX_WORKSPACE).toBe(path.resolve(WS));
    expect(e.PARALLX_OUT).toBe(path.join(WS, 'output', 'r1'));
    expect(e.PARALLX_RUN_ID).toBe('r1');
  });

  it('keeps the OS floor needed for Python to start at all', () => {
    const e = env();
    if (process.platform === 'win32') {
      // Without SystemRoot, socket and ssl initialisation fails.
      expect(e.SystemRoot).toBeTruthy();
      expect(String(e.PATH).toLowerCase()).toContain('system32');
    } else {
      expect(String(e.PATH)).toContain('/usr/bin');
    }
  });
});

// ── The machinery / content split ───────────────────────────────────────────

describe('ignore rules: machinery is hidden, content is not', () => {
  const ignore = createParallxIgnore();

  it('ignores the workspace venv and its scratch dir', () => {
    expect(ignore.isIgnored('.parallx/venv', true)).toBe(true);
    expect(ignore.isIgnored('.parallx/tmp', true)).toBe(true);
  });

  it('ignores files buried inside the venv', () => {
    // The incremental indexer is handed leaf paths with no memory of having
    // skipped the parent, which is exactly what isPathIgnored exists for.
    const buried = '.parallx/venv/Lib/site-packages/numpy/__init__.py';
    expect(ignore.isPathIgnored(buried, false)).toBe(true);
  });

  it('keeps scripts and outputs fully visible', () => {
    const content = [
      'scripts/summarise.py',
      'scripts/nested/helper.py',
      'output/report.csv',
      'output/2026-07/chart.png',
      'notes.md',
    ];
    for (const p of content) {
      expect(ignore.isPathIgnored(p, false), p).toBe(false);
    }
  });

  it('still hides bytecode and tool caches that land in content folders', () => {
    expect(ignore.isPathIgnored('scripts/__pycache__/helper.cpython-312.pyc', false)).toBe(true);
    expect(ignore.isPathIgnored('scripts/.pytest_cache/v/cache/lastfailed', false)).toBe(true);
  });

  it('does not hide a user folder merely because its name contains "venv"', () => {
    expect(ignore.isPathIgnored('research/venvironment-notes.md', false)).toBe(false);
  });
});

describe('isPathIgnored', () => {
  const ignore = createParallxIgnore();

  it('fixes the ancestor gap that isIgnored has by design', () => {
    // isIgnored answers "does this exact path match a pattern". Directory-only
    // patterns are skipped for files, so the exact check says false for a file
    // inside node_modules — correct for a top-down walk, wrong for an event.
    expect(ignore.isIgnored('node_modules/foo/bar.js', false)).toBe(false);
    expect(ignore.isPathIgnored('node_modules/foo/bar.js', false)).toBe(true);
  });

  it('handles backslashes and leading slashes', () => {
    expect(ignore.isPathIgnored('node_modules\\foo\\bar.js', false)).toBe(true);
    expect(ignore.isPathIgnored('/node_modules/foo/bar.js', false)).toBe(true);
  });

  it('is safe on empty input', () => {
    expect(ignore.isPathIgnored('', false)).toBe(false);
  });
});

describe('WATCH_IGNORE_SEGMENTS', () => {
  it('covers the subtrees that produce install storms', () => {
    for (const seg of ['node_modules', 'venv', '.venv', 'site-packages', '__pycache__', '.git']) {
      expect(WATCH_IGNORE_SEGMENTS).toContain(seg);
    }
  });

  it('is plain segment names, so the main process needs no glob engine', () => {
    for (const seg of WATCH_IGNORE_SEGMENTS) {
      expect(seg).not.toContain('/');
      expect(seg).not.toContain('*');
    }
  });

  it('does not blanket-ignore the configured content folders', () => {
    // 'output' and 'scripts' are user content; a segment match would hide them
    // from the watcher entirely and break live re-indexing of script results.
    expect(WATCH_IGNORE_SEGMENTS).not.toContain('output');
    expect(WATCH_IGNORE_SEGMENTS).not.toContain('scripts');
  });
});
