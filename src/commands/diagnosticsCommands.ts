// diagnosticsCommands.ts — Help › Copy Diagnostics.
//
// Gathers a snapshot for a bug report from what the app already knows
// (versions, the tool registry the Tools page reads, the model in use, index
// counts, the recent-error log) and copies diagnosticsReport.ts's text to the
// clipboard. Nothing is sent anywhere; the user pastes it where they choose.
// Every tool is listed the same way, from the registry: none is named here.

import type { CommandDescriptor, CommandExecutionContext } from './commandTypes.js';
import type { INotificationService, IToolRegistryService, IToolEnablementService, IWorkspaceService, IIndexingPipelineService, IVectorStoreService } from '../services/serviceTypes.js';
import type { ILanguageModelsService } from '../services/chatTypes.js';
import type { IUnifiedAIConfigService } from '../aiSettings/unifiedConfigTypes.js';
import { getRecentErrorLog } from '../platform/recentErrors.js';
import { PARALLX_VERSION } from '../tools/toolValidator.js';
import { DEFAULT_TEXT_SIZE, readAppearance } from '../theme/pxAppearance.js';
import { formatDiagnosticsReport, type DiagnosticsIndexState, type DiagnosticsSnapshot, type DiagnosticsToolInfo } from './diagnosticsReport.js';

/** What the preload exposes for this (electron/appInfo.cjs). */
interface AppInfo {
  version?: string;
  electron?: string;
  chrome?: string;
  node?: string;
  platform?: string;
  arch?: string;
  osRelease?: string;
}

interface DiagnosticsBridge {
  appInfo?: AppInfo;
  appPath?: string;
  dataRoot?: string;
  getZoomFactor?: () => number;
  clipboard?: { writeText(text: string): void };
}

function bridge(): DiagnosticsBridge | undefined {
  return (globalThis as { parallxElectron?: DiagnosticsBridge }).parallxElectron;
}

/** A slow store answers "unknown" rather than holding the copy up. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function collectTools(ctx: CommandExecutionContext): DiagnosticsToolInfo[] {
  const registry = ctx.getService<IToolRegistryService>('IToolRegistryService');
  const enablement = ctx.getService<IToolEnablementService>('IToolEnablementService');
  if (!registry) return [];
  return registry.getAll().map((entry) => {
    const m = entry.description.manifest;
    return {
      name: m.name || m.id,
      version: m.version,
      enabled: safe(() => enablement?.isEnabled(m.id)) ?? true,
      builtin: entry.description.isBuiltin,
    };
  });
}

async function collectIndex(ctx: CommandExecutionContext): Promise<DiagnosticsIndexState> {
  const pipeline = ctx.getService<IIndexingPipelineService>('IIndexingPipelineService');
  if (!pipeline) return { kind: 'none' };
  if (pipeline.isIndexing) {
    const progress = safe(() => pipeline.progress);
    return { kind: 'indexing', processed: progress?.processed ?? 0, total: progress?.total ?? 0 };
  }
  const store = ctx.getService<IVectorStoreService>('IVectorStoreService');
  const stats = store ? await withTimeout(store.getStats(), 2000) : undefined;
  const ready = pipeline.hasSearchableIndex ?? pipeline.isInitialIndexComplete;
  return { kind: ready ? 'ready' : 'not-ready', sources: stats?.totalSources, chunks: stats?.totalChunks };
}

async function collectAI(ctx: CommandExecutionContext): Promise<DiagnosticsSnapshot['ai']> {
  const lms = ctx.getService<ILanguageModelsService>('ILanguageModelsService');
  const model = safe(() => lms?.getActiveModel());
  const engine = model ? safe(() => lms?.getEngineForModel?.(model)) : undefined;
  const provider = engine ? (safe(() => lms?.getProviders().find((p) => p.id === engine)?.displayName) ?? engine) : undefined;
  const contextLength = safe(() => (lms as { getActiveModelContextLength?: () => number } | undefined)?.getActiveModelContextLength?.());
  const config = ctx.getService<IUnifiedAIConfigService>('IUnifiedAIConfigService');
  return {
    provider,
    model,
    contextSetting: safe(() => config?.getEffectiveConfig().model.contextWindow),
    modelContextLength: contextLength && contextLength > 0 ? contextLength : undefined,
    index: await collectIndex(ctx),
  };
}

/** The snapshot, from the live app. Each part degrades to "unknown" on its own. */
export async function collectDiagnostics(ctx: CommandExecutionContext): Promise<{ snapshot: DiagnosticsSnapshot; knownPaths: string[] }> {
  const electron = bridge();
  const info = electron?.appInfo ?? {};
  const workspace = ctx.getService<IWorkspaceService>('IWorkspaceService');
  const folders = safe(() => workspace?.folders) ?? [];
  const snapshot: DiagnosticsSnapshot = {
    app: {
      version: info.version || PARALLX_VERSION,
      electron: info.electron,
      chrome: info.chrome,
      node: info.node,
      platform: info.platform,
      osRelease: info.osRelease,
      arch: info.arch,
      screenScale: typeof devicePixelRatio === 'number' ? devicePixelRatio : undefined,
      textSize: safe(() => readAppearance().textSize ?? DEFAULT_TEXT_SIZE),
    },
    workspaceFolderCount: folders.length,
    tools: collectTools(ctx),
    ai: await collectAI(ctx),
    errors: getRecentErrorLog().entries(),
  };
  const knownPaths = [
    ...folders.map((f) => f.uri.fsPath),
    electron?.appPath ?? '',
    electron?.dataRoot ?? '',
  ].filter(Boolean);
  return { snapshot, knownPaths };
}

async function writeClipboard(text: string): Promise<boolean> {
  const electronClipboard = bridge()?.clipboard;
  if (electronClipboard) {
    try { electronClipboard.writeText(text); return true; } catch { /* fall through to the web clipboard */ }
  }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const copyDiagnostics: CommandDescriptor = {
  id: 'workbench.action.copyDiagnostics',
  title: 'Copy Diagnostics',
  category: 'Help',
  async handler(ctx) {
    const notifications = ctx.getService<INotificationService>('INotificationService');
    const { snapshot, knownPaths } = await collectDiagnostics(ctx);
    const copied = await writeClipboard(formatDiagnosticsReport(snapshot, knownPaths));
    if (copied) void notifications?.info('Diagnostics copied. Paste them into your report.');
    else void notifications?.warn('Could not copy the diagnostics to the clipboard.');
  },
};
