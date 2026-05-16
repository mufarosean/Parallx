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
    displaySummary: 'Read canonical workspace memory.',
    description: 'Read workspace memory. layer=durable for MEMORY.md; layer=daily for a date-stamped log.',
    parameters: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: ['durable', 'daily'], description: 'durable (default) or daily.' },
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today. Only for daily layer.' },
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
    displaySummary: 'Semantic search over workspace memory.',
    description: 'Semantic search over workspace memory in `.parallx/memory/`.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query.' },
        layer: { type: 'string', enum: ['all', 'durable', 'daily'], description: 'Filter: all (default), durable, or daily.' },
        date: { type: 'string', description: 'YYYY-MM-DD filter for daily layer.' },
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