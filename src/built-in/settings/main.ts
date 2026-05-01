// main.ts — M60 Phase ε §7 T4.D2 settings extension activation
//
// Registers the `settings.open` command. Opens a modal/overlay editor
// rendered by SettingsEditor over document.body. No new workbench panel
// slot — this keeps us within the §3.4 boundary.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { ISettingsRegistryService } from '../../services/serviceTypes.js';
import { SettingsEditor } from './settingsEditor.js';
// ─── Local API type ──────────────────────────────────────────────────────────

interface ParallxApi {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

// ─── Module state ────────────────────────────────────────────────────────────

let _editor: SettingsEditor | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(
    api.commands.registerCommand('settings.open', () => {
      if (!api.services.has(ISettingsRegistryService)) {
        console.warn('[settings] ISettingsRegistryService not available');
        return;
      }
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(
        ISettingsRegistryService,
      );

      // §3.8 rollback flag — bail out cleanly if the editor is disabled.
      try {
        const enabled = registry.getValue<boolean>('settings.editor.enabled');
        if (enabled === false) {
          console.info('[settings] editor disabled by settings.editor.enabled flag');
          return;
        }
      } catch {
        /* schema not registered — proceed (registry must have at least defaults) */
      }

      // Lazy single-instance — re-open shows the same editor again.
      if (_editor) {
        _editor.dispose();
        _editor = null;
      }
      _editor = new SettingsEditor(document.body, registry, {
        executeCommand: <T>(id: string, ...args: unknown[]) =>
          api.commands.executeCommand<T>(id, ...args),
      });
      _editor.show();
    }),
  );

  // ── M61 Phase 6 — workspace settings export / import / reset ──────────
  // These commands operate on the live registry. Export gathers every
  // workspace-scoped key + current value into a single JSON document.
  // Import accepts the same shape and writes back via setValue (which
  // routes through the registered binding for each key). Reset wipes
  // every workspace-scoped key to its default.
  context.subscriptions.push(
    api.commands.registerCommand('workspace.exportConfig', async () => {
      if (!api.services.has(ISettingsRegistryService)) return;
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(
        ISettingsRegistryService,
      );
      const schemas = registry.getAllSchemas().filter((s) => s.scope === 'workspace');
      const payload = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        settings: schemas
          // Skip action rows — they have no value.
          .filter((s) => s.type !== 'action')
          // Skip secrets so exports never leak credentials.
          .filter((s) => !s.secret)
          .map((s) => ({ key: s.key, value: registry.getValue(s.key) })),
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `parallx-workspace-config-${new Date().toISOString().slice(0, 10)}.json`;
      // Use the browser File System Access API when available; fall back to
      // an anchor-download for older Electron builds.
      const fsApi = (window as unknown as { showSaveFilePicker?: (opts: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
      if (fsApi) {
        try {
          const handle = await fsApi({
            suggestedName: filename,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
          return;
        } catch (err: unknown) {
          if ((err as { name?: string }).name === 'AbortError') return;
          // Fall through to anchor-download.
        }
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }),
    api.commands.registerCommand('workspace.importConfig', async () => {
      if (!api.services.has(ISettingsRegistryService)) return;
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(
        ISettingsRegistryService,
      );
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      const file = await new Promise<File | null>((resolve) => {
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
      if (!file) return;
      const text = await file.text();
      let parsed: { version?: number; settings?: { key: string; value: unknown }[] };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        console.warn('[workspace.importConfig] invalid JSON');
        return;
      }
      if (parsed.version !== 1 || !Array.isArray(parsed.settings)) {
        console.warn('[workspace.importConfig] unsupported file format');
        return;
      }
      let applied = 0;
      let skipped = 0;
      for (const entry of parsed.settings) {
        if (!entry || typeof entry.key !== 'string') continue;
        const schema = registry.getSchema(entry.key);
        if (!schema || schema.scope !== 'workspace' || schema.type === 'action') {
          skipped++;
          continue;
        }
        try {
          await registry.setValue(entry.key, entry.value);
          applied++;
        } catch (err) {
          console.warn(`[workspace.importConfig] could not apply ${entry.key}:`, err);
          skipped++;
        }
      }
      console.info(`[workspace.importConfig] applied=${applied} skipped=${skipped}`);
    }),
    api.commands.registerCommand('workspace.resetConfig', async () => {
      if (!api.services.has(ISettingsRegistryService)) return;
      const registry = api.services.get<import('../../services/settingsRegistryService.js').ISettingsRegistryService>(
        ISettingsRegistryService,
      );
      const ok = window.confirm(
        'Reset every workspace setting to its default?\n\nThis cannot be undone.',
      );
      if (!ok) return;
      const workspaceSchemas = registry
        .getAllSchemas()
        .filter((s) => s.scope === 'workspace' && s.type !== 'action');
      let resetCount = 0;
      for (const schema of workspaceSchemas) {
        try {
          await registry.reset(schema.key);
          resetCount++;
        } catch (err) {
          console.warn(`[workspace.resetConfig] could not reset ${schema.key}:`, err);
        }
      }
      console.info(`[workspace.resetConfig] reset ${resetCount} keys`);
    }),
  );
}

export function deactivate(): void {
  if (_editor) {
    _editor.dispose();
    _editor = null;
  }
}
