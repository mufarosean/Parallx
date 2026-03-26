import {
  type IChatMessage,
  type IChatParticipantContext,
  type IChatParticipantResult,
  type IChatRequestResponsePair,
  type IChatResponseChunk,
  type IChatResponseStream,
} from '../services/chatTypes.js';
import type {
  IChatRuntimeTrace,
  IChatSlashCommand,
  IDefaultParticipantServices,
  IOpenclawCommandRegistryFacade,
  IOpenclawRuntimeLifecycle,
  IParsedSlashCommand,
} from './openclawTypes.js';

const OPENCLAW_COMMANDS: Record<string, IChatSlashCommand> = {
  context: {
    name: 'context',
    description: 'Show the runtime context breakdown',
    promptTemplate: '{input}',
    isBuiltIn: true,
  },
  init: {
    name: 'init',
    description: 'Scan workspace and generate AGENTS.md',
    promptTemplate: '{input}',
    isBuiltIn: true,
  },
  compact: {
    name: 'compact',
    description: 'Summarize conversation to free token budget',
    promptTemplate: '{input}',
    isBuiltIn: true,
    specialHandler: 'compact',
  },
};

export function createOpenclawCommandRegistry(): IOpenclawCommandRegistryFacade {
  return {
    parseSlashCommand(text: string): IParsedSlashCommand {
      const trimmed = text.trim();
      if (!trimmed.startsWith('/')) {
        return {
          command: undefined,
          commandName: undefined,
          remainingText: text,
        };
      }

      const [commandName, ...rest] = trimmed.slice(1).split(/\s+/);
      return {
        command: OPENCLAW_COMMANDS[commandName],
        commandName,
        remainingText: rest.join(' '),
      };
    },
    applyCommandTemplate(command: IChatSlashCommand, input: string): string | undefined {
      return command.promptTemplate.includes('{input}')
        ? command.promptTemplate.replace('{input}', input)
        : input;
    },
  };
}

interface IInitCommandServices {
  readonly sendChatRequest: IDefaultParticipantServices['sendChatRequest'];
  readonly getWorkspaceName: IDefaultParticipantServices['getWorkspaceName'];
  readonly listFiles?: IDefaultParticipantServices['listFilesRelative'];
  readonly readFile?: IDefaultParticipantServices['readFileRelative'];
  readonly writeFile?: IDefaultParticipantServices['writeFileRelative'];
  readonly exists?: IDefaultParticipantServices['existsRelative'];
  readonly invalidatePromptFiles?: IDefaultParticipantServices['invalidatePromptFiles'];
}

const INIT_CONFIG_FILES = [
  'README.md', 'readme.md', 'README.txt',
  'package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg',
  'go.mod', 'build.gradle', 'pom.xml', 'Makefile', 'CMakeLists.txt',
  'tsconfig.json', '.eslintrc.json', '.prettierrc',
  'ARCHITECTURE.md', 'CONTRIBUTING.md',
  'docker-compose.yml', 'Dockerfile',
];

export async function tryHandleOpenclawInitCommand(
  services: Pick<
    IDefaultParticipantServices,
    'sendChatRequest' | 'getWorkspaceName' | 'listFilesRelative' | 'readFileRelative' | 'writeFileRelative' | 'existsRelative' | 'invalidatePromptFiles'
  >,
  requestCommandName: string | undefined,
  response: IChatResponseStream,
  signal?: AbortSignal,
): Promise<IChatParticipantResult | undefined> {
  if (requestCommandName !== 'init') {
    return undefined;
  }

  const initServices: IInitCommandServices = {
    sendChatRequest: services.sendChatRequest,
    getWorkspaceName: services.getWorkspaceName,
    listFiles: services.listFilesRelative,
    readFile: services.readFileRelative,
    writeFile: services.writeFileRelative,
    exists: services.existsRelative,
    invalidatePromptFiles: services.invalidatePromptFiles,
  };

  await executeOpenclawInitCommand(initServices, response, signal);
  return {};
}

async function executeOpenclawInitCommand(
  services: IInitCommandServices,
  response: IChatResponseStream,
  signal?: AbortSignal,
): Promise<void> {
  if (!services.listFiles || !services.readFile) {
    response.warning('/init requires a workspace folder to be open.');
    return;
  }

  response.progress('Scanning workspace...');

  const tree = await buildFileTree(services, '', 0);
  const treeStr = tree.join('\n');
  const configContext: string[] = [];

  for (const file of INIT_CONFIG_FILES) {
    try {
      const exists = await services.exists?.(file);
      if (!exists) {
        continue;
      }
      const content = await services.readFile(file);
      if (content && content.trim()) {
        const truncated = content.length > 8192
          ? `${content.slice(0, 8192)}\n... (truncated)`
          : content;
        configContext.push(`--- ${file} ---\n${truncated}`);
      }
    } catch {
      // Skip unreadable files.
    }
  }

  response.progress('Generating AGENTS.md...');

  const scanData = [
    `Workspace: "${services.getWorkspaceName()}"`,
    '',
    'File tree:',
    '```',
    treeStr,
    '```',
  ];

  if (configContext.length > 0) {
    scanData.push('', 'Key project files:', '', configContext.join('\n\n'));
  }

  const messages: IChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert at analyzing codebases. Your task is to generate an AGENTS.md file â€” a markdown document that describes a project to an AI assistant.',
        '',
        'The document should include:',
        '1. **Project name and one-line description**',
        '2. **Architecture overview** â€” key directories and their purpose',
        '3. **Conventions** â€” coding style, naming patterns, important rules',
        '4. **Important files** â€” files an AI should know about',
        '5. **Build & Run instructions** â€” how to develop, test, and build',
        '',
        'Guidelines:',
        '- Be concise but thorough (aim for 30-60 lines)',
        '- Use markdown headers (##) for sections',
        '- Reference actual file paths from the tree',
        '- If you see a README or ARCHITECTURE.md, use it as primary source',
        '- Output ONLY the AGENTS.md content â€” no preamble, no "here is the file"',
      ].join('\n'),
    },
    { role: 'user', content: scanData.join('\n') },
  ];

  let generatedContent = '';
  try {
    for await (const chunk of services.sendChatRequest(messages, undefined, signal)) {
      if (chunk.content) {
        generatedContent += chunk.content;
        response.markdown(chunk.content);
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      response.warning('/init was cancelled.');
      return;
    }
    response.warning(`Failed to generate AGENTS.md: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!generatedContent.trim()) {
    response.warning('The model returned empty content. Try again or write AGENTS.md manually.');
    return;
  }

  if (services.writeFile) {
    try {
      await services.writeFile('AGENTS.md', `${generatedContent.trim()}\n`);
      response.markdown('\n\n---\nâœ… **AGENTS.md** has been created at the workspace root.');
      for (const dir of ['.parallx', '.parallx/rules', '.parallx/commands', '.parallx/skills']) {
        const exists = await services.exists?.(dir);
        if (!exists) {
          await services.writeFile(`${dir}/.gitkeep`, '');
        }
      }
      response.markdown('\nðŸ“ `.parallx/` directory structure created (rules, commands, skills).');
      services.invalidatePromptFiles?.();
    } catch (err) {
      response.warning(`Could not write AGENTS.md: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  response.markdown('\n\n---\nAGENTS.md generation completed, but the runtime cannot write files in this workspace.');
}

async function buildFileTree(
  services: IInitCommandServices,
  relativePath: string,
  depth: number,
  entries: string[] = [],
): Promise<string[]> {
  if (!services.listFiles || depth > 4 || entries.length >= 200) {
    return entries;
  }

  try {
    const items = await services.listFiles(relativePath);
    for (const item of items) {
      if (entries.length >= 200) {
        break;
      }
      if (
        item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist'
        || item.name === 'build' || item.name === '__pycache__' || item.name === '.git'
        || item.name === 'vendor' || item.name === 'target' || item.name === 'coverage'
      ) {
        continue;
      }

      const indent = '  '.repeat(depth);
      const childPath = relativePath ? `${relativePath}/${item.name}` : item.name;
      if (item.type === 'directory') {
        entries.push(`${indent}${item.name}/`);
        await buildFileTree(services, childPath, depth + 1, entries);
      } else {
        entries.push(`${indent}${item.name}`);
      }
    }
  } catch {
    // Skip unreadable directories.
  }

  return entries;
}

export async function tryHandleOpenclawCompactCommand(
  services: Pick<IDefaultParticipantServices, 'sendSummarizationRequest' | 'compactSession' | 'storeSessionMemory'>,
  options: {
    readonly activeCommand?: string;
    readonly slashSpecialHandler?: string;
    readonly context: IChatParticipantContext;
    readonly response: IChatResponseStream;
  },
): Promise<boolean> {
  return tryExecuteCompactOpenclawCommand({
    sendSummarizationRequest: services.sendSummarizationRequest,
    compactSession: services.compactSession,
    storeSessionMemory: services.storeSessionMemory,
  }, {
    isCompactCommand: options.activeCommand === 'compact' || options.slashSpecialHandler === 'compact',
    sessionId: options.context.sessionId,
    history: options.context.history,
    response: options.response,
  });
}

interface IOpenclawCompactCommandDeps {
  readonly sendSummarizationRequest?: (
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly compactSession?: (sessionId: string, summaryText: string) => void;
  readonly storeSessionMemory?: (sessionId: string, summary: string, messageCount: number) => Promise<void>;
}

async function tryExecuteCompactOpenclawCommand(
  deps: IOpenclawCompactCommandDeps,
  input: {
    readonly isCompactCommand: boolean;
    readonly sessionId: string;
    readonly history: readonly IChatRequestResponsePair[];
    readonly response: IChatResponseStream;
  },
): Promise<boolean> {
  if (!input.isCompactCommand) {
    return false;
  }

  if (!deps.sendSummarizationRequest) {
    input.response.markdown('`/compact` requires a summarization model. No summarization service available.');
    return true;
  }
  if (input.history.length < 2) {
    input.response.markdown('Nothing to compact â€” conversation history is too short.');
    return true;
  }

  input.response.progress('Compacting conversation historyâ€¦');

  const historyText = input.history.map((pair) => {
    const responseText = pair.response.parts
      .map((part) => {
        const candidate = part as unknown as Record<string, unknown>;
        if ('text' in candidate && typeof candidate.text === 'string') {
          return candidate.text;
        }
        if ('content' in candidate && typeof candidate.content === 'string') {
          return candidate.content;
        }
        if ('code' in candidate && typeof candidate.code === 'string') {
          return `\`\`\`\n${candidate.code}\n\`\`\``;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return `User: ${pair.request.text}\nAssistant: ${responseText}`;
  }).join('\n\n---\n\n');

  const beforeTokens = Math.ceil(historyText.length / 4);
  const summaryPrompt: IChatMessage[] = [
    {
      role: 'system',
      content: 'You are a conversation summarizer. Condense the following conversation history into a concise context summary. Preserve all key facts, decisions, code references, and action items. Output ONLY the summary.',
    },
    { role: 'user', content: historyText },
  ];

  let summaryText = '';
  for await (const chunk of deps.sendSummarizationRequest(summaryPrompt)) {
    if (chunk.content) {
      summaryText += chunk.content;
    }
  }

  if (!summaryText) {
    input.response.markdown('Could not generate a summary. The conversation was not modified.');
    return true;
  }

  const afterTokens = Math.ceil(summaryText.length / 4);
  const saved = beforeTokens - afterTokens;
  deps.compactSession?.(input.sessionId, summaryText);

  // Auto-flush summary to long-term memory (upstream pattern: compaction → memory flush)
  if (deps.storeSessionMemory) {
    try {
      await deps.storeSessionMemory(input.sessionId, summaryText, input.history.length);
    } catch {
      // Memory flush failure is non-fatal
    }
  }

  input.response.markdown(
    `**Conversation compacted.**\n\n`
    + `- Before: ~${beforeTokens.toLocaleString()} tokens (${input.history.length} turns)\n`
    + `- After: ~${afterTokens.toLocaleString()} tokens (summary)\n`
    + `- Saved: ~${saved.toLocaleString()} tokens (${Math.round((saved / beforeTokens) * 100)}%)\n\n`
    + 'The summarized context will be used for future messages in this session.',
  );
  return true;
}

export function buildFallbackSessionSummary(
  history: readonly { request: { text: string } }[],
  currentRequestText: string,
): string {
  const userMessages = [...history.map((entry) => entry.request.text), currentRequestText]
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-3);

  if (userMessages.length === 0) {
    return '';
  }

  const summary = userMessages.map((text) => /[.!?]$/.test(text) ? text : `${text}.`).join(' ');
  return summary.length <= 900 ? summary : `${summary.slice(0, 897).trimEnd()}...`;
}

export function createOpenclawRuntimeLifecycle(options: {
  runtimeTraceSeed?: Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'>;
  reportRuntimeTrace?: (trace: IChatRuntimeTrace) => void;
}): IOpenclawRuntimeLifecycle {
  let pendingMemoryWriteBack:
    | {
        deps: Parameters<IOpenclawRuntimeLifecycle['queueMemoryWriteBack']>[0];
        options: Parameters<IOpenclawRuntimeLifecycle['queueMemoryWriteBack']>[1];
      }
    | undefined;

  const reportCheckpoint = (checkpoint: string, runState?: IChatRuntimeTrace['runState'], note?: string): void => {
    if (!options.runtimeTraceSeed || !options.reportRuntimeTrace) {
      return;
    }
    options.reportRuntimeTrace({
      ...options.runtimeTraceSeed,
      checkpoint,
      runState,
      note,
    });
  };

  const flushPendingMemoryWriteBack = (): void => {
    if (!pendingMemoryWriteBack) {
      return;
    }
    const queued = pendingMemoryWriteBack;
    pendingMemoryWriteBack = undefined;
    queueOpenclawMemoryWriteBack(queued.deps, queued.options, reportCheckpoint);
  };

  return {
    queueMemoryWriteBack: (deps, lifecycleOptions) => {
      pendingMemoryWriteBack = { deps, options: lifecycleOptions };
    },
    recordCompleted: (note) => {
      reportCheckpoint('post-finalization', 'completed', note);
      flushPendingMemoryWriteBack();
    },
    recordAborted: (note) => {
      pendingMemoryWriteBack = undefined;
      reportCheckpoint('run-aborted', 'aborted', note);
    },
    recordFailed: (note) => {
      pendingMemoryWriteBack = undefined;
      reportCheckpoint('run-failed', 'failed', note);
    },
  };
}

function queueOpenclawMemoryWriteBack(
  deps: Parameters<IOpenclawRuntimeLifecycle['queueMemoryWriteBack']>[0],
  options: Parameters<IOpenclawRuntimeLifecycle['queueMemoryWriteBack']>[1],
  reportCheckpoint: (checkpoint: string, runState?: IChatRuntimeTrace['runState'], note?: string) => void,
): void {
  if (!options.memoryEnabled) {
    return;
  }

  if (deps.extractPreferences && options.requestText) {
    deps.extractPreferences(options.requestText).then(() => {
      reportCheckpoint('memory-preferences-extracted');
    }).catch(() => {});
  }

  if (!deps.storeSessionMemory || !deps.isSessionEligibleForSummary || !deps.getSessionMemoryMessageCount || options.history.length === 0) {
    return;
  }

  const sessionId = options.sessionId ?? '';
  const messageCount = options.history.length + 1;
  const storeMemory = deps.storeSessionMemory;
  if (!sessionId || !deps.isSessionEligibleForSummary(messageCount)) {
    return;
  }

  deps.getSessionMemoryMessageCount(sessionId).then(async (storedCount) => {
    const shouldSummarize = storedCount === null || messageCount >= storedCount * 2 || messageCount >= storedCount + 10;
    if (!shouldSummarize) {
      return;
    }

    try {
      const transcript = options.history.map((entry) => {
        const responseText = entry.response.parts
          .map((part) => ('content' in part && typeof part.content === 'string') ? part.content : '')
          .filter(Boolean)
          .join(' ');
        return `User: ${entry.request.text}\nAssistant: ${responseText}`;
      }).join('\n\n');
      const fallbackSummary = deps.buildFallbackSessionSummary(options.history, options.requestText);
      if (fallbackSummary) {
        await storeMemory(sessionId, fallbackSummary, messageCount);
        reportCheckpoint('memory-summary-fallback-stored');
      }

      if (!deps.sendSummarizationRequest) {
        return;
      }

      const summaryPrompt: IChatMessage[] = [
        {
          role: 'system',
          content: 'Summarise this conversation in 2-4 sentences. Focus on the key topics discussed, decisions made, and any important context. Prefer user-specific facts over general advice. Preserve concrete facts like names, locations, dates, numbers, report IDs, and anything the user may ask you to remember later. Output ONLY the summary.',
        },
        { role: 'user', content: `${transcript}\n\nUser: ${options.requestText}` },
      ];

      let summaryText = '';
      for await (const chunk of deps.sendSummarizationRequest(summaryPrompt)) {
        if (chunk.content) {
          summaryText += chunk.content;
        }
      }

      summaryText = summaryText.trim();
      if (summaryText) {
        await storeMemory(sessionId, summaryText, messageCount);
        reportCheckpoint('memory-summary-refined-stored');
      }
    } catch {
      // Ignore background memory write-back failures.
    }
  }).catch(() => {});
}
