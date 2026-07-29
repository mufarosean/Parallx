// electron/pythonBridge.cjs — per-workspace Python runtime (M94)
//
// One virtual environment per workspace, living at <workspace>/.parallx/venv.
// Packages installed in one workspace are invisible to every other workspace,
// and the child process is launched with a deliberately rebuilt environment so
// the usual ambient bleed paths (user site-packages, the shared pip wheel
// cache, $HOME dotfile caches, the system temp dir) all resolve INSIDE the
// workspace instead of somewhere global.
//
// ── What this actually guarantees ───────────────────────────────────────────
//
// Real, enforced:
//   - site-packages is per-workspace (that is what a venv is)
//   - the pip wheel cache, TMPDIR, and $HOME/%APPDATA% resolve inside the
//     workspace, so nothing pools in a shared location between workspaces
//   - no shell is ever involved — every spawn is argv-form
//   - script paths and package specifiers are validated before they are used
//
// NOT guaranteed, and the UI must not imply otherwise:
//   - a running Python process holds a raw `open()`. It is outside every
//     boundary Parallx has — `_isAllowedReadPath`, `.parallxignore`, and the
//     capability bridges are all IPC-layer checks, and a child process does
//     not make IPC calls. main.cjs already documents this for ffmpeg at the
//     `fs:isInWorkspace` handler.
//   - network egress is unrestricted. `pip install` requires it by definition.
//
// Real isolation would need an OS-level sandbox (AppContainer, a restricted
// token, or a container). That is a separate piece of work. Until then this
// module's job is to make the DEFAULT behaviour local and every action
// auditable — not to pretend a jail exists.

const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum interpreter we will build an environment with. */
const MIN_PYTHON = { major: 3, minor: 10 };

/** Workspace-relative location of the environment and its scratch space. */
const VENV_REL = path.join('.parallx', 'venv');
const TMP_REL = path.join('.parallx', 'tmp');

/** Default wall-clock ceiling for a single script run. */
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

/** Hard ceiling on captured output per stream, so a runaway loop cannot pin memory. */
const MAX_STREAM_BYTES = 2 * 1024 * 1024;

/** Ceiling on concurrent script runs per workspace. */
const MAX_CONCURRENT_RUNS = 4;

/**
 * Accepted package specifier. Deliberately narrow: a bare name, optional
 * extras, optional single version constraint. This rejects the whole family of
 * pip arguments that turn "install a package" into "run arbitrary code from
 * anywhere" — `-e .`, `--index-url http://…`, a local path, a VCS URL, or a
 * second argument smuggled in behind a space.
 */
const PACKAGE_SPEC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,-]+\])?((==|>=|<=|~=|!=|>|<)[A-Za-z0-9._*+!-]+)?$/;

// ── Module state ────────────────────────────────────────────────────────────

let _getMainWindow = () => null;

/**
 * Push live output from a long-running environment operation to the renderer.
 *
 * Creating an environment and installing packages both take tens of seconds
 * and both have real progress to report — `pip` names each package as it
 * collects, downloads and installs it. Without this the UI has a disabled
 * button and nothing else, which is indistinguishable from a hang.
 */
function emitProgress(workspaceRoot, phase, chunk, channel) {
  const win = _getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('python:progress', {
    workspaceRoot: workspaceRoot ? path.resolve(workspaceRoot) : null,
    phase,
    channel: channel || 'stdout',
    chunk,
  });
}

/** An onData handler that forwards to the renderer under a named phase. */
function progressSink(workspaceRoot, phase) {
  return (chunk, channel) => emitProgress(workspaceRoot, phase, chunk, channel);
}

/** Cached interpreter probe: { command, version, major, minor } | null. */
let _interpreter = undefined; // undefined = not probed yet, null = probed and absent

/** Active runs: runId → { proc, workspaceRoot, timer, killed }. */
const _runs = new Map();
let _runCounter = 0;

// ── Path helpers ────────────────────────────────────────────────────────────

/**
 * Resolve every machinery path for a workspace.
 * @param {string} workspaceRoot Absolute workspace root.
 */
function envPaths(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const venvDir = path.join(root, VENV_REL);
  const tmpDir = path.join(root, TMP_REL);
  const binDir = path.join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin');
  const pythonExe = path.join(binDir, process.platform === 'win32' ? 'python.exe' : 'python');
  return {
    root,
    venvDir,
    binDir,
    pythonExe,
    tmpDir,
    // Everything below is machinery and lives under an ignored subtree.
    homeDir: path.join(tmpDir, 'home'),
    pipCacheDir: path.join(venvDir, '.pip-cache'),
    markerPath: path.join(venvDir, 'parallx-env.json'),
  };
}

/** True when `child` is inside `parent` (or is `parent`). */
function isInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * Validate that a script path is a runnable piece of workspace CONTENT.
 *
 * Two separate checks, and both matter. Inside the workspace: a path that
 * escapes it is not ours to run. Outside the venv: `.parallx/venv` is
 * machinery, and a "script" that lives in site-packages is almost certainly a
 * path-traversal attempt rather than something the user wrote.
 *
 * @returns {{ ok: true, scriptPath: string } | { ok: false, message: string }}
 */
function validateScriptPath(workspaceRoot, scriptPath) {
  if (typeof scriptPath !== 'string' || !scriptPath.trim()) {
    return { ok: false, message: 'Script path is required.' };
  }
  const { root, venvDir } = envPaths(workspaceRoot);
  const abs = path.isAbsolute(scriptPath) ? path.resolve(scriptPath) : path.resolve(root, scriptPath);

  if (!isInside(root, abs)) {
    return { ok: false, message: `Script is outside the workspace: ${scriptPath}` };
  }
  if (isInside(venvDir, abs)) {
    return { ok: false, message: 'Refusing to run a script from inside the environment directory.' };
  }
  if (path.extname(abs).toLowerCase() !== '.py') {
    return { ok: false, message: 'Only .py files can be run.' };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, message: `Script not found: ${scriptPath}` };
  }
  return { ok: true, scriptPath: abs };
}

/** Validate a list of package specifiers. */
function validatePackages(specs) {
  if (!Array.isArray(specs) || specs.length === 0) {
    return { ok: false, message: 'At least one package is required.' };
  }
  const cleaned = [];
  for (const raw of specs) {
    const spec = typeof raw === 'string' ? raw.trim() : '';
    if (!PACKAGE_SPEC_RE.test(spec)) {
      return {
        ok: false,
        message:
          `Rejected package specifier "${raw}". Expected a plain name with an ` +
          'optional version (e.g. "pandas", "pandas==2.1.0", "httpx[cli]"). ' +
          'Paths, URLs, and pip flags are not accepted.',
      };
    }
    cleaned.push(spec);
  }
  return { ok: true, packages: cleaned };
}

// ── Interpreter detection ───────────────────────────────────────────────────

/**
 * Find a system Python new enough to build an environment with.
 *
 * Resolves to an ABSOLUTE interpreter path, not the name that was probed.
 * This is load-bearing rather than tidiness: detection runs with the parent
 * process's inherited PATH, but every subsequent spawn runs with the rebuilt
 * environment from buildChildEnv, whose PATH is deliberately minimal. A
 * per-user Python install puts `py.exe` in %LOCALAPPDATA%\Programs\Python\
 * Launcher — found during detection, ENOENT at spawn time. Asking the
 * interpreter for its own `sys.executable` closes that gap, and incidentally
 * removes the `py -3` launcher special case: sys.executable is always a real
 * python binary that needs no launcher argument.
 *
 * Isolated in one function on purpose: swapping in a managed interpreter
 * (a bundled CPython, or `uv python install`) later means replacing this and
 * nothing else. Cached for the process lifetime — a machine does not grow a
 * Python mid-session.
 *
 * @returns {{ command: string, launcherArgs: string[], version: string, major: number, minor: number } | null}
 */
function detectSystemPython() {
  if (_interpreter !== undefined) return _interpreter;

  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];

  // One probe call: version and absolute path together, so they cannot
  // disagree about which interpreter we are talking about.
  const PROBE = 'import sys;print("%d.%d.%d|%s"%(sys.version_info[0],sys.version_info[1],sys.version_info[2],sys.executable))';

  for (const [cmd, launcherArgs] of candidates) {
    try {
      const out = execFileSync(cmd, [...launcherArgs, '-c', PROBE], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const m = String(out).trim().match(/^(\d+)\.(\d+)\.(\d+)\|(.+)$/m);
      if (!m) continue;

      const major = parseInt(m[1], 10);
      const minor = parseInt(m[2], 10);
      const executable = m[4].trim();
      if (major < MIN_PYTHON.major || (major === MIN_PYTHON.major && minor < MIN_PYTHON.minor)) continue;
      if (!executable || !fs.existsSync(executable)) continue;

      _interpreter = {
        command: executable,
        launcherArgs: [],
        version: `${major}.${minor}.${m[3]}`,
        major,
        minor,
        // Kept for diagnostics: which name on PATH led us here.
        probedAs: cmd,
      };
      return _interpreter;
    } catch {
      // Candidate absent or not runnable — try the next.
    }
  }

  _interpreter = null;
  return null;
}

/** Clear the cached probe (used by tests and after a user installs Python). */
function resetInterpreterCache() {
  _interpreter = undefined;
}

// ── Environment construction ────────────────────────────────────────────────

/**
 * Build the child-process environment.
 *
 * This is the actual localization mechanism, and it is a rebuild rather than a
 * filtered copy of `process.env`: an allowlist cannot leak something nobody
 * thought to deny. Everything a Python process would normally resolve against
 * the user profile — the wheel cache, the config dir, the temp dir, `$HOME`
 * itself — is pointed at workspace-local machinery instead.
 *
 * @param {string} workspaceRoot
 * @param {{ outDir?: string, runId?: string }} [extra]
 */
function buildChildEnv(workspaceRoot, extra = {}) {
  const p = envPaths(workspaceRoot);

  // Minimal OS floor. Without SystemRoot, Python on Windows cannot initialise
  // sockets or ssl; without a PATH containing System32 it cannot resolve the
  // DLLs it links against.
  const base = {};
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    base.SystemRoot = sysRoot;
    base.windir = sysRoot;
    base.COMSPEC = process.env.COMSPEC || path.join(sysRoot, 'System32', 'cmd.exe');
    base.PATHEXT = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    base.NUMBER_OF_PROCESSORS = process.env.NUMBER_OF_PROCESSORS || '';
    base.PROCESSOR_ARCHITECTURE = process.env.PROCESSOR_ARCHITECTURE || '';
    base.PATH = [
      p.binDir,
      path.join(sysRoot, 'System32'),
      sysRoot,
      path.join(sysRoot, 'System32', 'Wbem'),
    ].join(path.delimiter);
  } else {
    base.PATH = [p.binDir, '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter);
    base.LANG = process.env.LANG || 'C.UTF-8';
  }

  return {
    ...base,

    // ── The venv itself ──
    VIRTUAL_ENV: p.venvDir,

    // Ambient module paths are NOT inherited. PYTHONPATH would splice foreign
    // directories onto sys.path; PYTHONHOME would repoint the stdlib. A venv
    // already disables user-site, but PYTHONNOUSERSITE says so explicitly
    // rather than relying on that staying true.
    PYTHONNOUSERSITE: '1',
    // Keeps `scripts/__pycache__/` from ever existing, which is strictly
    // better than ignoring it after the fact.
    PYTHONDONTWRITEBYTECODE: '1',
    // Unbuffered, so streamed output arrives while the script is still running
    // instead of in one lump at exit.
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',

    // ── Caches and scratch, all workspace-local ──
    PIP_CACHE_DIR: p.pipCacheDir,
    PIP_REQUIRE_VIRTUALENV: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    TMPDIR: p.tmpDir,
    TEMP: p.tmpDir,
    TMP: p.tmpDir,

    // $HOME redirection is what stops libraries with their own dotfile caches
    // (matplotlib, huggingface, jupyter) from writing into the real user
    // profile and pooling state across workspaces.
    HOME: p.homeDir,
    USERPROFILE: p.homeDir,
    APPDATA: path.join(p.homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(p.homeDir, 'AppData', 'Local'),
    XDG_CACHE_HOME: path.join(p.homeDir, '.cache'),
    XDG_CONFIG_HOME: path.join(p.homeDir, '.config'),
    XDG_DATA_HOME: path.join(p.homeDir, '.local', 'share'),

    // ── Contract with the script ──
    PARALLX_WORKSPACE: p.root,
    ...(extra.outDir ? { PARALLX_OUT: extra.outDir } : {}),
    ...(extra.runId ? { PARALLX_RUN_ID: extra.runId } : {}),
  };
}

/**
 * Overlay a workspace venv onto an EXISTING environment — what `activate` does.
 *
 * Deliberately not `buildChildEnv`. These are two different operations and
 * conflating them breaks one or the other:
 *
 *   buildChildEnv  CONTAINMENT. Rebuilds from nothing for a process Parallx
 *                  runs on the user's behalf (a script, the kernel). Minimal
 *                  PATH, redirected HOME/APPDATA/TMPDIR, no inherited vars.
 *                  Maximum localisation, because nothing in there is the
 *                  user's own session.
 *
 *   this           ACTIVATION. A terminal is the USER'S shell. Scrubbing it
 *                  would strip git, node, ssh, their prompt theme, their
 *                  credentials helper — everything they expect a terminal to
 *                  have. So inherit all of it and prepend the venv, exactly
 *                  like `activate`, and change nothing else.
 *
 * Returns the base environment unchanged when the workspace has no venv, so
 * callers can apply it unconditionally.
 *
 * @param {string} workspaceRoot
 * @param {Record<string,string>} baseEnv Usually process.env.
 */
function buildTerminalEnv(workspaceRoot, baseEnv) {
  const base = { ...baseEnv };
  if (!workspaceRoot) return base;

  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) return base;

  // PATH is case-insensitive on Windows and process.env may carry it as
  // 'Path'. Writing a second 'PATH' key would leave the original winning.
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const existing = base[pathKey] || '';

  // Idempotent: re-activating an already-active env must not stack duplicate
  // entries (a terminal restarted repeatedly would otherwise grow its PATH).
  const entries = existing.split(path.delimiter).filter((e) => e && path.resolve(e) !== p.binDir);
  base[pathKey] = [p.binDir, ...entries].join(path.delimiter);

  base.VIRTUAL_ENV = p.venvDir;
  // Most prompt themes (starship, oh-my-posh, powerlevel10k) read this and
  // show the env name without needing activate's prompt function.
  base.VIRTUAL_ENV_PROMPT = `(${path.basename(path.dirname(p.venvDir)) || 'venv'})`;
  // `activate` unsets PYTHONHOME because a stale one silently repoints the
  // stdlib away from the venv.
  delete base.PYTHONHOME;

  return base;
}

/** Describe the venv a terminal would activate, for the UI. */
function terminalEnvInfo(workspaceRoot) {
  if (!workspaceRoot) return { active: false, venvPath: null, binDir: null };
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) return { active: false, venvPath: null, binDir: null };
  return { active: true, venvPath: p.venvDir, binDir: p.binDir };
}

/** Create the machinery directories a run depends on. */
function ensureMachineryDirs(workspaceRoot) {
  const p = envPaths(workspaceRoot);
  for (const dir of [p.tmpDir, p.homeDir, path.join(p.homeDir, '.cache'), path.join(p.homeDir, '.config')]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  }
}

// ── Process helpers ─────────────────────────────────────────────────────────

/** Kill a process tree. Windows needs taskkill; POSIX gets the process group. */
function killTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else {
      proc.kill('SIGKILL');
    }
  } catch { /* best-effort */ }
}

/**
 * Run a command to completion, capturing output. argv-form, never a shell.
 * @returns {Promise<{ ok: boolean, code: number, stdout: string, stderr: string }>}
 */
function runToCompletion(command, args, options) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(err && err.message) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(proc);
      resolve({ ok: false, code: -1, stdout, stderr: stderr + `\n[timed out after ${options.timeout}ms]` });
    }, options.timeout);

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      if (stdout.length < MAX_STREAM_BYTES) stdout += text;
      // Forward live as well as buffering. `pip install pandas` is a
      // 30-second operation whose entire user-facing signal is its output;
      // returning it only at the end means the UI can show nothing but a
      // spinner, and cannot distinguish "downloading 11 MB" from "hung".
      if (options.onData) options.onData(text, 'stdout');
    });
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      if (stderr.length < MAX_STREAM_BYTES) stderr += text;
      // pip writes most of its progress to stderr, so this is not the
      // error-only channel it looks like.
      if (options.onData) options.onData(text, 'stderr');
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: String(err && err.message) });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr });
    });
  });
}

// ── Public: status ──────────────────────────────────────────────────────────

/**
 * Describe the workspace environment without creating anything.
 * Safe to call constantly — it only stats the filesystem.
 */
function getStatus(workspaceRoot) {
  const interpreter = detectSystemPython();
  if (!workspaceRoot) {
    return {
      interpreterFound: !!interpreter,
      interpreterVersion: interpreter ? interpreter.version : null,
      envExists: false,
      envPath: null,
      createdAt: null,
      createdWith: null,
      sizeBytes: 0,
    };
  }

  const p = envPaths(workspaceRoot);
  const envExists = fs.existsSync(p.pythonExe);
  let marker = null;
  if (envExists) {
    try { marker = JSON.parse(fs.readFileSync(p.markerPath, 'utf8')); } catch { /* absent or corrupt */ }
  }

  return {
    interpreterFound: !!interpreter,
    interpreterVersion: interpreter ? interpreter.version : null,
    envExists,
    envPath: envExists ? p.venvDir : null,
    envPython: envExists ? p.pythonExe : null,
    createdAt: marker && marker.createdAt ? marker.createdAt : null,
    createdWith: marker && marker.pythonVersion ? marker.pythonVersion : null,
    activeRuns: [..._runs.values()].filter((r) => isInside(workspaceRoot, r.workspaceRoot)).length,
  };
}

/** Recursive size of the environment, for the "what is this costing me" readout. */
/**
 * Recursive size of the environment.
 *
 * This was originally a synchronous `readdirSync` + `statSync` walk, and that
 * was a serious mistake: it runs in the MAIN process, which routes every IPC
 * message and every window event. A venv with ipykernel is comfortably 10,000
 * files, and on a slow volume — a workspace living on a USB stick — walking it
 * synchronously froze the entire app for seconds. It was also called on every
 * status refresh, including immediately after an install, which is exactly
 * when the tree is largest and the disk is busiest.
 *
 * Now: fully async (so the event loop keeps turning), yielding explicitly
 * every so often (async fs calls alone can still starve the loop when they
 * resolve from cache), bounded so a pathological tree cannot run forever, and
 * cached — the answer only changes when packages change.
 */

/** workspaceRoot → { value, at } and any in-flight walk. */
const _sizeCache = new Map();
const _sizeInFlight = new Map();

/** Stop after this many files and report the result as a lower bound. */
const MAX_SIZE_WALK_FILES = 80_000;
/** Yield to the event loop every N directory entries. */
const SIZE_WALK_YIELD_EVERY = 500;

function invalidateSizeCache(workspaceRoot) {
  if (!workspaceRoot) { _sizeCache.clear(); return; }
  _sizeCache.delete(path.resolve(workspaceRoot));
}

async function getEnvSize(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot || '');
  if (!root) return { sizeBytes: 0, fileCount: 0, truncated: false, cached: false };

  if (!options.force) {
    const hit = _sizeCache.get(root);
    if (hit) return { ...hit.value, cached: true };
  }
  // Two panels (or a refresh storm) must not start two walks of the same tree.
  const running = _sizeInFlight.get(root);
  if (running) return running;

  const walkPromise = (async () => {
    const p = envPaths(root);
    let total = 0;
    let files = 0;
    let truncated = false;
    let sinceYield = 0;

    const walk = async (dir) => {
      if (truncated) return;
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return; // permissions, or removed mid-walk
      }
      for (const entry of entries) {
        if (truncated) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        try {
          const stat = await fs.promises.stat(full);
          total += stat.size;
          files++;
        } catch { /* vanished mid-walk — an install is probably running */ }

        if (files >= MAX_SIZE_WALK_FILES) { truncated = true; return; }
        // Async fs calls can resolve synchronously from the OS cache, which
        // would let this loop run to completion without ever yielding.
        if (++sinceYield >= SIZE_WALK_YIELD_EVERY) {
          sinceYield = 0;
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    };

    if (fs.existsSync(p.venvDir)) await walk(p.venvDir);
    const value = { sizeBytes: total, fileCount: files, truncated };
    _sizeCache.set(root, { value, at: Date.now() });
    return { ...value, cached: false };
  })();

  _sizeInFlight.set(root, walkPromise);
  try {
    return await walkPromise;
  } finally {
    _sizeInFlight.delete(root);
  }
}

// ── Public: lifecycle ───────────────────────────────────────────────────────

/** Create the workspace environment. Idempotent — an existing env is reported, not rebuilt. */
async function createEnv(workspaceRoot) {
  const interpreter = detectSystemPython();
  if (!interpreter) {
    return {
      ok: false,
      error: `No Python ${MIN_PYTHON.major}.${MIN_PYTHON.minor}+ found on this machine. ` +
        'Install it from https://www.python.org/downloads/ and try again.',
    };
  }

  const p = envPaths(workspaceRoot);
  if (fs.existsSync(p.pythonExe)) {
    return { ok: true, alreadyExists: true, ...getStatus(workspaceRoot) };
  }

  ensureMachineryDirs(workspaceRoot);
  try { fs.mkdirSync(path.dirname(p.venvDir), { recursive: true }); } catch { /* exists */ }

  // `--upgrade-deps` is deliberately omitted: it needs network, and creating
  // an environment should work offline. Packages come later, explicitly.
  // `python -m venv` is quiet, so announce the phase ourselves — otherwise
  // the first several seconds produce no output at all and read as a stall.
  emitProgress(workspaceRoot, 'create', `Creating environment with Python ${interpreter.version}…\n`);
  const result = await runToCompletion(
    interpreter.command,
    [...interpreter.launcherArgs, '-m', 'venv', p.venvDir],
    {
      cwd: p.root,
      env: buildChildEnv(workspaceRoot),
      timeout: 180_000,
      onData: progressSink(workspaceRoot, 'create'),
    },
  );

  if (!result.ok || !fs.existsSync(p.pythonExe)) {
    return { ok: false, error: `Failed to create environment: ${result.stderr || result.stdout || 'unknown error'}` };
  }

  try {
    fs.writeFileSync(p.markerPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      pythonVersion: interpreter.version,
      createdBy: 'parallx',
      workspaceRoot: p.root,
    }, null, 2), 'utf8');
  } catch { /* marker is informational */ }

  invalidateSizeCache(workspaceRoot);
  emitProgress(workspaceRoot, 'create', 'Environment ready.\n');
  return { ok: true, alreadyExists: false, ...getStatus(workspaceRoot) };
}

/** Delete the environment. Machinery only — scripts and outputs are untouched. */
async function removeEnv(workspaceRoot) {
  const p = envPaths(workspaceRoot);
  cancelWorkspaceRuns(workspaceRoot);
  if (!fs.existsSync(p.venvDir)) return { ok: true, removed: false };
  try {
    fs.rmSync(p.venvDir, { recursive: true, force: true });
    invalidateSizeCache(workspaceRoot);
    return { ok: true, removed: true };
  } catch (err) {
    return { ok: false, error: `Failed to remove environment: ${err && err.message}` };
  }
}

// ── Public: packages ────────────────────────────────────────────────────────

/** Install packages into the workspace environment. */
async function installPackages(workspaceRoot, specs) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) {
    return { ok: false, error: 'No environment for this workspace yet. Create one first.' };
  }
  const validated = validatePackages(specs);
  if (!validated.ok) return { ok: false, error: validated.message };

  ensureMachineryDirs(workspaceRoot);
  emitProgress(workspaceRoot, 'install', `$ pip install ${validated.packages.join(' ')}\n`);
  const result = await runToCompletion(
    p.pythonExe,
    ['-m', 'pip', 'install', '--no-input', ...validated.packages],
    {
      cwd: p.root,
      env: buildChildEnv(workspaceRoot),
      timeout: 600_000,
      onData: progressSink(workspaceRoot, 'install'),
    },
  );

  invalidateSizeCache(workspaceRoot);
  return {
    ok: result.ok,
    packages: validated.packages,
    output: (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim(),
    error: result.ok ? null : (result.stderr || result.stdout || 'pip install failed').trim(),
  };
}

/** Uninstall packages from the workspace environment. */
async function uninstallPackages(workspaceRoot, specs) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) {
    return { ok: false, error: 'No environment for this workspace yet.' };
  }
  const validated = validatePackages(specs);
  if (!validated.ok) return { ok: false, error: validated.message };

  emitProgress(workspaceRoot, 'uninstall', `$ pip uninstall ${validated.packages.join(' ')}\n`);
  const result = await runToCompletion(
    p.pythonExe,
    ['-m', 'pip', 'uninstall', '--yes', ...validated.packages],
    {
      cwd: p.root,
      env: buildChildEnv(workspaceRoot),
      timeout: 180_000,
      onData: progressSink(workspaceRoot, 'uninstall'),
    },
  );
  return {
    ok: result.ok,
    output: (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim(),
    error: result.ok ? null : (result.stderr || 'pip uninstall failed').trim(),
  };
}

/** List installed packages. Returns [{ name, version }]. */
async function listPackages(workspaceRoot) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) return { ok: true, packages: [] };

  const result = await runToCompletion(
    p.pythonExe,
    ['-m', 'pip', 'list', '--format=json'],
    { cwd: p.root, env: buildChildEnv(workspaceRoot), timeout: 60_000 },
  );
  if (!result.ok) return { ok: false, packages: [], error: result.stderr || 'pip list failed' };

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      ok: true,
      packages: Array.isArray(parsed)
        ? parsed.map((e) => ({ name: String(e.name), version: String(e.version) }))
        : [],
    };
  } catch {
    return { ok: false, packages: [], error: 'Could not parse pip output.' };
  }
}

// ── Public: source formatting ───────────────────────────────────────────────

/**
 * Formatters this bridge will invoke, and how to drive each one from stdin.
 *
 * A closed allowlist rather than a general "run any module" entry point. The
 * two are technically equivalent — `-m <anything>` is arbitrary code execution
 * either way — but a general runner invites callers that skip the consent
 * gate, whereas formatting a buffer the user is already editing is a narrow,
 * obviously-safe act. If a third formatter is ever wanted, it gets added here
 * deliberately rather than arriving by accident.
 */
const FORMATTERS = {
  // `-q -` : quiet, read stdin, write stdout.
  black: { args: ['-m', 'black', '-q', '-'] },
  // `format -` reads stdin; --stdin-filename gives ruff the context it needs
  // to apply per-file config.
  ruff: { args: ['-m', 'ruff', 'format', '--stdin-filename', 'buffer.py', '-'] },
};

/** Which formatters are importable in this workspace's environment. */
async function detectFormatters(workspaceRoot) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) return { ok: true, available: [] };

  const available = [];
  for (const name of Object.keys(FORMATTERS)) {
    const res = await runToCompletion(
      p.pythonExe,
      ['-c', `import importlib.util,sys; sys.exit(0 if importlib.util.find_spec(${JSON.stringify(name)}) else 1)`],
      { cwd: p.root, env: buildChildEnv(workspaceRoot), timeout: 20_000 },
    );
    if (res.ok) available.push(name);
  }
  return { ok: true, available };
}

/**
 * Format Python source through a formatter in the workspace environment.
 *
 * Source goes in over stdin and comes back on stdout — the buffer is never
 * written to disk, so formatting an unsaved editor cannot leave a temp file
 * behind or race the user's own save.
 */
async function formatSource(workspaceRoot, source, tool) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) {
    return { ok: false, error: 'No Python environment for this workspace yet.' };
  }
  const spec = FORMATTERS[tool];
  if (!spec) {
    return { ok: false, error: `Unknown formatter "${tool}".` };
  }
  if (typeof source !== 'string') {
    return { ok: false, error: 'Nothing to format.' };
  }

  ensureMachineryDirs(workspaceRoot);

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(p.pythonExe, spec.args, {
        cwd: p.root,
        env: buildChildEnv(workspaceRoot),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };

    const timer = setTimeout(() => {
      killTree(proc);
      done({ ok: false, error: 'Formatter timed out.' });
    }, 30_000);

    proc.stdout.on('data', (d) => { if (stdout.length < MAX_STREAM_BYTES) stdout += d.toString(); });
    proc.stderr.on('data', (d) => { if (stderr.length < MAX_STREAM_BYTES) stderr += d.toString(); });
    proc.on('error', (err) => done({ ok: false, error: String(err && err.message) }));
    proc.on('close', (code) => {
      if (code === 0) {
        done({ ok: true, formatted: stdout, tool });
      } else {
        // A non-zero exit here is almost always a syntax error in the buffer,
        // and the formatter's own message says exactly where.
        done({ ok: false, error: (stderr || stdout || `${tool} exited ${code}`).trim() });
      }
    });

    proc.stdin.on('error', () => { /* closed early — the close handler reports */ });
    proc.stdin.end(source, 'utf8');
  });
}

// ── Public: running scripts ─────────────────────────────────────────────────

/**
 * Start a script. Returns immediately with a runId; output arrives on
 * `python:run:data` and completion on `python:run:exit`.
 *
 * cwd is the workspace root, so a script's relative paths land in workspace
 * content by default. PARALLX_OUT names a per-run output directory for
 * anything the script wants to keep.
 */
async function runScript(workspaceRoot, scriptPath, args, options = {}) {
  const p = envPaths(workspaceRoot);
  if (!fs.existsSync(p.pythonExe)) {
    return { ok: false, error: 'No environment for this workspace yet. Create one first.' };
  }
  if (_runs.size >= MAX_CONCURRENT_RUNS) {
    return { ok: false, error: `Too many scripts running (limit ${MAX_CONCURRENT_RUNS}). Wait or cancel one.` };
  }

  const validated = validateScriptPath(workspaceRoot, scriptPath);
  if (!validated.ok) return { ok: false, error: validated.message };

  const scriptArgs = Array.isArray(args) ? args.filter((a) => typeof a === 'string') : [];
  const timeout = Number.isFinite(options.timeout) && options.timeout > 0
    ? Math.min(options.timeout, 900_000)
    : DEFAULT_RUN_TIMEOUT_MS;

  const runId = `pyrun-${++_runCounter}`;
  const outDir = options.outDir && isInside(p.root, path.resolve(p.root, options.outDir))
    ? path.resolve(p.root, options.outDir)
    : path.join(p.root, 'output', runId);

  ensureMachineryDirs(workspaceRoot);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* best-effort */ }

  let proc;
  try {
    proc = spawn(p.pythonExe, [validated.scriptPath, ...scriptArgs], {
      cwd: p.root,
      env: buildChildEnv(workspaceRoot, { outDir, runId }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // own process group, so kill reaches children
    });
  } catch (err) {
    return { ok: false, error: `Failed to start script: ${err && err.message}` };
  }

  const entry = {
    proc,
    workspaceRoot: p.root,
    scriptPath: validated.scriptPath,
    outDir,
    startedAt: Date.now(),
    bytesOut: 0,
    timer: null,
  };
  _runs.set(runId, entry);

  const send = (channel, payload) => {
    const win = _getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  entry.timer = setTimeout(() => {
    const live = _runs.get(runId);
    if (!live) return;
    live.timedOut = true;
    killTree(live.proc);
  }, timeout);

  const forward = (channel) => (data) => {
    const live = _runs.get(runId);
    if (!live) return;
    // Cap total forwarded output. A runaway print loop should not be able to
    // flood the renderer or the run log.
    if (live.bytesOut >= MAX_STREAM_BYTES) return;
    const chunk = data.toString();
    live.bytesOut += chunk.length;
    send('python:run:data', { runId, channel, chunk });
    if (live.bytesOut >= MAX_STREAM_BYTES) {
      send('python:run:data', { runId, channel: 'stderr', chunk: '\n[output truncated — limit reached]\n' });
    }
  };

  proc.stdout.on('data', forward('stdout'));
  proc.stderr.on('data', forward('stderr'));

  proc.on('error', (err) => {
    const live = _runs.get(runId);
    if (live && live.timer) clearTimeout(live.timer);
    _runs.delete(runId);
    send('python:run:exit', { runId, exitCode: -1, error: { code: 'SPAWN_ERROR', message: err.message }, durationMs: Date.now() - entry.startedAt });
  });

  proc.on('close', (code, signal) => {
    const live = _runs.get(runId);
    if (live && live.timer) clearTimeout(live.timer);
    _runs.delete(runId);
    const timedOut = !!(live && live.timedOut);
    send('python:run:exit', {
      runId,
      exitCode: timedOut ? -1 : (code ?? (signal ? -1 : 0)),
      error: timedOut
        ? { code: 'TIMEOUT', message: `Script exceeded ${timeout}ms and was stopped.` }
        : (live && live.cancelled ? { code: 'CANCELLED', message: 'Script was cancelled.' } : null),
      durationMs: Date.now() - entry.startedAt,
      outDir,
    });
  });

  return { ok: true, runId, scriptPath: validated.scriptPath, outDir, timeout };
}

/** Cancel one run. */
function cancelRun(runId) {
  const entry = _runs.get(runId);
  if (!entry) return { ok: false, error: 'No such run.' };
  entry.cancelled = true;
  killTree(entry.proc);
  return { ok: true };
}

/** Cancel every run belonging to a workspace (used on workspace switch). */
function cancelWorkspaceRuns(workspaceRoot) {
  let killed = 0;
  for (const [runId, entry] of _runs) {
    if (!workspaceRoot || isInside(workspaceRoot, entry.workspaceRoot)) {
      entry.cancelled = true;
      killTree(entry.proc);
      _runs.delete(runId);
      killed++;
    }
  }
  return killed;
}

/** Kill everything. Called from the main-process teardown registry. */
function shutdown() {
  return cancelWorkspaceRuns(null);
}

// ── IPC wiring ──────────────────────────────────────────────────────────────

/**
 * Register the `python:*` IPC surface.
 *
 * Every handler takes an explicit workspaceRoot from the renderer rather than
 * reading module state, so a stale workspace can never be operated on by
 * accident. The renderer is responsible for the consent gate (the
 * `python.enabled` workspace setting) — this layer enforces containment
 * (paths, specifiers, limits) and nothing else.
 */
function setupPythonBridge(ipcMain, getMainWindow) {
  _getMainWindow = getMainWindow || (() => null);

  ipcMain.handle('python:status', async (_e, workspaceRoot) => {
    try { return { ok: true, ...getStatus(workspaceRoot) }; }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:envSize', async (_e, workspaceRoot) => {
    try { return { ok: true, ...(await getEnvSize(workspaceRoot)) }; }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:createEnv', async (_e, workspaceRoot) => {
    try { return await createEnv(workspaceRoot); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:removeEnv', async (_e, workspaceRoot) => {
    try { return await removeEnv(workspaceRoot); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:install', async (_e, workspaceRoot, packages) => {
    try { return await installPackages(workspaceRoot, packages); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:uninstall', async (_e, workspaceRoot, packages) => {
    try { return await uninstallPackages(workspaceRoot, packages); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:listPackages', async (_e, workspaceRoot) => {
    try { return await listPackages(workspaceRoot); }
    catch (err) { return { ok: false, packages: [], error: String(err && err.message) }; }
  });

  ipcMain.handle('python:runScript', async (_e, payload) => {
    try {
      const { workspaceRoot, scriptPath, args, timeout, outDir } = payload || {};
      return await runScript(workspaceRoot, scriptPath, args, { timeout, outDir });
    } catch (err) {
      return { ok: false, error: String(err && err.message) };
    }
  });

  ipcMain.handle('python:detectFormatters', async (_e, workspaceRoot) => {
    try { return await detectFormatters(workspaceRoot); }
    catch (err) { return { ok: false, available: [], error: String(err && err.message) }; }
  });

  ipcMain.handle('python:format', async (_e, workspaceRoot, source, tool) => {
    try { return await formatSource(workspaceRoot, source, tool); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('python:cancelRun', async (_e, runId) => {
    try { return cancelRun(runId); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });
}

module.exports = {
  setupPythonBridge,
  // Exported for main.cjs teardown.
  //
  // NOTE: doclingBridge.cjs carries its own `detectPython()`. It is left alone
  // deliberately — it stores a command STRING ('py -3') and feeds it to both
  // `execSync` (works, shell) and `spawn` (would not), so folding the two
  // probes together is a behaviour change to a shipping path, not a rename.
  // Worth doing, but on its own.
  shutdown,
  cancelWorkspaceRuns,
  detectSystemPython,
  resetInterpreterCache,
  // Shared with notebookKernelBridge.cjs (M96) — the kernel host is just
  // another workspace-local Python process, so it must get the SAME rebuilt
  // environment and the same process-tree kill as a script run. Duplicating
  // either would let the two drift, and the one that drifts silently is the
  // environment.
  ensureMachineryDirs,
  killTree,
  invalidateSizeCache,
  // Terminal activation (M97) — an overlay, NOT buildChildEnv. See its docs.
  buildTerminalEnv,
  terminalEnvInfo,
  // Exported for tests.
  envPaths,
  buildChildEnv,
  validateScriptPath,
  validatePackages,
  FORMATTERS,
  isInside,
  PACKAGE_SPEC_RE,
  MIN_PYTHON,
};
