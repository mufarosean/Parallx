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

  // Electron shutdown hook
  window.addEventListener('beforeunload', () => {
    workbench.shutdown();
  });

  console.log('Parallx workbench started.');
}

// ── Start ──

document.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to start Parallx workbench:', err);
  });
});
