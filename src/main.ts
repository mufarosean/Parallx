// src/main.ts — Renderer entry point
// Boots the Parallx workbench inside the Electron renderer process.
// Delegates all orchestration to the Workbench class and its lifecycle phases.

import { Workbench } from './workbench/workbench.js';

// ── Electron window controls bridge ──

declare global {
  interface Window {
    parallxElectron?: {
      platform: string;
      testMode?: boolean;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (maximized: boolean) => void) => void;
      scanToolDirectory: (dirPath: string) => Promise<{ entries: { toolPath: string; manifestJson?: unknown; error?: string }[]; error: string | null }>;
      getToolDirectories: () => Promise<{ builtinDir: string; userDir: string }>;

      // ── Filesystem API (M4 Cap 0) ──
      fs: {
        readFile(path: string, encoding?: string): Promise<{ content: string; encoding: string; size: number; mtime: number } | { error: { code: string; message: string; path: string } }>;
        writeFile(path: string, content: string, encoding?: string): Promise<{ error: null } | { error: { code: string; message: string; path: string } }>;
        stat(path: string): Promise<{ type: string; size: number; mtime: number; ctime: number; isReadonly: boolean; error: null } | { error: { code: string; message: string; path: string } }>;
        readdir(path: string): Promise<{ entries: { name: string; type: string; size: number; mtime: number }[]; error: null } | { error: { code: string; message: string; path: string } }>;
        exists(path: string): Promise<boolean>;
        rename(oldPath: string, newPath: string): Promise<{ error: null } | { error: { code: string; message: string; path: string } }>;
        delete(path: string, options?: { useTrash?: boolean; recursive?: boolean }): Promise<{ error: null } | { error: { code: string; message: string; path: string } }>;
        mkdir(path: string): Promise<{ error: null } | { error: { code: string; message: string; path: string } }>;
        copy(source: string, destination: string): Promise<{ error: null } | { error: { code: string; message: string; path: string } }>;
        watch(path: string, options?: { recursive?: boolean }): Promise<{ watchId: string; error: null } | { error: { code: string; message: string; path: string } }>;
        unwatch(watchId: string): Promise<{ error: null }>;
        onDidChange(callback: (payload: { watchId: string; events?: { type: string; path: string }[]; error?: { code: string; message: string; path: string } }) => void): () => void;
      };

      // ── Dialog API (M4 Cap 0) ──
      dialog: {
        openFile(options?: { multiSelect?: boolean; filters?: { name: string; extensions: string[] }[]; defaultPath?: string }): Promise<string[] | null>;
        openFolder(options?: { multiSelect?: boolean; defaultPath?: string }): Promise<string[] | null>;
        saveFile(options?: { filters?: { name: string; extensions: string[] }[]; defaultPath?: string; defaultName?: string }): Promise<string | null>;
        showMessageBox(options: { type?: string; title?: string; message: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number; checkboxLabel?: string; checkboxChecked?: boolean }): Promise<{ response: number; checkboxChecked: boolean }>;
      };
    };
  }
}

// ── Bootstrap ──

async function bootstrap(): Promise<void> {
  const container = document.getElementById('workbench');
  if (!container) {
    throw new Error('Missing #workbench element');
  }

  // In test mode, clear all persisted state so each test run starts clean
  if (window.parallxElectron?.testMode) {
    localStorage.clear();
    sessionStorage.clear();
    console.log('[TestMode] Cleared persisted state');
  }

  // Create and initialize the workbench (runs 5-phase lifecycle)
  const workbench = new Workbench(container);
  await workbench.initialize();

  // In test mode, expose the workbench instance for E2E test automation
  if (window.parallxElectron?.testMode) {
    (window as any).__parallx_workbench__ = workbench;
  }

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
