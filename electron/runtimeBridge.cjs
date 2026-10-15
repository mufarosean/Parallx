// electron/runtimeBridge.cjs — tool runtimes: a heavy local engine a tool
// declares, installed once for the machine on the user's click, then run.
// (docs/ENHANCE.md, "Tool runtimes".)
//
//   runtimes:check    what the machine has, against what a runtime needs
//   runtimes:status   absent, partial or ready; its size on disk; installing?
//   runtimes:install  set it up, step by step, each step checked and resumable
//   runtimes:cancel   stop an install or a run
//   runtimes:remove   delete it (it is the tool's data: kept when the tool is off)
//   runtimes:run      run a script of the tool's in the runtime's Python
//
// A runtime lives in <app data>/runtimes/<id>/, outside every workspace, so
// one copy serves them all. Nothing is written anywhere else: uv runs with
// --no-bin and --no-registry (by default it puts a shortcut in the user's
// folder and registers its Python in the Windows registry), and its cache,
// its Python and every temp file stay inside the runtime's folder.
//
// Trust: the renderer sends the declaration; this side checks it. Packages
// come only from the tool's lock file, every one with its hash (uv refuses a
// package without one). Large files come only from the allowed hosts and are
// kept only when their SHA-256 matches. uv itself is pinned here, with its
// published SHA-256. Scripts run only from inside the app, argv form, never
// through a shell, with a rebuilt environment.
//
// Security software that inspects HTTPS (Norton, on the machine this was
// built on) breaks uv's own certificate check; --native-tls makes uv use the
// system's certificates, as the browser does. Downloads made here go through
// Electron's network stack, which uses them too.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const UV_VERSION = '0.13.1';
const UV_BUILDS = {
  'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: '3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672', exe: 'uv.exe' },
  'linux-x64': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'eadd9d27c134ab5ac1ffd4473b97a741407f3ea238288f03121fc4deddf90220', exe: 'uv' },
};
const ALLOWED_FILE_HOSTS = new Set(['huggingface.co', 'github.com']);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const PY_RE = /^3\.\d{1,2}\.\d{1,3}$/;
/** A run is stopped after this long with no output (loading a model prints nothing for a while). */
const RUN_STALL_MS = 15 * 60 * 1000;
const TAIL_BYTES = 8192;

// ── The declaration ──────────────────────────────────────────────────────

/**
 * Check a runtime declaration. Paths must be inside the app; the lock must
 * exist; every file needs an https address on an allowed host, a size and a
 * SHA-256. Returns { spec } or { error }.
 */
function checkSpec(raw, appRoot) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const id = String(s.id || '');
  if (!ID_RE.test(id)) return { error: 'A runtime needs an id of lowercase letters, digits and dashes.' };
  if (!PY_RE.test(String(s.python || ''))) return { error: 'A runtime names an exact Python version, like 3.13.16.' };
  const platform = `${process.platform}-${process.arch}`;
  const locks = s.locks && typeof s.locks === 'object' ? s.locks : {};
  const lockPath = locks[process.platform];
  if (!lockPath) return { error: `This runtime has no package list for ${process.platform}.` };
  const inApp = (p) => { const r = path.resolve(String(p)); return r.startsWith(path.resolve(appRoot) + path.sep) ? r : null; };
  const lock = inApp(lockPath);
  if (!lock) return { error: 'The package list must be inside the app.' };
  const files = [];
  for (const f of Array.isArray(s.files) ? s.files : []) {
    let host = '';
    try { const u = new URL(String(f.url)); if (u.protocol !== 'https:') host = ''; else host = u.hostname; } catch { host = ''; }
    if (!NAME_RE.test(String(f.name || ''))) return { error: 'A runtime file needs a plain name.' };
    if (!ALLOWED_FILE_HOSTS.has(host)) return { error: `Runtime files come from ${[...ALLOWED_FILE_HOSTS].join(' or ')} over https only.` };
    if (!SHA_RE.test(String(f.sha256 || '').toLowerCase())) return { error: `${f.name} needs its SHA-256.` };
    const bytes = Number(f.bytes);
    if (!(bytes > 0 && bytes < 64 * 1024 ** 3)) return { error: `${f.name} needs its size in bytes.` };
    files.push({ name: String(f.name), url: String(f.url), sha256: String(f.sha256).toLowerCase(), bytes });
  }
  const n = s.needs && typeof s.needs === 'object' ? s.needs : {};
  const needs = {
    platforms: Array.isArray(n.platforms) ? n.platforms.map(String) : ['win32-x64', 'linux-x64'],
    gpu: n.gpu === 'nvidia' ? 'nvidia' : null,
    minVramMiB: Number(n.minVramMiB) > 0 ? Number(n.minVramMiB) : 0,
    minDriver: Number(n.minDriver) > 0 ? Number(n.minDriver) : 0,
    diskBytes: Number(n.diskBytes) > 0 ? Number(n.diskBytes) : 0,
  };
  let selftest = null;
  if (s.selftest) {
    const script = inApp(s.selftest.script);
    if (!script) return { error: 'The self-test must be a script inside the app.' };
    selftest = { script, args: (Array.isArray(s.selftest.args) ? s.selftest.args : []).map(String) };
  }
  if (!UV_BUILDS[platform]) return { error: `Tool runtimes are not available on ${platform}.` };
  return { spec: { id, title: String(s.title || id), python: String(s.python), lock, files, needs, selftest } };
}

/** What changes the installed packages: the Python version and the lock's text. */
function packagesKey(spec, lockText) {
  return crypto.createHash('sha256').update(`${spec.python}\n${lockText}`).digest('hex');
}

// ── The machine ──────────────────────────────────────────────────────────

/** Every NVIDIA card: { name, vramMiB, freeMiB, driver }. [] when there is none or no driver. */
function nvidiaCards(run) {
  return new Promise((resolve) => {
    const exe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe') : 'nvidia-smi';
    run(exe, ['--query-gpu=name,memory.total,memory.free,driver_version', '--format=csv,noheader,nounits'], { timeout: 10_000 }).then((r) => {
      if (!r || r.code !== 0) return resolve([]);
      resolve(String(r.stdout).trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, total, free, driver] = line.split(',').map((x) => x.trim());
        return { name, vramMiB: Number(total) || 0, freeMiB: Number(free) || 0, driver: String(driver || '') };
      }));
    }, () => resolve([]));
  });
}

/** Problems with this machine for `needs`, in words for the user. */
function machineProblems(needs, cards, freeDisk, platform) {
  const problems = [];
  if (!needs.platforms.includes(platform)) problems.push(`It runs on ${needs.platforms.map((p) => p.split('-')[0] === 'win32' ? 'Windows' : 'Linux').join(' and ')} only.`);
  if (needs.gpu === 'nvidia') {
    const best = cards.slice().sort((a, b) => b.vramMiB - a.vramMiB)[0];
    if (!best) problems.push('It needs an NVIDIA graphics card with its driver installed.');
    else {
      if (needs.minVramMiB && best.vramMiB < needs.minVramMiB) problems.push(`It needs a graphics card with ${Math.round(needs.minVramMiB / 1024)} GB of memory; ${best.name} has ${Math.round(best.vramMiB / 1024)} GB.`);
      const major = parseInt(best.driver, 10);
      if (needs.minDriver && !(major >= needs.minDriver)) problems.push(`It needs NVIDIA driver ${needs.minDriver} or newer; this one is ${best.driver || 'unknown'}.`);
    }
  }
  if (needs.diskBytes && freeDisk !== null && freeDisk < needs.diskBytes) problems.push(`It needs ${Math.ceil(needs.diskBytes / 1024 ** 3)} GB free on the disk Parallx keeps its data on; there is ${Math.floor(freeDisk / 1024 ** 3)} GB.`);
  return problems;
}

// ── Processes ────────────────────────────────────────────────────────────

/** Run a program, argv form. Resolves { code, stdout, stderr }; never rejects. */
function runProgram(file, args, opts = {}) {
  return new Promise((resolve) => {
    let out = ''; let err = ''; let partial = '';
    let child;
    try { child = spawn(file, args, { cwd: opts.cwd, env: opts.env, windowsHide: true }); } catch (e) { resolve({ code: -1, stdout: '', stderr: String(e && e.message) }); return; }
    const timer = opts.timeout ? setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, opts.timeout) : null;
    child.stdout.on('data', (d) => {
      out = (out + d).slice(-TAIL_BYTES * 8);
      if (!opts.onLine) return;
      const lines = (partial + d).split(/\r?\n/);
      partial = lines.pop();
      for (const l of lines) if (l) opts.onLine(l);
    });
    child.stderr.on('data', (d) => { err = (err + d).slice(-TAIL_BYTES); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout: out, stderr: err + String(e && e.message) }); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (opts.onLine && partial) opts.onLine(partial); resolve({ code, stdout: out, stderr: err }); });
    if (opts.onChild) opts.onChild(child);
  });
}

/** End a process and everything it started, and nothing else. */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* gone */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  }
}

// ── The bridge ───────────────────────────────────────────────────────────

/**
 * @param {{ handle(channel: string, fn: Function): void }} ipcMain
 * @param {{ appRoot: string, getMainWindow: () => any, isSealed?: () => boolean, fetch?: Function, run?: Function }} opts
 */
function setupRuntimeBridge(ipcMain, opts) {
  const base = process.env.PARALLX_RUNTIMES_DIR || path.join(opts.appRoot, 'data', 'runtimes');
  const run = opts.run || runProgram;
  const platform = `${process.platform}-${process.arch}`;
  const send = (payload) => { try { const w = opts.getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send('runtimes:progress', payload); } catch { /* window gone */ } };
  const installs = new Map();   // id -> { cancelled, child }
  const runs = new Map();       // runId -> { child, id }

  const dirs = (id) => {
    const root = path.join(base, id);
    return {
      root,
      uv: path.join(root, 'uv'),
      python: path.join(root, 'python'),
      env: path.join(root, 'env'),
      files: path.join(root, 'files'),
      cache: path.join(root, 'cache'),
      tmp: path.join(root, 'tmp'),
      home: path.join(root, 'home'),
      state: path.join(root, 'state.json'),
    };
  };
  const envPython = (d) => (process.platform === 'win32' ? path.join(d.env, 'Scripts', 'python.exe') : path.join(d.env, 'bin', 'python'));
  const uvExe = (d) => path.join(d.uv, UV_BUILDS[platform].exe);
  const readState = async (d) => { try { return JSON.parse(await fsp.readFile(d.state, 'utf8')); } catch { return {}; } };
  const writeState = async (d, s) => { await fsp.mkdir(d.root, { recursive: true }); await fsp.writeFile(d.state, JSON.stringify(s, null, 2)); };

  /** uv's environment: everything it caches or installs stays inside the runtime. */
  const uvEnv = (d) => {
    const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'LANG'];
    const env = {};
    for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
    env.PATH = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin';
    Object.assign(env, {
      UV_CACHE_DIR: d.cache, UV_PYTHON_INSTALL_DIR: d.python, UV_NO_CONFIG: '1', UV_PYTHON_PREFERENCE: 'only-managed',
      UV_PYTHON_DOWNLOADS: 'automatic', UV_NO_PROGRESS: '1', UV_TOOL_DIR: path.join(d.root, 'uv-tools'), UV_TOOL_BIN_DIR: path.join(d.root, 'uv-tools', 'bin'),
      UV_PYTHON_BIN_DIR: path.join(d.root, 'uv-bin'), TEMP: d.tmp, TMP: d.tmp, TMPDIR: d.tmp,
    });
    return env;
  };

  /** Fetch a URL to `dest` with a resumable .part file; kept only if size and SHA-256 match. */
  async function download(url, dest, bytes, sha256, onBytes, signal) {
    const part = `${dest}.part`;
    let have = 0;
    try { have = (await fsp.stat(part)).size; } catch { have = 0; }
    if (have > bytes) { await fsp.rm(part, { force: true }); have = 0; }
    const doFetch = opts.fetch || require('electron').net.fetch;
    if (have < bytes) {
      const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
      const res = await doFetch(url, { signal, redirect: 'follow', headers });
      if (!res.ok || !res.body) throw new Error(`The server answered ${res.status} for ${path.basename(dest)}.`);
      if (have > 0 && res.status !== 206) have = 0;   // no resume: start over
      const handle = await fsp.open(part, have > 0 ? 'a' : 'w');
      try {
        const reader = res.body.getReader();
        let got = have; let last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
          if (got > bytes) throw new Error(`${path.basename(dest)} is larger than it should be.`);
          await handle.write(value);
          const now = Date.now();
          if (onBytes && now - last > 250) { last = now; onBytes(got); }
        }
      } finally { await handle.close(); }
    }
    const size = (await fsp.stat(part)).size;
    if (size !== bytes) throw new Error(`${path.basename(dest)} is ${size} bytes; it should be ${bytes}.`);
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => { fs.createReadStream(part).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject); });
    if (hash.digest('hex') !== sha256) { await fsp.rm(part, { force: true }); throw new Error(`${path.basename(dest)} is not the file that was asked for (its SHA-256 differs). It was not kept.`); }
    await fsp.rename(part, dest);
  }

  async function dirBytes(p) {
    let total = 0;
    let entries = [];
    try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) total += await dirBytes(full);
      else { try { total += (await fsp.lstat(full)).size; } catch { /* gone */ } }
    }
    return total;
  }

  async function freeDiskBytes() {
    try { await fsp.mkdir(base, { recursive: true }); const s = await fsp.statfs(base); return s.bavail * s.bsize; } catch { return null; }
  }

  async function check(spec) {
    const cards = spec.needs.gpu === 'nvidia' ? await nvidiaCards(run) : [];
    const freeDisk = await freeDiskBytes();
    const problems = machineProblems(spec.needs, cards, freeDisk, platform);
    return { ok: problems.length === 0, problems, cards, freeDiskBytes: freeDisk };
  }

  /** Ready to run: the self-test passed for these packages and every file is in place. */
  async function isReady(spec) {
    const d = dirs(spec.id);
    const st = await readState(d);
    let lockText = '';
    try { lockText = await fsp.readFile(spec.lock, 'utf8'); } catch { return false; }
    const filesOk = spec.files.every((f) => st.files && st.files[f.name] === f.sha256 && fs.existsSync(path.join(d.files, f.name)));
    return !!(st.selftest && st.packages === packagesKey(spec, lockText) && filesOk && fs.existsSync(envPython(d)));
  }

  /** withSize: also measure it on disk (it walks every file, so only when asked). */
  async function status(spec, withSize) {
    const d = dirs(spec.id);
    const ready = await isReady(spec);
    const present = fs.existsSync(d.root);
    return {
      state: ready ? 'ready' : present ? 'partial' : 'absent',
      installing: installs.has(spec.id),
      bytesOnDisk: present && withSize ? await dirBytes(d.root) : null,
      downloadBytes: spec.files.reduce((n, f) => n + f.bytes, 0),
      filesDir: d.files,
    };
  }

  async function install(spec) {
    const d = dirs(spec.id);
    if (installs.has(spec.id)) return { ok: false, error: 'It is already being set up.' };
    if (opts.isSealed && opts.isSealed()) return { ok: false, code: 'SEALED', error: 'This workspace is sealed: nothing is fetched.' };
    const job = { cancelled: false, child: null, controller: new AbortController() };
    installs.set(spec.id, job);
    const step = (name, label, fraction, extra) => send(Object.assign({ id: spec.id, kind: 'install', step: name, label, fraction }, extra || {}));
    const stopIfCancelled = () => { if (job.cancelled) throw Object.assign(new Error('Stopped.'), { stopped: true }); };
    const uvRun = async (args, label) => {
      const r = await run(uvExe(d), args, { env: uvEnv(d), cwd: d.root, onChild: (c) => { job.child = c; } });
      job.child = null;
      stopIfCancelled();
      if (r.code !== 0) throw new Error(`${label}: ${String(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ')}`);
      return r;
    };
    try {
      step('check', 'Checking this computer', 0);
      const machine = await check(spec);
      if (!machine.ok) return { ok: false, code: 'MACHINE', problems: machine.problems, error: machine.problems.join(' ') };
      for (const p of [d.root, d.uv, d.files, d.tmp, d.home]) await fsp.mkdir(p, { recursive: true });
      const st = await readState(d);
      st.files = st.files || {};
      const lockText = await fsp.readFile(spec.lock, 'utf8');
      if (!/--hash=sha256:/.test(lockText)) return { ok: false, error: 'The package list has no hashes, so it cannot be checked.' };

      // 1. uv, pinned, checked against its published SHA-256.
      if (st.uv !== UV_VERSION || !fs.existsSync(uvExe(d))) {
        stopIfCancelled();
        step('uv', 'Fetching the installer', 0.02);
        const build = UV_BUILDS[platform];
        const archive = path.join(d.tmp, build.file);
        const res = await (opts.fetch || require('electron').net.fetch)(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${build.file}`, { signal: job.controller.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`The installer could not be fetched (${res.status}).`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (crypto.createHash('sha256').update(buf).digest('hex') !== build.sha256) throw new Error('The installer is not the one Parallx expects (its SHA-256 differs). It was not used.');
        await fsp.writeFile(archive, buf);
        const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
        const x = await run(tar, ['-xf', archive, '-C', d.uv], {});
        if (x.code !== 0) throw new Error('The installer could not be unpacked.');
        if (!fs.existsSync(uvExe(d))) {
          // The Linux archive keeps uv in a folder of its own.
          const inner = (await fsp.readdir(d.uv, { withFileTypes: true })).find((e) => e.isDirectory());
          if (inner) await fsp.rename(path.join(d.uv, inner.name, build.exe), uvExe(d));
        }
        if (process.platform !== 'win32') await fsp.chmod(uvExe(d), 0o755);
        await fsp.rm(archive, { force: true });
        st.uv = UV_VERSION; await writeState(d, st);
      }

      // 2. Python, from uv, inside the runtime: no shortcut in the user's folder, nothing in the registry.
      if (st.python !== spec.python || !fs.existsSync(envPython(d))) {
        stopIfCancelled();
        step('python', 'Installing Python', 0.05);
        await uvRun(['python', 'install', spec.python, '--native-tls', '--no-bin', '--no-registry'], 'Python could not be installed');
        step('python', 'Making its environment', 0.08);
        await fsp.rm(d.env, { recursive: true, force: true });
        await uvRun(['venv', d.env, '--python', spec.python, '--python-preference', 'only-managed', '--native-tls'], 'The environment could not be made');
        st.python = spec.python; st.packages = null; st.selftest = false; await writeState(d, st);
      }

      // 3. Packages, exactly the lock, every one with its hash.
      const key = packagesKey(spec, lockText);
      if (st.packages !== key) {
        stopIfCancelled();
        step('packages', 'Installing its packages (the largest is about 3 GB)', 0.1);
        await uvRun(['pip', 'sync', spec.lock, '--python', envPython(d), '--require-hashes', '--native-tls', '--index-strategy', 'unsafe-best-match', '--link-mode', 'copy'], 'The packages could not be installed');
        st.packages = key; st.selftest = false; await writeState(d, st);
        await fsp.rm(d.cache, { recursive: true, force: true });
      }

      // 4. Large files, resumable, kept only if their SHA-256 matches.
      const total = spec.files.reduce((n, f) => n + f.bytes, 0);
      let doneBytes = spec.files.filter((f) => st.files[f.name] === f.sha256 && fs.existsSync(path.join(d.files, f.name))).reduce((n, f) => n + f.bytes, 0);
      for (const f of spec.files) {
        const dest = path.join(d.files, f.name);
        if (st.files[f.name] === f.sha256 && fs.existsSync(dest)) continue;
        stopIfCancelled();
        const before = doneBytes;
        await download(f.url, dest, f.bytes, f.sha256, (got) => step('files', `Downloading ${f.name}`, 0.4 + 0.55 * ((before + got) / total), { received: before + got, total }), job.controller.signal);
        doneBytes += f.bytes;
        st.files[f.name] = f.sha256; st.selftest = false; await writeState(d, st);
      }

      // 5. The self-test: the tool's own check that it runs on this card.
      if (!st.selftest) {
        stopIfCancelled();
        step('selftest', 'Checking it runs', 0.97);
        if (spec.selftest) {
          const r = await runScript(spec, spec.selftest.script, spec.selftest.args, null, job);
          stopIfCancelled();
          if (r.code !== 0) throw new Error(`The self-test failed: ${String(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-2).join(' ')}`);
        }
        st.selftest = true; st.readyAt = new Date().toISOString(); await writeState(d, st);
      }
      await fsp.rm(d.tmp, { recursive: true, force: true });
      step('done', 'Ready', 1);
      return { ok: true };
    } catch (err) {
      const stopped = job.cancelled || !!(err && err.stopped);
      const message = stopped ? 'Stopped. Setting up again carries on from here.' : (err && err.message) || String(err);
      send({ id: spec.id, kind: 'install', step: 'error', label: message, fraction: 0, done: true });
      return { ok: false, stopped, error: message };
    } finally {
      installs.delete(spec.id);
    }
  }

  /** The runtime's Python, argv form, rebuilt environment; JSON lines on stdout become progress. */
  function runScript(spec, script, args, runId, job) {
    const d = dirs(spec.id);
    const env = {};
    for (const k of ['SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'LANG', 'CUDA_VISIBLE_DEVICES']) if (process.env[k] !== undefined) env[k] = process.env[k];
    env.PATH = [path.dirname(envPython(d)), process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin'].join(path.delimiter);
    Object.assign(env, {
      PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
      PYTHONPYCACHEPREFIX: path.join(d.root, 'pycache'), TEMP: d.tmp, TMP: d.tmp, TMPDIR: d.tmp,
      HF_HOME: path.join(d.home, 'hf'), HF_HUB_OFFLINE: '1', TORCH_HOME: path.join(d.home, 'torch'), XDG_CACHE_HOME: path.join(d.home, 'cache'),
      MPLCONFIGDIR: path.join(d.home, 'mpl'), PARALLX_RUNTIME_FILES: d.files,
      // Number the cards as nvidia-smi does, so the card a tool checks is the card that runs.
      CUDA_DEVICE_ORDER: 'PCI_BUS_ID',
    });
    fs.mkdirSync(d.tmp, { recursive: true });
    let stall = null;
    let child = null;
    const arm = () => { if (stall) clearTimeout(stall); stall = setTimeout(() => killTree(child), RUN_STALL_MS); };
    arm();
    return run(envPython(d), [script, ...args], {
      env, cwd: path.dirname(script),
      onChild: (c) => { child = c; if (job) job.child = c; if (runId) runs.set(runId, { child: c, id: spec.id }); },
      onLine: (line) => {
        arm();
        if (!runId || line[0] !== '{') return;
        try { send({ id: spec.id, kind: 'run', runId, data: JSON.parse(line) }); } catch { /* a plain line */ }
      },
    }).then((r) => { if (stall) clearTimeout(stall); return r; });
  }

  const specOf = (raw) => checkSpec(raw, opts.appRoot);

  ipcMain.handle('runtimes:check', async (_e, raw) => { const c = specOf(raw); return c.error ? { ok: false, error: c.error } : check(c.spec); });
  ipcMain.handle('runtimes:status', async (_e, raw, withSize) => { const c = specOf(raw); return c.error ? { error: c.error } : status(c.spec, withSize === true); });
  ipcMain.handle('runtimes:install', async (_e, raw) => { const c = specOf(raw); return c.error ? { ok: false, error: c.error } : install(c.spec); });
  ipcMain.handle('runtimes:cancel', (_e, idOrRun) => {
    const job = installs.get(String(idOrRun));
    if (job) { job.cancelled = true; job.controller.abort(); killTree(job.child); return { ok: true }; }
    const r = runs.get(String(idOrRun));
    if (r) { r.cancelled = true; killTree(r.child); return { ok: true }; }
    return { ok: false };
  });
  ipcMain.handle('runtimes:remove', async (_e, raw) => {
    const c = specOf(raw); if (c.error) return { ok: false, error: c.error };
    if (installs.has(c.spec.id) || [...runs.values()].some((r) => r.id === c.spec.id)) return { ok: false, error: 'It is in use. Stop it first.' };
    await fsp.rm(dirs(c.spec.id).root, { recursive: true, force: true });
    return { ok: true };
  });
  ipcMain.handle('runtimes:run', async (_e, raw, script, args, runId) => {
    const c = specOf(raw); if (c.error) return { ok: false, error: c.error };
    const s = path.resolve(String(script || ''));
    if (!s.startsWith(path.resolve(opts.appRoot) + path.sep) || !s.endsWith('.py')) return { ok: false, error: 'Only a script inside the app can run.' };
    if (!(await isReady(c.spec))) return { ok: false, code: 'NOT_READY', error: 'It is not set up yet.' };
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(runId || '')) ? String(runId) : crypto.randomUUID();
    const r = await runScript(c.spec, s, (Array.isArray(args) ? args : []).map(String), id, null);
    const entry = runs.get(id);
    runs.delete(id);
    if (entry && entry.cancelled) return { ok: false, stopped: true, error: 'Stopped.' };
    if (r.code !== 0) return { ok: false, code: 'FAILED', error: String(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ') || `It stopped with code ${r.code}.`, stderr: r.stderr };
    return { ok: true, stdout: r.stdout };
  });

  return { base };
}

module.exports = { setupRuntimeBridge, _internals: { checkSpec, machineProblems, packagesKey, UV_BUILDS, UV_VERSION, ALLOWED_FILE_HOSTS } };
