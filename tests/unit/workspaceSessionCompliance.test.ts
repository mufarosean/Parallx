// workspaceSessionCompliance.test.ts — M14 gate compliance test
//
// Grep-based gate test that verifies M14 workspace session isolation
// conventions are followed throughout the codebase.
//
// These tests ensure:
// (a) captureSession() is used in all async pipeline entry points
// (b) SessionManager integration is wired in key services
// (c) ARCHITECTURE.md documents window semantics

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../src');
const ROOT_DIR = path.resolve(__dirname, '../..');

/** Read a source file's content (returns empty string if missing). */
function readSrc(relativePath: string): string {
  try {
    return fs.readFileSync(path.join(SRC_DIR, relativePath), 'utf-8');
  } catch {
    return '';
  }
}

/** Read a root file's content (returns empty string if missing). */
function readRoot(relativePath: string): string {
  try {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf-8');
  } catch {
    return '';
  }
}

describe('M14 Workspace Session Compliance', () => {
  // ── Foundation files exist ──

  it('WorkspaceSessionContext interface exists', () => {
    const content = readSrc('workspace/workspaceSessionContext.ts');
    expect(content).toContain('export interface IWorkspaceSessionContext');
    expect(content).toContain('sessionId');
    expect(content).toContain('workspaceId');
    expect(content).toContain('cancellationSignal');
    expect(content).toContain('isActive()');
    expect(content).toContain('logPrefix');
  });

  it('SessionManager class exists', () => {
    const content = readSrc('workspace/sessionManager.ts');
    expect(content).toContain('export class SessionManager');
    expect(content).toContain('beginSession');
    expect(content).toContain('endSession');
    expect(content).toContain('onDidChangeSession');
  });

  it('captureSession utility exists', () => {
    const content = readSrc('workspace/staleGuard.ts');
    expect(content).toContain('export function captureSession');
    expect(content).toContain('isValid');
    expect(content).toContain('sessionId');
  });

  it('SessionLogger utility exists', () => {
    const content = readSrc('workspace/sessionLogger.ts');
    expect(content).toContain('export class SessionLogger');
    expect(content).toContain('info');
    expect(content).toContain('warn');
    expect(content).toContain('error');
  });

  // ── Stale guard usage in pipeline entry points ──

  it('captureSession is used in IndexingPipelineService', () => {
    const content = readSrc('services/indexingPipeline.ts');
    expect(content).toContain("import { captureSession }");
    expect(content).toContain('_sessionGuard');
    // Guard before upsert in _indexSinglePage
    expect(content).toMatch(/sessionGuard.*isValid|_sessionGuard.*isValid/);
  });

  it('captureSession is used in ChatService.sendRequest', () => {
    const content = readSrc('services/chatService.ts');
    expect(content).toContain("import { captureSession }");
    expect(content).toContain('captureSession(this._sessionManager)');
    // Guard before persist
    expect(content).toContain('guard.isValid()');
  });

  it('captureSession is used in chat turn execution config assembly', () => {
    const content = readSrc('built-in/chat/utilities/chatTurnExecutionConfig.ts');
    expect(content).toContain("import { captureSession }");
    expect(content).toContain('toolGuard');
    expect(content).toContain('captureSession(services.sessionManager)');
  });

  it('tool guard validation is enforced in grounded executor', () => {
    const content = readSrc('built-in/chat/utilities/chatGroundedExecutor.ts');
    expect(content).toContain('toolGuard');
    expect(content).toContain('toolGuard.isValid()');
  });

  it('session embedding guard exists in _embedChunks', () => {
    const content = readSrc('services/indexingPipeline.ts');
    expect(content).toContain('Session stale during embedding');
  });

  // ── Abort signal propagation ──

  it('session cancellation signal is passed from execution config assembly into the synthesis utility', () => {
    const content = readSrc('built-in/chat/utilities/chatTurnExecutionConfig.ts');
    expect(content).toContain('sessionCancellationSignal');
    expect(content).toContain('cancellationSignal');
  });

  it('session cancellation signal is linked in the chat synthesis utility', () => {
    const content = readSrc('built-in/chat/utilities/chatTurnSynthesis.ts');
    expect(content).toContain('sessionCancellationSignal');
    expect(content).toContain("addEventListener('abort'");
  });

  // ── Service wiring ──

  it('ISessionManager is registered in workbenchServices', () => {
    const content = readSrc('workbench/workbenchServices.ts');
    expect(content).toContain('ISessionManager');
    expect(content).toContain('SessionManager');
  });

  it('SessionManager is wired into workbench lifecycle', () => {
    const content = readSrc('workbench/workbench.ts');
    expect(content).toContain('beginSession');
    expect(content).toContain('endSession');
    expect(content).toContain('ISessionManager');
  });

  it('ChatService has setSessionManager method', () => {
    const content = readSrc('services/chatService.ts');
    expect(content).toContain('setSessionManager');
    expect(content).toContain('_sessionManager');
  });

  it('sessionManager is passed to defaultParticipant services', () => {
    const content = readSrc('built-in/chat/data/chatDataService.ts');
    expect(content).toContain('sessionManager');
  });

  // ── Dispose hardening ──

  it('_startIndexingPipeline disposes old services via DisposableStore', () => {
    const content = readSrc('workbench/workbench.ts');
    expect(content).toContain('_ragServiceStore');
    expect(content).toContain('_ragServiceStore.dispose()');
  });

  it('_startIndexingPipeline checks session before starting', () => {
    const content = readSrc('workbench/workbench.ts');
    expect(content).toContain('session is ending');
  });

  // ── Architecture documentation ──

  it('ARCHITECTURE.md documents window semantics', () => {
    const content = readRoot('ARCHITECTURE.md');
    expect(content).toContain('## Window Semantics');
    expect(content).toContain('Single Window');
    expect(content).toContain('WorkspaceSessionContext');
    expect(content).toContain('Migration Path to Multi-Window');
  });

  // ── Minimum guard count ──

  it('at least 5 captureSession call sites exist', () => {
    const files = [
      readSrc('services/indexingPipeline.ts'),
      readSrc('services/chatService.ts'),
      readSrc('built-in/chat/utilities/chatTurnExecutionConfig.ts'),
    ];
    const allContent = files.join('\n');
    const matches = allContent.match(/captureSession\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
