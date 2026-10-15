/**
 * Tool runtimes (electron/runtimeBridge.cjs, docs/ENHANCE.md): the
 * declaration check, the machine check's words, and a whole setup against
 * a fake machine: the steps in order, uv kept inside the runtime's folder
 * (no shortcut in the user's folder, nothing in the registry, the system's
 * certificates), packages only with hashes, a damaged download refused, and
 * a stopped setup carrying on where it stopped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const bridge = require('../../electron/runtimeBridge.cjs');
const { checkSpec, machineProblems, UV_VERSION, UV_BUILDS } = bridge._internals;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PLATFORM = `${process.platform}-${process.arch}`;

let appRoot = '';
let runtimes = '';
let lock = '';
let script = '';

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), 'px-rt-app-'));
  runtimes = join(appRoot, 'data', 'runtimes');
  process.env.PARALLX_RUNTIMES_DIR = runtimes;
  mkdirSync(join(appRoot, 'ext', 'tool'), { recursive: true });
  lock = join(appRoot, 'ext', 'tool', 'requirements.lock');
  writeFileSync(lock, 'numpy==2.5.2 \\\n    --hash=sha256:' + 'a'.repeat(64) + '\n');
  script = join(appRoot, 'ext', 'tool', 'selftest.py');
  writeFileSync(script, 'print("ok")\n');
});
afterEach(() => {
  delete process.env.PARALLX_RUNTIMES_DIR;
  rmSync(appRoot, { recursive: true, force: true });
});

const FILE = Buffer.from('model weights');
function spec(extra: Record<string, unknown> = {}) {
  return {
    id: 'engine', title: 'Engine', python: '3.13.16',
    locks: { [process.platform]: lock },
    files: [{ name: 'weights.safetensors', url: 'https://huggingface.co/x/resolve/main/weights.safetensors', bytes: FILE.length, sha256: sha(FILE) }],
    needs: { platforms: [PLATFORM], gpu: 'nvidia', minVramMiB: 16000, minDriver: 570, diskBytes: 1 },
    selftest: { script, args: ['--check'] },
    ...extra,
  };
}

describe('the declaration', () => {
  it('accepts a full one and refuses what cannot be checked', () => {
    expect(checkSpec(spec(), appRoot).spec.id).toBe('engine');
    expect(checkSpec(spec({ id: 'Bad Id' }), appRoot).error).toMatch(/id/);
    expect(checkSpec(spec({ python: '3.13' }), appRoot).error).toMatch(/exact Python/);
    expect(checkSpec(spec({ locks: { [process.platform]: join(tmpdir(), 'elsewhere.lock') } }), appRoot).error).toMatch(/inside the app/);
    expect(checkSpec(spec({ files: [{ name: 'w', url: 'http://huggingface.co/w', bytes: 1, sha256: sha('w') }] }), appRoot).error).toMatch(/https/);
    expect(checkSpec(spec({ files: [{ name: 'w', url: 'https://evil.example/w', bytes: 1, sha256: sha('w') }] }), appRoot).error).toMatch(/huggingface/);
    expect(checkSpec(spec({ files: [{ name: 'w', url: 'https://huggingface.co/w', bytes: 1 }] }), appRoot).error).toMatch(/SHA-256/);
    expect(checkSpec(spec({ files: [{ name: '../w', url: 'https://huggingface.co/w', bytes: 1, sha256: sha('w') }] }), appRoot).error).toMatch(/plain name/);
    expect(checkSpec(spec({ selftest: { script: join(tmpdir(), 'x.py') } }), appRoot).error).toMatch(/inside the app/);
  });
});

describe('the machine check, in words', () => {
  const needs = { platforms: ['win32-x64', 'linux-x64'], gpu: 'nvidia', minVramMiB: 16000, minDriver: 570, diskBytes: 20 * 1024 ** 3 };
  it('passes a card with room', () => {
    expect(machineProblems(needs, [{ name: 'RTX 5090', vramMiB: 32607, freeMiB: 30000, driver: '617.42' }], 100 * 1024 ** 3, 'win32-x64')).toEqual([]);
  });
  it('names each problem', () => {
    expect(machineProblems(needs, [], 100 * 1024 ** 3, 'win32-x64')[0]).toMatch(/NVIDIA graphics card/);
    const p = machineProblems(needs, [{ name: 'RTX 3060', vramMiB: 12288, freeMiB: 12000, driver: '536.1' }], 5 * 1024 ** 3, 'win32-x64');
    expect(p.join(' ')).toMatch(/16 GB of memory; RTX 3060 has 12 GB/);
    expect(p.join(' ')).toMatch(/driver 570 or newer; this one is 536.1/);
    expect(p.join(' ')).toMatch(/20 GB free.*there is 5 GB/);
    expect(machineProblems(needs, [], 0, 'darwin-arm64')[0]).toMatch(/Windows and Linux only/);
  });
});

/** A fake machine: uv's steps make the files they would make; nvidia-smi reports a 5090. */
function fakeMachine(over: { pipCode?: number } = {}) {
  const calls: { file: string; args: string[]; env: Record<string, string> }[] = [];
  const run = async (file: string, args: string[], o: { env?: Record<string, string>; onLine?: (l: string) => void } = {}) => {
    calls.push({ file, args, env: o.env || {} });
    if (file.endsWith('nvidia-smi.exe') || file === 'nvidia-smi') return { code: 0, stdout: 'NVIDIA GeForce RTX 5090, 32607, 30000, 617.42\n', stderr: '' };
    if (args[0] === 'venv') {
      const py = process.platform === 'win32' ? join(args[1], 'Scripts', 'python.exe') : join(args[1], 'bin', 'python');
      mkdirSync(dirname(py), { recursive: true }); writeFileSync(py, '');
    }
    if (args[0] === 'pip') return { code: over.pipCode ?? 0, stdout: '', stderr: over.pipCode ? 'error: hash mismatch' : '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
}

function fakeFetch(body: Buffer) {
  return async (_url: string, init: { headers?: Record<string, string> } = {}) => {
    const range = init.headers && init.headers.Range;
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const chunk = body.subarray(from);
    return {
      ok: true, status: range ? 206 : 200,
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(chunk)); c.close(); } }),
      arrayBuffer: async () => chunk,
    };
  };
}

function connect(run: unknown, fetch: unknown) {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sent: Record<string, unknown>[] = [];
  bridge.setupRuntimeBridge({ handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) }, {
    appRoot, run, fetch,
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, p: Record<string, unknown>) => sent.push(p) } }),
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) as Promise<Record<string, unknown>>;
  return { call, sent };
}

/** uv already in place, as if fetched (its archive's real SHA-256 cannot be faked here). */
function placeUv() {
  const root = join(runtimes, 'engine');
  mkdirSync(join(root, 'uv'), { recursive: true });
  writeFileSync(join(root, 'uv', UV_BUILDS[PLATFORM].exe), '');
  writeFileSync(join(root, 'state.json'), JSON.stringify({ uv: UV_VERSION }));
}

describe('a whole setup on a fake machine', () => {
  it('runs the steps in order, keeps uv inside the runtime, requires hashes, and is then ready', async () => {
    placeUv();
    const m = fakeMachine();
    const { call, sent } = connect(m.run, fakeFetch(FILE));
    const r = await call('runtimes:install', spec());
    expect(r).toEqual({ ok: true });

    const uv = m.calls.filter((c) => c.file.includes(join('engine', 'uv')));
    const py = uv.find((c) => c.args[0] === 'python')!;
    expect(py.args).toEqual(['python', 'install', '3.13.16', '--native-tls', '--no-bin', '--no-registry']);
    const venv = uv.find((c) => c.args[0] === 'venv')!;
    expect(venv.args).toContain('--native-tls');
    const pip = uv.find((c) => c.args[0] === 'pip')!;
    expect(pip.args.slice(0, 3)).toEqual(['pip', 'sync', lock]);
    expect(pip.args).toEqual(expect.arrayContaining(['--require-hashes', '--native-tls']));
    // Everything uv caches or installs stays in the runtime's folder.
    const root = join(runtimes, 'engine');
    for (const k of ['UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'UV_TOOL_DIR', 'UV_PYTHON_BIN_DIR', 'TEMP', 'TMP'])
      expect(py.env[k].startsWith(root), `${k} = ${py.env[k]}`).toBe(true);
    expect(py.env.UV_NO_CONFIG).toBe('1');
    // The self-test ran in the runtime's Python with a rebuilt environment.
    const st = m.calls.find((c) => c.args[0] === script)!;
    expect(st.args).toEqual([script, '--check']);
    expect(st.env.PYTHONNOUSERSITE).toBe('1');
    expect(st.env.HF_HUB_OFFLINE).toBe('1');
    expect(st.env.PYTHONPATH).toBeUndefined();

    expect(readFileSync(join(root, 'files', 'weights.safetensors'))).toEqual(FILE);
    expect(sent.map((p) => p.step)).toEqual(expect.arrayContaining(['check', 'python', 'packages', 'files', 'selftest', 'done']));
    expect((await call('runtimes:status', spec())).state).toBe('ready');
  });

  it('refuses a download whose SHA-256 differs, and keeps nothing of it', async () => {
    placeUv();
    const m = fakeMachine();
    const { call } = connect(m.run, fakeFetch(Buffer.from('other weights!')));
    const r = await call('runtimes:install', spec({ files: [{ name: 'weights.safetensors', url: 'https://huggingface.co/w', bytes: 14, sha256: sha(FILE) }] }));
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/SHA-256 differs/);
    const files = join(runtimes, 'engine', 'files');
    expect(existsSync(join(files, 'weights.safetensors'))).toBe(false);
    expect(existsSync(join(files, 'weights.safetensors.part'))).toBe(false);
  });

  it('stops on a package that fails its hash, and carries on from there next time', async () => {
    placeUv();
    const bad = fakeMachine({ pipCode: 1 });
    const first = connect(bad.run, fakeFetch(FILE));
    const r = await first.call('runtimes:install', spec());
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/packages could not be installed/);
    expect((await first.call('runtimes:status', spec())).state).toBe('partial');

    const good = fakeMachine();
    const second = connect(good.run, fakeFetch(FILE));
    expect(await second.call('runtimes:install', spec())).toEqual({ ok: true });
    // Python and its environment were already made: not made again.
    expect(good.calls.some((c) => c.args[0] === 'python')).toBe(false);
    expect(good.calls.some((c) => c.args[0] === 'pip')).toBe(true);
  });

  it('says what the machine lacks instead of installing', async () => {
    const m = fakeMachine();
    const { call } = connect(m.run, fakeFetch(FILE));
    const r = await call('runtimes:install', spec({ needs: { platforms: [PLATFORM], gpu: 'nvidia', minVramMiB: 65536 } }));
    expect(r.code).toBe('MACHINE');
    expect(String(r.error)).toMatch(/64 GB of memory/);
    expect(m.calls.some((c) => c.args[0] === 'python')).toBe(false);
  });

  it('runs only scripts inside the app, and only when ready', async () => {
    const m = fakeMachine();
    const { call } = connect(m.run, fakeFetch(FILE));
    expect((await call('runtimes:run', spec(), join(tmpdir(), 'x.py'), [])).error).toMatch(/inside the app/);
    expect((await call('runtimes:run', spec(), script, [])).code).toBe('NOT_READY');
  });
});
