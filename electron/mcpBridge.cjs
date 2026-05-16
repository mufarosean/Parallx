// electron/mcpBridge.cjs — MCP stdio child process management (D1)
// Spawns MCP server processes and bridges JSON-RPC over IPC.

const { spawn } = require('child_process');
const { promises: nodeFs } = require('node:fs');
const nodePath = require('node:path');
const nodeOs = require('node:os');
const { shell } = require('electron');

/** @type {Map<string, import('child_process').ChildProcess>} */
const processes = new Map();

/**
 * True when the args list belongs to the bundled Gmail MCP server.
 * @param {string[]} args
 */
function _isGmailServer(args) {
  return Array.isArray(args) && args.some((a) => String(a).includes('gmail-mcp-server'));
}

/**
 * Migrate credentials from the legacy home-dir path to APP_ROOT/data.
 * Runs once — if the destination already exists the function is a no-op.
 * @param {string} appRoot
 */
async function _migrateGmailCreds(appRoot) {
  const oldPath = nodePath.join(nodeOs.homedir(), '.parallx', 'gmail-mcp', 'credentials.json');
  const newPath = nodePath.join(appRoot, 'data', 'gmail-mcp', 'credentials.json');
  try {
    const oldExists = await nodeFs.access(oldPath).then(() => true).catch(() => false);
    const newExists = await nodeFs.access(newPath).then(() => true).catch(() => false);
    if (oldExists && !newExists) {
      await nodeFs.mkdir(nodePath.dirname(newPath), { recursive: true });
      await nodeFs.copyFile(oldPath, newPath);
      try { await nodeFs.chmod(newPath, 0o600); } catch { /* tolerate Windows */ }
      console.log('[MCP:gmail] migrated credentials', oldPath, '->', newPath);
    }
  } catch (err) {
    console.warn('[MCP:gmail] credential migration failed:', err && err.message);
  }
}

/**
 * Inject PARALLX_GMAIL_CRED_PATH into the env when spawning the Gmail server.
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @param {string | undefined} appRoot
 */
function _injectGmailEnv(args, env, appRoot) {
  if (!appRoot || !_isGmailServer(args)) return env;
  return {
    ...env,
    PARALLX_GMAIL_CRED_PATH: nodePath.join(appRoot, 'data', 'gmail-mcp', 'credentials.json'),
  };
}

function setupMcpBridge(ipcMain, getMainWindow, appRoot) {
  ipcMain.handle('mcp:spawn', async (_event, serverId, command, args, env) => {
    if (typeof serverId !== 'string' || !serverId) {
      return { error: 'Invalid serverId' };
    }
    if (typeof command !== 'string' || !command) {
      return { error: 'Invalid command' };
    }
    if (processes.has(serverId)) {
      return { error: `Server ${serverId} already running` };
    }

    try {
      const safeArgs = Array.isArray(args)
        ? args.filter((a) => typeof a === 'string')
        : [];

      // M67 P1-3: migrate Gmail creds before the server starts.
      if (_isGmailServer(safeArgs)) await _migrateGmailCreds(appRoot);

      // Security: Use spawn (not exec), explicit args array.
      // On Windows, shell: true is needed to resolve .cmd/.bat wrappers (e.g. npx.cmd).
      // This is safe because args are an explicit array, not concatenated into a string.
      const isWin = process.platform === 'win32';
      const child = spawn(command, safeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWin,
        env: { ..._injectGmailEnv(safeArgs, filterEnv(env, appRoot), appRoot) },
        windowsHide: true,
      });

      let buffer = '';
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        // JSON-RPC messages are newline-delimited
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('mcp:message', serverId, trimmed);
            }
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        console.warn(`[MCP:${serverId}:stderr]`, chunk.toString('utf8'));
      });

      child.on('exit', (code) => {
        processes.delete(serverId);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('mcp:exit', serverId, code);
        }
      });

      child.on('error', (err) => {
        console.error(`[MCP:${serverId}:error]`, err.message);
        processes.delete(serverId);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('mcp:exit', serverId, null);
        }
      });

      processes.set(serverId, child);
      return { error: null };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('mcp:send', async (_event, serverId, message) => {
    if (typeof serverId !== 'string' || typeof message !== 'string') {
      return { error: 'Invalid arguments' };
    }
    const child = processes.get(serverId);
    if (!child?.stdin?.writable) {
      return { error: `Server ${serverId} not connected` };
    }
    child.stdin.write(message + '\n', 'utf8');
    return { error: null };
  });

  ipcMain.handle('mcp:kill', async (_event, serverId) => {
    if (typeof serverId !== 'string') {
      return { error: 'Invalid serverId' };
    }
    const child = processes.get(serverId);
    if (child) {
      child.kill('SIGTERM');
      processes.delete(serverId);
    }
    return { error: null };
  });

  // ── mcp:oauth-bootstrap ────────────────────────────────────────────
  // M62 follow-up: run the server's `--auth` subcommand so the user
  // never has to open a terminal. Spawns `<command> <args> --auth`,
  // watches stderr for the Google authorization URL, opens it in the
  // user's default browser, and resolves with the exit code. The
  // server process exits 0 on success and writes its credentials file
  // itself — no main-process credential handling.
  ipcMain.handle('mcp:oauth-bootstrap', async (_event, serverId, command, args, env) => {
    if (typeof serverId !== 'string' || !serverId) {
      return { error: 'Invalid serverId', exitCode: null };
    }
    if (typeof command !== 'string' || !command) {
      return { error: 'Invalid command', exitCode: null };
    }
    const safeArgs = Array.isArray(args)
      ? args.filter((a) => typeof a === 'string')
      : [];

    const gmailEnv = _injectGmailEnv(safeArgs, filterEnv(env, appRoot), appRoot);

    return new Promise((resolve) => {
      let child;
      try {
        const isWin = process.platform === 'win32';
        child = spawn(command, [...safeArgs, '--auth'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: isWin,
          env: { ...gmailEnv },
          windowsHide: true,
        });
      } catch (err) {
        resolve({ error: err.message, exitCode: null });
        return;
      }

      let urlOpened = false;
      let stderrBuf = '';
      const URL_RE = /https:\/\/accounts\.google\.com\/[^\s]+/;

      const send = (channel, payload) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send(channel, serverId, payload);
      };

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderrBuf += text;
        send('mcp:oauth-stderr', text);
        if (!urlOpened) {
          const m = stderrBuf.match(URL_RE);
          if (m) {
            urlOpened = true;
            shell.openExternal(m[0]).catch((err) => {
              console.warn('[MCP:oauth] openExternal failed:', err.message);
            });
            send('mcp:oauth-url', m[0]);
          }
        }
      });

      // 5-min timeout — matches the server's loopback timeout.
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }, 5 * 60 * 1000);

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ error: null, exitCode: code, stderr: stderrBuf });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ error: err.message, exitCode: null, stderr: stderrBuf });
      });
    });
  });
}

// Security: Only pass explicitly declared env vars, never inherit full process.env
function filterEnv(env, appRoot) {
  // Point TMPDIR/TEMP/TMP to the app-controlled tmp dir so spawned servers
  // never write temp files to a world-readable system location. Falls back to
  // the system default when appRoot is not yet known.
  const appTmpDir = appRoot
    ? nodePath.join(appRoot, 'data', 'tmp')
    : (process.env.TMPDIR || process.env.TEMP || process.env.TMP || '');
  const base = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || process.env.USERPROFILE || '',
    LANG: process.env.LANG || '',
    TMPDIR: appTmpDir,
    TEMP: appTmpDir,
    TMP: appTmpDir,
  };
  // R-04: Windows needs additional critical env vars
  if (process.platform === 'win32') {
    base.SYSTEMROOT = process.env.SYSTEMROOT || 'C:\\Windows';
    base.SYSTEMDRIVE = process.env.SYSTEMDRIVE || 'C:';
    base.COMSPEC = process.env.COMSPEC || '';
    base.PATHEXT = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    base.USERPROFILE = process.env.USERPROFILE || '';
  }
  // Add declared env vars
  if (env && typeof env === 'object') {
    for (const [key, value] of Object.entries(env)) {
      if (typeof key === 'string' && typeof value === 'string') {
        base[key] = value;
      }
    }
  }
  return base;
}

function killAllMcpProcesses() {
  const isWin = process.platform === 'win32';
  for (const [serverId, child] of processes) {
    try {
      if (isWin && child.pid) {
        // On Windows, SIGTERM doesn't reliably kill process trees.
        // Use taskkill /T /F to kill the entire tree synchronously.
        try {
          require('child_process').execSync(
            `taskkill /pid ${child.pid} /T /F`,
            { windowsHide: true, timeout: 3000 },
          );
        } catch { /* process may already be dead */ }
      } else {
        child.kill('SIGTERM');
      }
    } catch (e) {
      console.warn(`[MCP] Failed to kill ${serverId}:`, e.message);
    }
  }
  processes.clear();
}

module.exports = { setupMcpBridge, killAllMcpProcesses };
