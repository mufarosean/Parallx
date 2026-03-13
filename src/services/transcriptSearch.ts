import { renderTranscriptForDisplay, renderTranscriptForIndexing } from './transcriptFormat.js';

export interface ITranscriptSearchFileSystem {
  readdir(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory'; size: number }[]>;
  readFile(relativePath: string): Promise<string>;
}

export interface ITranscriptSearchResult {
  readonly sourceId: string;
  readonly contextPrefix: string;
  readonly text: string;
  readonly score: number;
  readonly sessionId: string;
}

const TRANSCRIPT_ROOT = '.parallx/sessions';
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'for', 'from', 'only', 'use', 'search', 'session', 'sessions', 'transcript', 'transcripts', 'tell', 'me', 'that', 'there', 'earlier', 'mentioned', 'answer', 'with', 'not', 'memory', 'daily']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export async function searchWorkspaceTranscripts(
  fs: ITranscriptSearchFileSystem,
  query: string,
  options?: { sessionId?: string; topK?: number },
): Promise<ITranscriptSearchResult[]> {
  const entries = await fs.readdir(TRANSCRIPT_ROOT).catch(() => []);
  const sessionFilter = options?.sessionId?.trim();
  const tokens = tokenize(query);
  const results: ITranscriptSearchResult[] = [];

  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.endsWith('.jsonl')) {
      continue;
    }

    const sessionId = entry.name.replace(/\.jsonl$/i, '');
    if (sessionFilter && sessionId !== sessionFilter) {
      continue;
    }

    const sourceId = `${TRANSCRIPT_ROOT}/${entry.name}`;
    const rawContent = await fs.readFile(sourceId).catch(() => '');
    if (!rawContent.trim()) {
      continue;
    }

    const indexedText = renderTranscriptForIndexing(rawContent);
    const lowered = indexedText.toLowerCase();
    const matches = tokens.filter((token) => lowered.includes(token));
    if (tokens.length > 0 && matches.length === 0) {
      continue;
    }

    const score = tokens.length > 0 ? matches.length / tokens.length : 1;
    results.push({
      sourceId,
      contextPrefix: `[Source: "${sourceId}"]`,
      text: renderTranscriptForDisplay(rawContent),
      score,
      sessionId,
    });
  }

  return results
    .sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
    .slice(0, options?.topK ?? 3);
}