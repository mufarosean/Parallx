// electron/mcpBridge.cjs — MCP stdio child process management (D1)
// Spawns MCP server processes and bridges JSON-RPC over IPC.

const { spawn } = require('child_process');
const { shell } = require('electron');

/** @type {Map<string, import('child_process').ChildProcess>} */
const processes = new Map();

function setupMcpBridge(ipcMain, getMainWindow) {
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

      // Security: Use spawn (not exec), explicit args array.
      // On Windows, shell: true is needed to resolve .cmd/.bat wrappers (e.g. npx.cmd).
      // This is safe because args are an explicit array, not concatenated into a string.
      const isWin = process.platform === 'win32';
      const child = spawn(command, safeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWin,
        env: { ...filterEnv(env) },
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

    return new Promise((resolve) => {
      let child;
      try {
        const isWin = process.platform === 'win32';
        child = spawn(command, [...safeArgs, '--auth'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: isWin,
          env: { ...filterEnv(env) },
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
function filterEnv(env) {
  const base = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || process.env.USERPROFILE || '',
    LANG: process.env.LANG || '',
  };
  // R-04: Windows needs additional critical env vars
  if (process.platform === 'win32') {
    base.SYSTEMROOT = process.env.SYSTEMROOT || 'C:\\Windows';
    base.SYSTEMDRIVE = process.env.SYSTEMDRIVE || 'C:';
    base.TEMP = process.env.TEMP || '';
    base.TMP = process.env.TMP || '';
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
