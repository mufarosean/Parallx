import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { URI } from '../../src/platform/uri';
import { ChatMode, ChatContentPartKind, type IChatSession } from '../../src/services/chatTypes';
import { WorkspaceService } from '../../src/services/workspaceService';
import { WorkspaceTranscriptService } from '../../src/services/workspaceTranscriptService';
import { Workspace } from '../../src/workspace/workspace';

function createWorkspaceService(rootPath: string): WorkspaceService {
  const workspace = Workspace.create('Test Workspace');
  workspace.addFolder(URI.file(rootPath), 'workspace');
  const onDidSwitchWorkspace = new Emitter<Workspace>();
  const service = new WorkspaceService();
  service.setHost({
    workspace,
    _workspaceSaver: {
      save: async () => {},
      requestSave: () => {},
    },
    createWorkspace: async () => workspace,
    switchWorkspace: async () => {},
    getRecentWorkspaces: async () => [],
    removeRecentWorkspace: async () => {},
    onDidSwitchWorkspace: onDidSwitchWorkspace.event,
  });
  return service;
}

function createFileServiceMock() {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    files,
    directories,
    service: {
      async exists(uri: URI): Promise<boolean> {
        return directories.has(uri.fsPath) || files.has(uri.fsPath);
      },
      async mkdir(uri: URI): Promise<void> {
        directories.add(uri.fsPath);
      },
      async writeFile(uri: URI, content: string): Promise<void> {
        files.set(uri.fsPath, content);
      },
      async readFile(uri: URI): Promise<{ content: string; encoding: string; size: number; mtime: number }> {
        const content = files.get(uri.fsPath);
        if (content === undefined) {
          throw new Error(`Missing file: ${uri.fsPath}`);
        }
        return { content, encoding: 'utf8', size: content.length, mtime: 0 };
      },
      async delete(uri: URI): Promise<void> {
        files.delete(uri.fsPath);
      },
    } as any,
  };
}

function createSession(): IChatSession {
  return {
    id: 'session-123',
    sessionResource: URI.from({ scheme: 'parallx-chat-session', path: '/session-123' }),
    createdAt: Date.parse('2026-03-13T12:00:00.000Z'),
    title: 'Test Session',
    mode: ChatMode.Agent,
    modelId: 'gpt-oss:20b',
    messages: [
      {
        request: {
          text: 'Hello',
          requestId: 'req-1',
          attempt: 0,
          timestamp: Date.parse('2026-03-13T12:00:01.000Z'),
        },
        response: {
          parts: [{ kind: ChatContentPartKind.Markdown, content: 'Hi there' }],
          isComplete: true,
          modelId: 'gpt-oss:20b',
          timestamp: Date.parse('2026-03-13T12:00:02.000Z'),
        },
      },
    ],
    requestInProgress: false,
    pendingRequests: [],
  };
}

describe('WorkspaceTranscriptService', () => {
  it('writes session transcripts under .parallx/sessions as jsonl', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceTranscriptService(fileService.service, workspaceService);

    await service.writeSessionTranscript(createSession());

    const transcriptPath = 'D:/AI/Parallx/demo-workspace/.parallx/sessions/session-123.jsonl';
    const transcript = fileService.files.get(transcriptPath) || '';
    expect(transcript).toContain('"type":"session"');
    expect(transcript).toContain('"role":"user"');
    expect(transcript).toContain('"Hello"');
    expect(transcript).toContain('"role":"assistant"');
    expect(transcript).toContain('"Hi there"');
  });

  it('reads and deletes transcript snapshots independently from memory files', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceTranscriptService(fileService.service, workspaceService);

    await service.writeSessionTranscript(createSession());
    await expect(service.readSessionTranscript('session-123')).resolves.toContain('"sessionId":"session-123"');

    await service.deleteSessionTranscript('session-123');
    await expect(service.readSessionTranscript('session-123')).resolves.toBe('');
  });
});