interface IChatDigestDatabaseService {
  readonly isOpen?: boolean;
  all<T>(sql: string): Promise<T[]>;
}

interface IChatDigestFsAccessor {
  readdir(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory' }[]>;
  exists(relativePath: string): Promise<boolean>;
  readFileContent(relativePath: string): Promise<{ content: string }>;
}

export interface IChatWorkspaceDigestDeps {
  readonly databaseService?: IChatDigestDatabaseService;
  readonly fsAccessor?: IChatDigestFsAccessor;
  readonly getContextLength: () => Promise<number>;
}

export async function computeChatWorkspaceDigest(
  deps: IChatWorkspaceDigestDeps,
): Promise<string | undefined> {
  const sections: string[] = [];

  const contextLength = await deps.getContextLength();
  const effectiveContext = contextLength > 0 ? contextLength : 8192;
  const systemBudgetTokens = Math.floor(effectiveContext * 0.10);
  const digestBudgetTokens = Math.floor(systemBudgetTokens * 0.60);
  const maxDigestChars = Math.min(digestBudgetTokens * 4, 12000);
  let totalChars = 0;

  const summaries = new Map<string, string>();
  if (deps.databaseService?.isOpen) {
    try {
      const rows = await deps.databaseService.all<{ source_id: string; summary: string }>(
        `SELECT source_id, summary FROM indexing_metadata WHERE summary IS NOT NULL AND summary != ''`,
      );
      for (const row of rows) {
        summaries.set(row.source_id, row.summary);
      }
    } catch {
      // best effort
    }
  }

  if (deps.databaseService?.isOpen) {
    try {
      const pages = await deps.databaseService.all<{ title: string; id: string }>(
        'SELECT title, id FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT 30',
      );
      if (pages.length > 0) {
        const pageLines = pages.map((page) => {
          const pageSummary = summaries.get(page.id);
          return pageSummary
            ? `  - ${page.title} — ${pageSummary}`
            : `  - ${page.title}`;
        });
        const block = `CANVAS PAGES (${pages.length}):\n${pageLines.join('\n')}`;
        sections.push(block);
        totalChars += block.length;
      }
    } catch {
      // best effort
    }
  }

  if (deps.fsAccessor) {
    try {
      const treeLines: string[] = [];
      let treeChars = 0;
      type QueueItem = { dir: string; prefix: string };
      const queue: QueueItem[] = [{ dir: '.', prefix: '  ' }];

      while (queue.length > 0) {
        const { dir, prefix } = queue.shift()!;
        let entries;
        try {
          entries = await deps.fsAccessor.readdir(dir);
        } catch {
          continue;
        }

        const sorted = [...entries].sort((left, right) => {
          if (left.type === 'directory' && right.type !== 'directory') return -1;
          if (left.type !== 'directory' && right.type === 'directory') return 1;
          return left.name.localeCompare(right.name);
        });

        for (const entry of sorted) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') {
            continue;
          }
          const icon = entry.type === 'directory' ? '[dir]' : '[file]';
          const relPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
          const fileSummary = entry.type !== 'directory' ? summaries.get(relPath) : undefined;
          const line = fileSummary
            ? `${prefix}${icon} ${entry.name} — ${fileSummary}`
            : `${prefix}${icon} ${entry.name}`;
          treeLines.push(line);
          treeChars += line.length + 1;
          if (entry.type === 'directory') {
            queue.push({ dir: relPath, prefix: prefix + '  ' });
          }
        }

        if (totalChars + treeChars + 20 >= maxDigestChars) {
          break;
        }
      }

      if (treeLines.length > 0) {
        const block = `WORKSPACE FILES:\n${treeLines.join('\n')}`;
        if (totalChars + block.length < maxDigestChars) {
          sections.push(block);
          totalChars += block.length;
        }
      }
    } catch {
      // best effort
    }
  }

  if (deps.fsAccessor) {
    // SOUL.md and AGENTS.md are excluded — they are already injected in
    // full via OpenClaw bootstrap files in the Workspace Context section.
    const keyFiles = ['README.md', 'README.txt', 'README'];
    for (const fileName of keyFiles) {
      if (totalChars >= maxDigestChars) {
        break;
      }
      try {
        const exists = await deps.fsAccessor.exists(fileName);
        if (!exists) {
          continue;
        }
        const result = await deps.fsAccessor.readFileContent(fileName);
        const content = result.content;
        const preview = content.length > 500 ? `${content.slice(0, 500)}\n...(truncated)` : content;
        const block = `KEY FILE — ${fileName}:\n\`\`\`\n${preview}\n\`\`\``;
        if (totalChars + block.length < maxDigestChars) {
          sections.push(block);
          totalChars += block.length;
        }
      } catch {
        // best effort
      }
    }
  }

  return sections.length > 0
    ? `HERE IS WHAT EXISTS IN THIS WORKSPACE (file names and brief summaries):\n\n${sections.join('\n\n')}\n\nIMPORTANT: The list above shows file NAMES and short previews only — NOT the full content of each file. You have NOT read every document. When the user asks about specific file content, rely on [Retrieved Context] chunks provided in the user message, or use search_knowledge / read_file tools to look up the actual content. NEVER guess or fabricate what a file contains based on its title alone.`
    : undefined;
}