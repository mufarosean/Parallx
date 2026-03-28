// electron/mcpBridge.cjs — MCP stdio child process management (D1)
// Spawns MCP server processes and bridges JSON-RPC over IPC.

const { spawn } = require('child_process');

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

      // Security: Use spawn (not exec), no shell, explicit args array
      const child = spawn(command, safeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
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
  for (const [serverId, child] of processes) {
    try {
      child.kill('SIGTERM');
    } catch (e) {
      console.warn(`[MCP] Failed to kill ${serverId}:`, e.message);
    }
  }
  processes.clear();
}

module.exports = { setupMcpBridge, killAllMcpProcesses };
