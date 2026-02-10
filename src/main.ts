// src/main.ts — Renderer entry point
// Boots the Parallx workbench inside the Electron renderer process.
// Delegates all orchestration to the Workbench class and its lifecycle phases.

import { Workbench } from './workbench/workbench.js';

// ── Electron window controls bridge ──

declare global {
  interface Window {
    parallxElectron?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (maximized: boolean) => void) => void;
      scanToolDirectory: (dirPath: string) => Promise<{ entries: { toolPath: string; manifestJson?: unknown; error?: string }[]; error: string | null }>;
      getToolDirectories: () => Promise<{ builtinDir: string; userDir: string }>;
    };
  }
}

// ── Bootstrap ──

async function bootstrap(): Promise<void> {
  const container = document.getElementById('workbench');
  if (!container) {
    throw new Error('Missing #workbench element');
  }

  // Create and initialize the workbench (runs 5-phase lifecycle)
  const workbench = new Workbench(container);
  await workbench.initialize();

  // Electron shutdown hook — fire-and-forget async shutdown.
  // `beforeunload` cannot await, so we kick off shutdown synchronously
  // and rely on the lifecycle teardown chain saving state.
  // The workbench's WorkspaceSaver auto-saves on structural changes,
  // so the risk window for data loss is minimal.
  window.addEventListener('beforeunload', () => {
    workbench.shutdown().catch((err) => {
      console.error('Shutdown error:', err);
    });
  });

  console.log('Parallx workbench started.');
}

// ── Start ──

document.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to start Parallx workbench:', err);
  });
});
