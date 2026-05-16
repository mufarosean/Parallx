import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolTranscriptSearch,
} from '../chatTypes.js';
import { renderTranscriptForDisplay } from '../../../services/transcriptFormat.js';

const TRANSCRIPT_ROOT = '.parallx/sessions';

function buildTranscriptPath(sessionId: string): string {
  return `${TRANSCRIPT_ROOT}/${sessionId.trim()}.jsonl`;
}

function formatSearchResults(results: Array<{ sourceId: string; contextPrefix: string; text: string; score: number; sessionId: string }>): string {
  return results.map((result, index) => [
    `[${index + 1}] Session ${result.sessionId}`,
    `Path: ${result.sourceId}`,
    `Source: ${result.contextPrefix || result.sourceId}`,
    `Score: ${result.score.toFixed(3)}`,
    result.text,
  ].join('\n')).join('\n\n---\n\n');
}

export function createTranscriptGetTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'transcript_get',
    displaySummary: 'Read a session transcript.',
    description: 'Read a session transcript from `.parallx/sessions/`.',
    parameters: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', description: 'Session ID.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!fs) {
        return { content: 'Transcript files are not available — no workspace folder is open.', isError: true };
      }

      const sessionId = String(args['sessionId'] || '').trim();
      if (!sessionId) {
        return { content: 'sessionId is required.', isError: true };
      }

      const transcriptPath = buildTranscriptPath(sessionId);
      if (!(await fs.exists(transcriptPath))) {
        return { content: `No transcript exists for session ${sessionId} at ${transcriptPath}.` };
      }

      const result = await fs.readFileContent(transcriptPath);
      const transcriptText = renderTranscriptForDisplay(result.content);
      return {
        content: transcriptText
          ? `Transcript from ${transcriptPath}:\n\n${transcriptText}`
          : `Transcript file ${transcriptPath} exists but has no readable user/assistant turns yet.`,
      };
    },
  };
}

export function createTranscriptSearchTool(transcriptSearch: IBuiltInToolTranscriptSearch | undefined): IChatTool {
  return {
    name: 'transcript_search',
    displaySummary: 'Semantic search over prior transcripts.',
    description: 'Semantic search over session transcripts. Disabled unless transcript indexing is on.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query.' },
        sessionId: { type: 'string', description: 'Filter to one session.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!transcriptSearch || !transcriptSearch.isEnabled()) {
        return { content: 'Transcript search is disabled. Enable memory.transcriptIndexingEnabled to index `.parallx/sessions/*.jsonl` for explicit transcript recall.' };
      }
      if (!transcriptSearch.isReady()) {
        return { content: 'Transcript search is not available yet — indexing is still in progress. Please try again shortly.' };
      }

      const query = String(args['query'] || '').trim();
      if (!query) {
        return { content: 'Search query is empty.', isError: true };
      }

      const sessionId = String(args['sessionId'] || '').trim() || undefined;
      const results = await transcriptSearch.search(query, { sessionId });
      if (results.length === 0) {
        return { content: `No transcript results found for "${query}".` };
      }

      return {
        content: `Found ${results.length} transcript result(s):\n\n${formatSearchResults(results)}`,
      };
    },
  };
}