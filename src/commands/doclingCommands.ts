// doclingCommands.ts — Docling installation and diagnostics commands
//
// M21 Phase F.3: Provides the `Parallx: Install Docling` command that
// detects Python, installs the Docling package via pip, and verifies
// the installation.

import type { CommandDescriptor } from './commandTypes.js';
import type { INotificationService } from '../services/serviceTypes.js';
import type { NotificationAction } from '../api/notificationService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DoclingElectronApi {
  status(): Promise<{
    status: string;
    port: number | null;
    pythonPath: string | null;
    doclingInstalled: boolean;
  }>;
  start(): Promise<{ ok: boolean }>;
  install(): Promise<{
    ok: boolean;
    pythonPath: string | null;
    output: string;
    alreadyInstalled: boolean;
  }>;
}

function getDoclingApi(): DoclingElectronApi | undefined {
  return (globalThis as any).parallxElectron?.docling as DoclingElectronApi | undefined;
}

// ─── Install Docling Command ─────────────────────────────────────────────────

export const installDocling: CommandDescriptor = {
  id: 'parallx.installDocling',
  title: 'Install Docling',
  category: 'Parallx',
  handler: async (ctx) => {
    const notifications = ctx.getService<INotificationService>('INotificationService');
    const api = getDoclingApi();

    if (!api) {
      notifications?.warn(
        'Docling installation requires the Electron desktop app.',
      );
      return;
    }

    // Step 1: Check current status
    const status = await api.status();

    if (status.doclingInstalled && status.status === 'available') {
      notifications?.info(
        `Docling is already installed and running (Python: ${status.pythonPath}).`,
      );
      return;
    }

    if (!status.pythonPath) {
      notifications?.error(
        'Python 3.10+ not found. Please install Python from https://www.python.org/downloads/ and restart Parallx.',
      );
      return;
    }

    // Step 2: Already installed but service not running
    if (status.doclingInstalled) {
      notifications?.info('Docling is installed. Starting the bridge service…');
      try {
        const startResult = await api.start();
        if (startResult.ok) {
          notifications?.info('Docling bridge service started successfully.');
        } else {
          notifications?.warn(
            'Docling is installed but the bridge service failed to start. Check the Output panel for details.',
          );
        }
      } catch {
        notifications?.error('Failed to start Docling bridge service.');
      }
      return;
    }

    // Step 3: Not installed — confirm and install
    const installAction: NotificationAction = { title: 'Install' };
    const cancelAction: NotificationAction = { title: 'Cancel' };
    const proceed = await notifications?.info(
      `Install Docling? This will run "pip install docling" using ${status.pythonPath}. This may take a few minutes.`,
      installAction,
      cancelAction,
    );

    if (!proceed || proceed.title !== 'Install') return;

    notifications?.info('Installing Docling… This may take a few minutes.');

    try {
      const result = await api.install();

      if (result.ok) {
        if (result.alreadyInstalled) {
          notifications?.info('Docling was already installed.');
        } else {
          notifications?.info('Docling installed successfully! Starting the bridge service…');
        }

        // Auto-start the service after install
        try {
          const startResult = await api.start();
          if (startResult.ok) {
            notifications?.info('Docling is ready. Rich document extraction is now active.');
          } else {
            notifications?.warn(
              'Docling installed but the bridge service failed to start. Try restarting Parallx.',
            );
          }
        } catch {
          notifications?.warn(
            'Docling installed but could not start the bridge service automatically.',
          );
        }
      } else {
        notifications?.error(`Docling installation failed: ${result.output}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notifications?.error(`Docling installation error: ${msg}`);
    }
  },
};
