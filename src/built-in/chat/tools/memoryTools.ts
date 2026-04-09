import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolFileSystem,
  IBuiltInToolCanonicalMemorySearch,
} from '../chatTypes.js';

const MEMORY_ROOT = '.parallx/memory';
const DURABLE_MEMORY_PATH = `${MEMORY_ROOT}/MEMORY.md`;

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDailyPath(dateInput?: string): { path: string; date: string } | { error: string } {
  const date = (dateInput?.trim() || formatDate(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date must be in YYYY-MM-DD format' };
  }
  return {
    path: `${MEMORY_ROOT}/${date}.md`,
    date,
  };
}

function normalizeLayer(value: unknown): 'durable' | 'daily' | 'all' {
  const layer = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (layer === 'durable' || layer === 'daily') {
    return layer;
  }
  return 'all';
}

function formatSearchResults(results: Array<{ sourceId: string; contextPrefix: string; text: string; score: number }>): string {
  return results.map((result, index) => {
    const layer = result.sourceId === DURABLE_MEMORY_PATH ? 'Durable' : 'Daily';
    const source = result.contextPrefix || result.sourceId;
    return [
      `[${index + 1}] ${layer} Memory`,
      `Path: ${result.sourceId}`,
      `Source: ${source}`,
      `Score: ${result.score.toFixed(3)}`,
      result.text,
    ].join('\n');
  }).join('\n\n---\n\n');
}

export function createMemoryGetTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'memory_get',
    description:
      'Read canonical workspace memory from `.parallx/memory/`. ' +
      'Use `layer="durable"` for long-term memory in `.parallx/memory/MEMORY.md`, ' +
      'or `layer="daily"` with an optional `date` (YYYY-MM-DD) for a daily log. ' +
      'Use this instead of guessing hidden paths.',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['durable', 'daily'], description: 'Which canonical memory layer to read. Defaults to durable.' },
        date: { type: 'string', description: 'For daily memory only: date in YYYY-MM-DD format. Defaults to today.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!fs) {
        return { content: 'Memory files are not available — no workspace folder is open.', isError: true };
      }

      const layer = normalizeLayer(args['layer']) === 'daily' ? 'daily' : 'durable';
      if (layer === 'durable') {
        if (!(await fs.exists(DURABLE_MEMORY_PATH))) {
          return { content: `No durable memory file exists yet at ${DURABLE_MEMORY_PATH}.` };
        }
        const result = await fs.readFileContent(DURABLE_MEMORY_PATH);
        return { content: `Durable memory from ${DURABLE_MEMORY_PATH}:\n\n${result.content}` };
      }

      const resolved = resolveDailyPath(typeof args['date'] === 'string' ? args['date'] : undefined);
      if ('error' in resolved) {
        return { content: resolved.error, isError: true };
      }
      if (!(await fs.exists(resolved.path))) {
        return { content: `No daily memory recorded for ${resolved.date} at ${resolved.path}.` };
      }
      const result = await fs.readFileContent(resolved.path);
      return { content: `Daily memory from ${resolved.path}:\n\n${result.content}` };
    },
  };
}

export function createMemorySearchTool(memorySearch: IBuiltInToolCanonicalMemorySearch | undefined): IChatTool {
  return {
    name: 'memory_search',
    description:
      'Semantic search over canonical workspace memory in `.parallx/memory/`. ' +
      'Use this when answering questions about remembered decisions, preferences, and recent notes. ' +
      'Filter by `layer="durable"` or `layer="daily"` when you already know which memory layer should answer the question.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language query for canonical workspace memory.' },
        layer: { type: 'string', enum: ['all', 'durable', 'daily'], description: 'Optional memory layer filter. Defaults to all.' },
        date: { type: 'string', description: 'Optional YYYY-MM-DD filter for daily memory results.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!memorySearch) {
        return { content: 'Memory search is not available — the retrieval service has not been initialized.', isError: true };
      }
      if (!memorySearch.isReady()) {
        return { content: 'Memory search is not available yet — canonical memory indexing is still in progress. Please try again shortly.' };
      }

      const query = String(args['query'] || '').trim();
      if (!query) {
        return { content: 'Search query is empty.', isError: true };
      }

      const layer = normalizeLayer(args['layer']);
      const dailyFilter = resolveDailyPath(typeof args['date'] === 'string' ? args['date'] : undefined);
      if (typeof args['date'] === 'string' && 'error' in dailyFilter) {
        return { content: dailyFilter.error, isError: true };
      }

      const filtered = await memorySearch.search(query, {
        layer,
        date: 'path' in dailyFilter ? dailyFilter.date : undefined,
      });

      if (filtered.length === 0) {
        return { content: `No canonical memory results found for "${query}".` };
      }

      return {
        content: `Found ${filtered.length} canonical memory result(s):\n\n${formatSearchResults(filtered)}`,
      };
    },
  };
}