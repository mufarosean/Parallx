export interface ParsedTranscriptLine {
  readonly role: 'user' | 'assistant';
  readonly timestamp?: string;
  readonly text: string;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseTranscriptJsonl(rawContent: string): ParsedTranscriptLine[] {
  const lines: ParsedTranscriptLine[] = [];

  for (const rawLine of rawContent.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        message?: {
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
      };

      if (parsed.type !== 'message') {
        continue;
      }

      const role = parsed.message?.role;
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const text = collapseWhitespace(
        (parsed.message?.content ?? [])
          .map((part) => (part?.type === 'text' ? part.text ?? '' : ''))
          .join(' '),
      );
      if (!text) {
        continue;
      }

      lines.push({
        role,
        timestamp: parsed.timestamp,
        text,
      });
    } catch {
      continue;
    }
  }

  return lines;
}

export function renderTranscriptForIndexing(rawContent: string): string {
  return parseTranscriptJsonl(rawContent)
    .map((line) => `${line.role === 'user' ? 'User' : 'Assistant'}: ${line.text}`)
    .join('\n');
}

export function renderTranscriptForDisplay(rawContent: string): string {
  return parseTranscriptJsonl(rawContent)
    .map((line) => {
      const header = line.timestamp
        ? `[${line.timestamp}] ${line.role === 'user' ? 'User' : 'Assistant'}`
        : (line.role === 'user' ? 'User' : 'Assistant');
      return `${header}\n${line.text}`;
    })
    .join('\n\n');
}