// doclingCommands.ts — setting up the document reader.
//
// The reader (Docling, with its scan reader) runs in an engine Parallx sets
// up itself: its own Python, its packages and its models, each checked
// against a hash (electron/doclingRuntime.cjs). This command sets it up,
// carries on a set-up that stopped, or starts the reader when it is already
// there.

import type { CommandDescriptor } from './commandTypes.js';
import type { INotificationService } from '../services/serviceTypes.js';
import type { NotificationAction } from '../api/notificationService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DoclingEngineStatus {
  state: 'absent' | 'partial' | 'ready';
  installing: boolean;
  downloadBytes?: number;
  packageBytes?: number;
  machine?: { ok: boolean; problems: string[] };
}

interface DoclingElectronApi {
  status(): Promise<{ status: string; doclingInstalled: boolean; engine?: 'managed' | 'system' | null }>;
  start(): Promise<{ ok: boolean }>;
  install(): Promise<{ ok: boolean; output: string; alreadyInstalled: boolean; stopped?: boolean }>;
  engineStatus(withSize?: boolean): Promise<DoclingEngineStatus>;
}

interface RuntimeProgress { id?: string; kind?: string; step?: string; label?: string }

function electron(): { docling?: DoclingElectronApi; optionalBridges?: { on(channel: string, cb: (p: RuntimeProgress) => void): () => void } } | undefined {
  return (globalThis as { parallxElectron?: ReturnType<typeof electron> }).parallxElectron;
}

/** The engine's id in electron/doclingRuntime.cjs: its progress events carry it. */
const ENGINE_ID = 'docling';

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** What each stage of the set-up is called while it runs. */
const STAGE_NOTES: Record<string, string> = {
  python: 'Document reader: installing its Python.',
  packages: 'Document reader: installing its packages. This is the longest part.',
  files: 'Document reader: downloading its models.',
  selftest: 'Document reader: checking that it reads a page.',
};

// ─── Set Up Document Reader ──────────────────────────────────────────────────

export const installDocling: CommandDescriptor = {
  id: 'parallx.installDocling',
  title: 'Set Up Document Reader…',
  category: 'Parallx',
  handler: async (ctx) => {
    const notifications = ctx.getService<INotificationService>('INotificationService');
    const api = electron()?.docling;

    if (!api) {
      notifications?.warn('The document reader needs the desktop app.');
      return;
    }

    const start = async (): Promise<void> => {
      const started = await api.start().catch(() => ({ ok: false }));
      if (started.ok) notifications?.info('The document reader is running. PDFs, Word files and scans are read with their tables, formulas and layout.');
      else notifications?.warn('The document reader is set up but did not start. Restart Parallx and try again.');
    };

    const status = await api.status();
    if (status.status === 'available') {
      notifications?.info('The document reader is set up and running.');
      return;
    }

    const engine = await api.engineStatus();
    if (engine.installing) {
      notifications?.info('The document reader is being set up. You can keep working.');
      return;
    }
    if (engine.state === 'ready' || status.doclingInstalled) {
      await start();
      return;
    }
    if (engine.machine && !engine.machine.ok) {
      notifications?.error(`The document reader cannot be set up on this computer. ${engine.machine.problems.join(' ')}`);
      return;
    }

    const download = (engine.downloadBytes ?? 0) + (engine.packageBytes ?? 0);
    const setUp: NotificationAction = { title: engine.state === 'partial' ? 'Carry On' : 'Set Up' };
    const cancel: NotificationAction = { title: 'Cancel' };
    const proceed = await notifications?.info(
      engine.state === 'partial'
        ? 'Setting up the document reader stopped part of the way. Carry on from where it stopped?'
        : `Set up the document reader? It downloads about ${gb(download)} once and keeps it for every workspace. It reads PDFs, Word files and scans on this computer; nothing leaves it.`,
      setUp,
      cancel,
    );
    if (!proceed || proceed.title !== setUp.title) return;

    notifications?.info('Setting up the document reader. You can keep working; it takes a few minutes.');
    let lastStage = '';
    const stop = electron()?.optionalBridges?.on('runtimes:progress', (p) => {
      if (p.id !== ENGINE_ID || p.kind !== 'install' || !p.step || p.step === lastStage) return;
      lastStage = p.step;
      const note = STAGE_NOTES[p.step];
      if (note) notifications?.info(note);
    });

    try {
      const result = await api.install();
      if (result.ok) await start();
      else if (result.stopped) notifications?.info('Setting up the document reader stopped. Run the command again to carry on from there.');
      else notifications?.error(`The document reader could not be set up: ${result.output}`);
    } catch (err: unknown) {
      notifications?.error(`The document reader could not be set up: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      stop?.();
    }
  },
};
