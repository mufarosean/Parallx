// diagnosticsReport.ts — the text Help › Copy Diagnostics puts on the clipboard.
//
// Pure: diagnosticsCommands.ts gathers a snapshot, this turns it into
// Markdown that reads as plain text too. What it may carry is decided here
// and nowhere else: versions, the OS family, which tools are on, the model
// in use, counts, and recent error lines scrubbed of paths and keys. Never
// file contents, page or chat text, workspace or folder names, paths or keys.

import { scrubForReport, type RecentErrorEntry } from '../platform/recentErrors.js';

export interface DiagnosticsToolInfo {
  readonly name: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly builtin: boolean;
}

export type DiagnosticsIndexState =
  | { readonly kind: 'none' }
  | { readonly kind: 'indexing'; readonly processed: number; readonly total: number }
  | { readonly kind: 'ready' | 'not-ready'; readonly sources?: number; readonly chunks?: number };

export interface DiagnosticsSnapshot {
  readonly app: {
    readonly version: string;
    readonly electron?: string;
    readonly chrome?: string;
    readonly node?: string;
    readonly platform?: string;
    readonly osRelease?: string;
    readonly arch?: string;
    /** window.devicePixelRatio */
    readonly screenScale?: number;
    /** The app's text size, 1 = 100%. */
    readonly textSize?: number;
  };
  readonly workspaceFolderCount: number;
  readonly tools: readonly DiagnosticsToolInfo[];
  readonly ai: {
    readonly provider?: string;
    readonly model?: string;
    /** The workspace's context size setting; 0 = the model's own. */
    readonly contextSetting?: number;
    /** What the active model reports, when known. */
    readonly modelContextLength?: number;
    readonly index: DiagnosticsIndexState;
  };
  readonly errors: readonly RecentErrorEntry[];
}

const OS_NAMES: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function seconds(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

function appLines(app: DiagnosticsSnapshot['app']): string[] {
  const lines = [`- Parallx ${app.version || 'unknown'}`];
  const runtime = [
    app.electron && `Electron ${app.electron}`,
    app.chrome && `Chromium ${app.chrome}`,
    app.node && `Node ${app.node}`,
  ].filter(Boolean);
  if (runtime.length) lines.push(`- ${runtime.join(', ')}`);
  if (app.platform) {
    const os = OS_NAMES[app.platform] ?? app.platform;
    const release = app.osRelease ? ` ${app.osRelease}` : '';
    lines.push(`- OS: ${os}${release}${app.arch ? `, ${app.arch}` : ''}`);
  }
  const scale = [
    app.screenScale !== undefined && `screen scale ${percent(app.screenScale)}`,
    app.textSize !== undefined && `text size ${percent(app.textSize)}`,
  ].filter(Boolean);
  if (scale.length) lines.push(`- Display: ${scale.join(', ')}`);
  return lines;
}

function toolLines(tools: readonly DiagnosticsToolInfo[]): string[] {
  if (!tools.length) return ['- None registered'];
  return [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `- ${t.name} ${t.version || '?'}: ${t.enabled ? 'on' : 'off'}${t.builtin ? '' : ' (installed)'}`);
}

function indexLine(index: DiagnosticsIndexState): string {
  switch (index.kind) {
    case 'none': return 'not started (no workspace index)';
    case 'indexing': return index.total > 0 ? `indexing, ${index.processed} of ${index.total}` : 'indexing';
    default: {
      const counts = [
        index.sources !== undefined && `${index.sources} sources`,
        index.chunks !== undefined && `${index.chunks} chunks`,
      ].filter(Boolean);
      const state = index.kind === 'ready' ? 'ready' : 'not ready';
      return counts.length ? `${state}, ${counts.join(', ')}` : state;
    }
  }
}

function aiLines(ai: DiagnosticsSnapshot['ai']): string[] {
  const context = ai.contextSetting === undefined
    ? 'unknown'
    : ai.contextSetting > 0 ? String(ai.contextSetting) : "the model's own";
  const reported = ai.modelContextLength ? ` (model reports ${ai.modelContextLength})` : '';
  return [
    `- Provider: ${ai.provider || 'none'}`,
    `- Model: ${ai.model || 'none selected'}`,
    `- Context size setting: ${context}${reported}`,
    `- Retrieval index: ${indexLine(ai.index)}`,
  ];
}

function errorLines(errors: readonly RecentErrorEntry[], knownPaths: readonly string[]): string[] {
  if (!errors.length) return ['- None since start'];
  return errors.map((e) => {
    const repeat = e.count > 1 ? ` (×${e.count})` : '';
    const message = scrubForReport(e.message, knownPaths).replace(/`/g, "'");
    return `- ${seconds(e.atMs)} ${e.level}${repeat}: ${message}`;
  });
}

/**
 * The report. `knownPaths` are folders to hide wherever they appear in an
 * error line (the workspace folders, the app's own folders).
 */
export function formatDiagnosticsReport(snapshot: DiagnosticsSnapshot, knownPaths: readonly string[] = []): string {
  const on = snapshot.tools.filter((t) => t.enabled).length;
  const folders = snapshot.workspaceFolderCount;
  const sections: [string, string[]][] = [
    ['App', appLines(snapshot.app)],
    ['Workspace', [`- Folders: ${folders}${folders ? ' (names hidden)' : ''}`]],
    [`Tools (${snapshot.tools.length} installed, ${on} on)`, toolLines(snapshot.tools)],
    ['AI', aiLines(snapshot.ai)],
    [`Recent errors and warnings (${snapshot.errors.length})`, errorLines(snapshot.errors, knownPaths)],
  ];
  const body = sections.map(([title, lines]) => `### ${title}\n${lines.join('\n')}`).join('\n\n');
  return `## Parallx diagnostics\n\n${body}\n`;
}
