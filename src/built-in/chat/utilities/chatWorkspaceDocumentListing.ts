import type { ICancellationToken, IChatResponseStream } from '../../../services/chatTypes.js';

const MAX_DOCUMENT_RESULTS = 200;
const MAX_SCAN_DEPTH = 4;

function isWorkspaceDocumentListingQuery(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return /\bwhat\s+documents?\s+do\s+i\s+have\s+in\s+my\s+workspace\b/.test(normalized)
    || (/\b(list|show)\b/.test(normalized) && /\bdocuments?\b/.test(normalized) && /\bworkspace\b/.test(normalized));
}

function isInternalEntry(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  return normalized.startsWith('.parallx/')
    || normalized === '.parallx'
    || normalized.endsWith('.jsonl')
    || normalized.endsWith('.db-shm')
    || normalized.endsWith('.db-wal')
    || normalized.endsWith('workspace-identity.json')
    || normalized.endsWith('ai-config.json');
}

function isDocumentPath(relativePath: string): boolean {
  return /\.(md|txt|pdf|docx|xlsx|xls|epub)$/i.test(relativePath);
}

async function collectWorkspaceDocuments(
  listFiles: (relativePath: string) => Promise<readonly { name: string; type: 'file' | 'directory'; size?: number }[]>,
  relativePath: string = '',
  depth: number = 0,
  results: string[] = [],
): Promise<string[]> {
  if (results.length >= MAX_DOCUMENT_RESULTS || depth > MAX_SCAN_DEPTH) {
    return results;
  }

  const entries = await listFiles(relativePath).catch(() => []);
  for (const entry of entries) {
    if (results.length >= MAX_DOCUMENT_RESULTS) {
      break;
    }

    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (isInternalEntry(childPath)) {
      continue;
    }

    if (entry.type === 'file') {
      if (isDocumentPath(childPath)) {
        results.push(childPath);
      }
      continue;
    }

    await collectWorkspaceDocuments(listFiles, childPath, depth + 1, results);
  }

  return results;
}

export async function tryHandleWorkspaceDocumentListing(options: {
  readonly text: string;
  readonly listFiles?: (relativePath: string) => Promise<readonly { name: string; type: 'file' | 'directory'; size?: number }[]>;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly workspaceName: string;
}): Promise<boolean> {
  if (!isWorkspaceDocumentListingQuery(options.text) || !options.listFiles) {
    return false;
  }

  if (options.token.isCancellationRequested) {
    return true;
  }

  const documents = await collectWorkspaceDocuments(options.listFiles);
  if (documents.length === 0) {
    options.response.markdown(`I couldn't find any user-facing documents in "${options.workspaceName}".`);
    return true;
  }

  const lines = [
    `Your workspace contains ${documents.length} document${documents.length === 1 ? '' : 's'}:`,
    '',
    ...documents.map((documentPath) => `- ${documentPath}`),
  ];

  options.response.markdown(lines.join('\n'));
  return true;
}