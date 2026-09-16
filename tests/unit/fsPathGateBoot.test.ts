// fsPathGateBoot.test.ts — the main-process file-path gate must be pointed at
// the new workspace BEFORE any tool reads a file.
//
// A workspace switch reloads the renderer but not the main process, so the
// gate (electron/main.cjs `_isAllowedReadPath`) keeps enforcing the workspace
// the user just left. Registration used to live in the chat tool's activate();
// chat is twelfth in the built-in boot list and the explorer is first, so the
// explorer's first readdir came back EACCES, was swallowed, and the sidebar
// rendered as an empty tree until a manual refresh. A cold start hid it — no
// root is registered yet, and the gate is open until one is.
//
// These are structural assertions, the same canary pattern as the other
// *Compliance tests: they fail when the ownership or ordering drifts back.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Body of a class method, from its signature to the next method at the same indent. */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `method not found: ${signature}`).toBeGreaterThan(-1);
  const rest = source.slice(start + signature.length);
  const end = rest.search(/\n {2}(?:private|public|protected|async|\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('file-path gate — boot ordering', () => {
  const workbench = read('src/workbench/workbench.ts');

  it('registers the workspace root from Phase 4, before tools activate', () => {
    const phase4 = methodBody(workbench, 'private async _restoreWorkspace(): Promise<void> {');
    expect(phase4).toContain('await this._registerFsPathGateRoot();');
  });

  it('keeps the registration awaited, so the IPC lands before Phase 5', () => {
    // Fire-and-forget would leave the send order to chance on a slow main
    // process; Phase 5 activates the explorer immediately afterwards.
    expect(workbench).toContain('await this._registerFsPathGateRoot();');
    expect(workbench).toContain('private async _registerFsPathGateRoot(): Promise<void> {');
  });

  it('re-registers when the workspace folders change', () => {
    const phase4 = methodBody(workbench, 'private async _restoreWorkspace(): Promise<void> {');
    expect(phase4).toMatch(/onDidChangeFolders\(\(\) => \{\s*void this\._registerFsPathGateRoot\(\);/);
  });

  it('is owned by the workbench, never by a tool', () => {
    // A tool activates too late and in an order nothing guarantees. The gate
    // is a workbench boundary; no built-in may set it.
    const offenders = globSync('src/built-in/**/*.ts', { cwd: ROOT, ignore: ['**/*.test.ts'] })
      .filter((f) => read(f).includes('setWorkspaceRoot'));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('is torn down with the rest of the workspace-scoped main state', () => {
    // Otherwise the next workspace is measured against the previous root:
    // its own files answer EACCES while the old workspace stays readable.
    const main = read('electron/main.cjs');
    expect(main).toMatch(/registerTeardown\('fs-path-gate', 'workspace', \(\) => \{\s*_fsWorkspaceRoot = null;\s*_fsExtraRoots\.clear\(\);/);
  });
});

describe('explorer — a denied read is not an empty folder', () => {
  const explorer = read('src/built-in/explorer/main.ts');

  it('throws out of readDirectory instead of returning no entries', () => {
    const body = explorer.slice(
      explorer.indexOf('async function readDirectory('),
      explorer.indexOf('async function readDirectory(') + 900,
    );
    expect(body).toContain('throw new Error');
    expect(body).not.toContain('return [];');
  });

  it('keeps a failed directory retryable rather than caching it as loaded', () => {
    expect(explorer).toContain('node.loaded = false;');
    expect(explorer).toContain('node.error = err instanceof Error ? err.message : String(err);');
  });

  it('renders the failure with its own row and a retry', () => {
    expect(explorer).toContain('} else if (node.error) {');
    expect(explorer).toContain("text.textContent = 'Could not read this folder.';");
    expect(explorer).toContain("retry.textContent = 'Retry';");
  });
});
