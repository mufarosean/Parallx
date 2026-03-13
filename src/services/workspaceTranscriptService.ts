import { Disposable } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import { ChatContentPartKind, type IChatContentPart, type IChatSession } from './chatTypes.js';
import type { IFileService, IWorkspaceService, IWorkspaceTranscriptService } from './serviceTypes.js';

const TRANSCRIPT_ROOT_SEGMENTS = ['.parallx', 'sessions'] as const;

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function extractPartText(part: IChatContentPart): string {
  if ('content' in part && typeof part.content === 'string') {
    return part.content;
  }
  if ('code' in part && typeof part.code === 'string') {
    return part.code;
  }
  if ('message' in part && typeof part.message === 'string') {
    return part.message;
  }
  return '';
}

function serializeSession(session: IChatSession): string {
  const lines: string[] = [];
  lines.push(JSON.stringify({
    type: 'session',
    sessionId: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
    title: session.title,
    mode: session.mode,
    modelId: session.modelId,
  }));

  for (const pair of session.messages) {
    lines.push(JSON.stringify({
      type: 'message',
      timestamp: new Date(pair.request.timestamp).toISOString(),
      message: {
        role: 'user',
        content: [{ type: 'text', text: pair.request.text }],
      },
    }));

    const assistantText = pair.response.parts
      .filter((part) => part.kind !== ChatContentPartKind.Thinking)
      .map(extractPartText)
      .filter(Boolean)
      .join('\n');

    lines.push(JSON.stringify({
      type: 'message',
      timestamp: new Date(pair.response.timestamp).toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
        modelId: pair.response.modelId,
        isComplete: pair.response.isComplete,
      },
    }));
  }

  return ensureTrailingNewline(lines.join('\n'));
}

export class WorkspaceTranscriptService extends Disposable implements IWorkspaceTranscriptService {
  constructor(
    private readonly _fileService: IFileService,
    private readonly _workspaceService: IWorkspaceService,
  ) {
    super();
  }

  get transcriptRoot(): URI | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root?.joinPath(...TRANSCRIPT_ROOT_SEGMENTS);
  }

  getTranscriptUri(sessionId: string): URI | undefined {
    const cleanSessionId = sessionId.trim();
    if (!cleanSessionId) {
      return undefined;
    }
    return this.transcriptRoot?.joinPath(`${cleanSessionId}.jsonl`);
  }

  getTranscriptRelativePath(sessionId: string): string {
    return `${TRANSCRIPT_ROOT_SEGMENTS.join('/')}/${sessionId.trim()}.jsonl`;
  }

  async ensureScaffold(): Promise<void> {
    const workspaceRoot = this._workspaceService.folders[0]?.uri;
    if (!workspaceRoot) {
      return;
    }

    const parallxDir = workspaceRoot.joinPath('.parallx');
    if (!(await this._fileService.exists(parallxDir))) {
      await this._fileService.mkdir(parallxDir);
    }

    const transcriptDir = workspaceRoot.joinPath(...TRANSCRIPT_ROOT_SEGMENTS);
    if (!(await this._fileService.exists(transcriptDir))) {
      await this._fileService.mkdir(transcriptDir);
    }
  }

  async writeSessionTranscript(session: IChatSession): Promise<void> {
    const uri = this.getTranscriptUri(session.id);
    if (!uri) {
      return;
    }
    await this.ensureScaffold();
    await this._fileService.writeFile(uri, serializeSession(session));
  }

  async readSessionTranscript(sessionId: string): Promise<string> {
    const uri = this.getTranscriptUri(sessionId);
    if (!uri || !(await this._fileService.exists(uri))) {
      return '';
    }
    const result = await this._fileService.readFile(uri);
    return result.content.replace(/\r\n/g, '\n');
  }

  async deleteSessionTranscript(sessionId: string): Promise<void> {
    const uri = this.getTranscriptUri(sessionId);
    if (!uri || !(await this._fileService.exists(uri))) {
      return;
    }
    await this._fileService.delete(uri, { recursive: false, useTrash: false });
  }
}