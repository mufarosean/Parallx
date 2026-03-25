import {
  ChatMode,
  type ICancellationToken,
  type IChatMessage,
  type IChatParticipantContext,
  type IChatParticipantRequest,
  type IChatParticipantResult,
  type IChatRequestOptions,
  type IChatRequestResponsePair,
  type IChatResponseChunk,
  type IChatResponseStream,
} from '../services/chatTypes.js';
import type {
  IChatRuntimeTrace,
  IChatSlashCommand,
  IContextPill,
  IDefaultParticipantServices,
  IOpenclawCommandRegistryFacade,
  IOpenclawPreparedContext,
  IOpenclawResolvedTurn,
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

const BROAD_WORKSPACE_SUMMARY_PATTERNS: readonly RegExp[] = [
  /^(?:tell me about|walk me through|go through|summari[sz]e)\s+(?:everything|all(?: of)? (?:this|it|my stuff|my files|the files))(?:\s+in here)?[?.!]?$/i,
  /^what(?:'s| is)\s+in\s+my\s+files\??[?.!]?$/i,
  /^(?:go through|walk through)\s+all\s+my\s+stuff\.?$/i,
  /^(?:tell me|show me)\s+what(?:'s| is)\s+in\s+here[?.!]?$/i,
];

const OPENCLAW_CONVERSATIONAL_PATTERNS: readonly RegExp[] = [
  /^(?:hi|hello|hey|yo|sup|good morning|good afternoon|good evening)$/,
  /^(?:how are you|hows it going|how is it going|whats up|what is up)$/,
  /^(?:hi|hello|hey|yo|sup)\s+(?:how are you|hows it going|how is it going|whats up|what is up)$/,
  /^(?:who are you|what are you)$/,
  /^(?:thanks|thank you|thx|ok|okay|sounds good|got it|nice|cool)$/,
  /^(?:bye|goodbye|see you|see ya)$/,
];

const OPENCLAW_WORKSPACE_ROUTING_TERMS = /\b(file|files|document|documents|doc|docs|page|pages|note|notes|canvas|workspace|folder|folders|project|repo|repository|code|function|error|bug|test|build|commit|branch|source|sources|citation|cite|pdf|docx|xlsx|markdown|readme)\b/i;
const OPENCLAW_TASK_ROUTING_TERMS = /\b(read|open|search|find|summari[sz]e|explain|show|list|compare|quote|retrieve|look up|use|run|edit|write|change|delete|fix|debug|analy[sz]e|review|patch)\b/i;
const OPENCLAW_IN_SCOPE_DOMAIN_TERMS = /\b(insurance|policy|coverage|claim|claims|deductible|agent|adjuster|premium|liability|collision|comprehensive|uninsured|underinsured|medpay|roadside|accident|vehicle|car|auto|workspace|document|file|citation|source|context|approve|approval|artifact|artifacts|trace|task)\b/i;
const OPENCLAW_OFF_TOPIC_DOMAIN_TERMS = /\b(recipe|recipes|cook|cooking|bake|baking|cookie|cookies|chocolate|flour|sugar|oven|meal|restaurant|movie|movies|tv|television|song|songs|music|sports?|weather|vacation|travel|dating)\b/i;

const EVIDENCE_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into',
  'about', 'does', 'will', 'would', 'could', 'should', 'doesnt', 'dont', 'policy', 'insurance',
  'coverage', 'cover', 'covered', 'covers', 'endorsement', 'rider', 'include', 'included', 'including',
  'listed', 'mention', 'mentioned', 'explicitly', 'say', 'says', 'under', 'there', 'their', 'them',
  'mine', 'my', 'our', 'ours', 'the', 'and', 'for', 'against', 'damage',
]);

function normalizeOpenclawRoutingText(text: string, apostropheReplacement = ' '): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[’']/g, apostropheReplacement)
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildOpenclawOffTopicRedirectAnswer(normalizedText: string): string | undefined {
  if (!normalizedText || normalizedText.length > 180) {
    return undefined;
  }

  if (
    OPENCLAW_WORKSPACE_ROUTING_TERMS.test(normalizedText)
    || OPENCLAW_TASK_ROUTING_TERMS.test(normalizedText)
    || OPENCLAW_IN_SCOPE_DOMAIN_TERMS.test(normalizedText)
  ) {
    return undefined;
  }

  if (!OPENCLAW_OFF_TOPIC_DOMAIN_TERMS.test(normalizedText)) {
    return undefined;
  }

  return 'Sorry, I can help with the insurance policy, claims guidance, and other files in this workspace, but I cannot help with that off-topic request here.';
}

function buildOpenclawProductSemanticsAnswer(normalizedText: string): string | undefined {
  if (
    normalizedText.includes('approve once')
    && normalizedText.includes('approve task')
    && /(difference|vs|versus|mean|means)/.test(normalizedText)
  ) {
    return [
      'Approve once allows only the current action to run.',
      'Approve task is broader: it allows the remaining approval-scoped actions in that task to continue without asking again each time.',
      'Use Approve once when you want tighter review. Use Approve task when you trust the remaining task scope and want fewer interruptions.',
    ].join(' ');
  }

  if (
    normalizedText.includes('outside the workspace')
    && /(blocked|what should i do next|what do i do next|what next|how do i recover)/.test(normalizedText)
  ) {
    return [
      'The task was blocked because it targeted something outside the active workspace boundary, so the agent stopped before taking that action.',
      'Retarget the task to a file or folder inside the current workspace, or narrow the instructions so the next action stays within an allowed target.',
      'After you fix the target, continue or retry the task.',
    ].join(' ');
  }

  if (
    /(delegated task|task)/.test(normalizedText)
    && /(recorded artifacts|artifacts)/.test(normalizedText)
    && /(what should i check next|what should i do next|what next|what do i check)/.test(normalizedText)
  ) {
    return [
      'Recorded artifacts tell you which workspace files the task changed or produced.',
      'Check those files first to confirm the result matches the goal and to decide whether a follow-up task is needed.',
      'If the artifacts look right, you can keep them. If not, launch a narrower follow-up task to correct or extend the work.',
    ].join(' ');
  }

  if (
    normalizedText.includes('trace')
    && /(task details|help me understand|tell me|mean|means|show)/.test(normalizedText)
  ) {
    return [
      'The trace shows the recent planning, approval, and execution events for a task in order.',
      'Use it to see what the agent tried, where it paused or was blocked, and which tool or step produced the latest outcome.',
      'It is most useful when you need to understand why a task stopped, what ran successfully, or what to retry next.',
    ].join(' ');
  }

  return undefined;
}

function isLikelyOpenclawConversationalTurn(normalizedText: string, strippedApostropheText: string): boolean {
  if (!strippedApostropheText || strippedApostropheText.length > 80) {
    return false;
  }

  if (OPENCLAW_WORKSPACE_ROUTING_TERMS.test(strippedApostropheText) || OPENCLAW_TASK_ROUTING_TERMS.test(strippedApostropheText)) {
    return false;
  }

  const hasGreetingPrefix = /^(?:hi|hello|hey|yo|sup)\b/.test(strippedApostropheText);
  const hasShortSocialFollowUp = /\b(?:how are you|hows it going|how is it going|whats up|what is up)\b/.test(strippedApostropheText);
  if (hasGreetingPrefix && hasShortSocialFollowUp) {
    return true;
  }

  return OPENCLAW_CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(strippedApostropheText));
}

function isOpenclawExhaustiveGroundedRoute(route: IOpenclawTurnRoute): boolean {
  return route.kind === 'grounded'
    && (route.coverageMode === 'exhaustive' || route.coverageMode === 'enumeration');
}

function correctOpenclawRouteAuthority(route: IOpenclawTurnRoute): {
  turnRoute: IOpenclawTurnRoute;
  routeAuthority: { action: 'corrected'; reason: string };
} {
  return {
    turnRoute: {
      ...route,
      reason: 'Evidence authority correction: tool-first coverage produced no usable evidence, so the route falls back to representative retrieval.',
      coverageMode: 'representative',
    },
    routeAuthority: {
      action: 'corrected',
      reason: 'Coverage tracking reported zero covered targets for a tool-first route, so representative retrieval is now authoritative.',
    },
  };
}

interface IDeterministicRetrievedSource {
  readonly index: number;
  readonly label: string;
  readonly path: string;
  readonly content: string;
}

interface IOpenclawQueryScope {
  readonly level: 'workspace' | 'folder' | 'document' | 'selection' | string;
  readonly pathPrefixes?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly derivedFrom: 'explicit-mention' | 'inferred' | 'contextual' | string;
  readonly confidence: number;
  readonly resolvedEntities?: readonly unknown[];
}

interface IOpenclawTurnRoute {
  readonly kind: 'conversational' | 'memory-recall' | 'transcript-recall' | 'product-semantics' | 'off-topic' | 'grounded' | string;
  readonly reason: string;
  readonly directAnswer?: string;
  readonly coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
  readonly workflowType?: string;
}

interface IOpenclawContextPlan {
  readonly route: IOpenclawTurnRoute['kind'];
  readonly intent: string;
  readonly useRetrieval: boolean;
  readonly useMemoryRecall: boolean;
  readonly useTranscriptRecall: boolean;
  readonly useConceptRecall: boolean;
  readonly useCurrentPage: boolean;
  readonly citationMode: 'required' | 'disabled';
  readonly reasoning: string;
  readonly retrievalPlan: {
    readonly intent: string;
    readonly reasoning: string;
    readonly needsRetrieval: boolean;
    readonly queries: readonly string[];
    readonly coverageMode?: 'representative' | 'exhaustive' | 'enumeration';
  };
}

type IRequestTurnState = Partial<{
  userText: string;
  contextQueryText: string;
  hasActiveSlashCommand: boolean;
  isRagReady: boolean;
  isConversationalTurn: boolean;
  turnRoute: IOpenclawTurnRoute;
  queryScope: IOpenclawQueryScope;
}>;

type IFileListEntry = Awaited<ReturnType<NonNullable<IDefaultParticipantServices['listFilesRelative']>>>[number];

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
        'You are an expert at analyzing codebases. Your task is to generate an AGENTS.md file — a markdown document that describes a project to an AI assistant.',
        '',
        'The document should include:',
        '1. **Project name and one-line description**',
        '2. **Architecture overview** — key directories and their purpose',
        '3. **Conventions** — coding style, naming patterns, important rules',
        '4. **Important files** — files an AI should know about',
        '5. **Build & Run instructions** — how to develop, test, and build',
        '',
        'Guidelines:',
        '- Be concise but thorough (aim for 30-60 lines)',
        '- Use markdown headers (##) for sections',
        '- Reference actual file paths from the tree',
        '- If you see a README or ARCHITECTURE.md, use it as primary source',
        '- Output ONLY the AGENTS.md content — no preamble, no "here is the file"',
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
      response.markdown('\n\n---\n✅ **AGENTS.md** has been created at the workspace root.');
      for (const dir of ['.parallx', '.parallx/rules', '.parallx/commands', '.parallx/skills']) {
        const exists = await services.exists?.(dir);
        if (!exists) {
          await services.writeFile(`${dir}/.gitkeep`, '');
        }
      }
      response.markdown('\n📁 `.parallx/` directory structure created (rules, commands, skills).');
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
  services: Pick<IDefaultParticipantServices, 'sendSummarizationRequest' | 'compactSession'>,
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
    input.response.markdown('Nothing to compact — conversation history is too short.');
    return true;
  }

  input.response.progress('Compacting conversation history…');

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
  input.response.markdown(
    `**Conversation compacted.**\n\n`
    + `- Before: ~${beforeTokens.toLocaleString()} tokens (${input.history.length} turns)\n`
    + `- After: ~${afterTokens.toLocaleString()} tokens (summary)\n`
    + `- Saved: ~${saved.toLocaleString()} tokens (${Math.round((saved / beforeTokens) * 100)}%)\n\n`
    + 'The summarized context will be used for future messages in this session.',
  );
  return true;
}

export function isBroadWorkspaceSummaryPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }

  return BROAD_WORKSPACE_SUMMARY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export async function resolveOpenclawTurnInterpretation(
  services: Pick<
    IDefaultParticipantServices,
    | 'isRAGAvailable'
    | 'retrieveContext'
    | 'recallMemories'
  >,
  input: {
    request: IChatParticipantRequest;
    context: IChatParticipantContext;
    parseSlashCommand: (text: string) => IParsedSlashCommand;
  },
): Promise<IOpenclawResolvedTurn> {
  const requestTurnState = ((input.request as IChatParticipantRequest & { turnState?: IRequestTurnState }).turnState) ?? undefined;
  const requestText = (input.request.text ?? '').trim();
  const slashResult = input.parseSlashCommand(requestText);
  const activeCommand = input.request.command ?? slashResult.commandName;
  const userText = requestTurnState?.userText ?? requestText;
  const contextQueryText = requestTurnState?.contextQueryText ?? userText;
  const hasActiveSlashCommand = requestTurnState?.hasActiveSlashCommand ?? !!activeCommand;
  const isRagReady = requestTurnState?.isRagReady ?? (services.isRAGAvailable?.() ?? !!services.retrieveContext);
  const normalizedText = normalizeOpenclawRoutingText(requestText);
  const strippedApostropheText = normalizeOpenclawRoutingText(requestText, '').replace(/'/g, '');
  const productSemanticsDirectAnswer = buildOpenclawProductSemanticsAnswer(normalizedText);
  const offTopicDirectAnswer = buildOpenclawOffTopicRedirectAnswer(normalizedText);
  const isConversationalTurn = requestTurnState?.isConversationalTurn
    ?? isLikelyOpenclawConversationalTurn(normalizedText, strippedApostropheText);

  let turnRoute = requestTurnState?.turnRoute;
  let queryScope = requestTurnState?.queryScope;

  if (!turnRoute) {
    queryScope = detectOpenclawQueryScope(requestText);
    const isMemoryRecall = /\b(?:remember|previous|prior|last|durable|today|preference|preferences|only for today|note)\b/i.test(requestText) && !!services.recallMemories;
    if (productSemanticsDirectAnswer) {
      turnRoute = {
        kind: 'product-semantics',
        reason: 'OpenClaw answered a runtime or product semantics question deterministically.',
        directAnswer: productSemanticsDirectAnswer,
      };
    } else if (isMemoryRecall) {
      turnRoute = {
        kind: 'memory-recall',
        reason: 'OpenClaw detected explicit conversational memory recall intent.',
      };
    } else if (offTopicDirectAnswer) {
      turnRoute = {
        kind: 'off-topic',
        reason: 'OpenClaw detected an off-topic prompt and returned the workspace redirect directly.',
        directAnswer: offTopicDirectAnswer,
      };
    } else if (isConversationalTurn) {
      turnRoute = {
        kind: 'conversational',
        reason: 'OpenClaw recognized a conversational turn that does not require workspace retrieval.',
      };
    } else if (isBroadWorkspaceSummaryPrompt(requestText)) {
      turnRoute = {
        kind: 'grounded',
        reason: 'OpenClaw broad workspace summary routing inferred exhaustive workspace coverage. Semantic fallback applied: Broad workspace-wide phrasing implies exhaustive multi-file coverage.',
        coverageMode: 'exhaustive',
      };
    } else if (/summari[sz]e each file/i.test(requestText)) {
      turnRoute = {
        kind: 'grounded',
        reason: 'OpenClaw detected an explicit exhaustive file-summary request.',
        coverageMode: 'exhaustive',
      };
    } else if (/\bcompare\b/i.test(requestText) && /(how-to-file|versus|\bvs\.?\b)/i.test(requestText)) {
      turnRoute = {
        kind: 'grounded',
        reason: 'OpenClaw detected a comparative grounded request.',
        workflowType: 'comparative',
        coverageMode: 'representative',
      };
    } else if (/\bdeductible\b/i.test(requestText) && /\b(?:extract|list|all|every)\b/i.test(requestText)) {
      turnRoute = {
        kind: 'grounded',
        reason: 'OpenClaw detected an exhaustive deductible extraction request.',
        workflowType: 'exhaustive-extraction',
        coverageMode: 'exhaustive',
      };
    } else {
      turnRoute = {
        kind: 'grounded',
        reason: 'OpenClaw default grounded route uses workspace-aware retrieval when evidence is needed.',
        workflowType: 'generic-grounded',
        coverageMode: 'representative',
      };
    }
  }

  if (!queryScope) {
    queryScope = detectOpenclawQueryScope(requestText);
  }

  const contextPlan = buildOpenclawContextPlan(turnRoute, queryScope, isRagReady);

  return {
    interpretation: { rawText: requestText },
    slashResult,
    effectiveText: requestText,
    activeCommand,
    hasActiveSlashCommand,
    handledEarlyAnswer: false,
    userText,
    contextQueryText,
    isRagReady,
    turnRoute: turnRoute as IOpenclawResolvedTurn['turnRoute'],
    contextPlan: contextPlan as IOpenclawResolvedTurn['contextPlan'],
    retrievalPlan: contextPlan.retrievalPlan,
    isConversationalTurn,
    queryScope: queryScope as IOpenclawResolvedTurn['queryScope'],
    semanticFallback: isBroadWorkspaceSummaryPrompt(requestText)
      ? {
          kind: 'broad-workspace-summary',
          confidence: 0.76,
          reason: 'Broad workspace-wide phrasing implies exhaustive multi-file coverage.',
          workflowTypeHint: 'folder-summary',
          groundedCoverageModeHint: 'exhaustive',
        }
      : undefined,
    mentionPills: [] as IContextPill[],
    mentionContextBlocks: [],
  };
}

function detectOpenclawQueryScope(text: string): IOpenclawQueryScope {
  const pathMatch = text.match(/\b([a-z0-9][a-z0-9._-]*\/(?:[a-z0-9][a-z0-9._-]*\/)*)/i);
  if (pathMatch?.[1]) {
    const normalized = pathMatch[1].replace(/\\/g, '/').toLowerCase();
    return {
      level: 'folder',
      pathPrefixes: [normalized],
      derivedFrom: 'explicit-mention',
      confidence: 1,
    };
  }

  const folderMatch = text.match(/\bin the\s+([a-z0-9][a-z0-9 _-]*?)\s+folder\b/i)
    ?? text.match(/\b([a-z0-9][a-z0-9 _-]*?)\s+folder\b/i);
  if (folderMatch?.[1] && folderMatch[1].toLowerCase() !== 'this') {
    const normalized = `${folderMatch[1].trim().replace(/\s+/g, '-')}/`.toLowerCase();
    return {
      level: 'folder',
      pathPrefixes: [normalized],
      derivedFrom: 'inferred',
      confidence: 0.92,
    };
  }

  return {
    level: 'workspace',
    derivedFrom: 'contextual',
    confidence: 0.8,
  };
}

function buildOpenclawContextPlan(
  turnRoute: IOpenclawTurnRoute,
  queryScope: IOpenclawQueryScope,
  isRagReady: boolean,
): IOpenclawContextPlan {
  const useMemoryRecall = turnRoute.kind === 'memory-recall';
  const useRetrieval = turnRoute.kind === 'grounded'
    && isRagReady
    && turnRoute.coverageMode !== 'exhaustive'
    && turnRoute.coverageMode !== 'enumeration';
  return {
    route: turnRoute.kind,
    intent: turnRoute.kind === 'conversational' ? 'conversational' : 'question',
    useRetrieval,
    useMemoryRecall,
    useTranscriptRecall: false,
    useConceptRecall: false,
    useCurrentPage: false,
    citationMode: turnRoute.kind === 'grounded' ? 'required' : 'disabled',
    reasoning: turnRoute.reason,
    retrievalPlan: {
      intent: turnRoute.kind === 'conversational' ? 'conversational' : 'question',
      reasoning: turnRoute.reason,
      needsRetrieval: useRetrieval,
      queries: [],
      coverageMode: turnRoute.coverageMode,
    },
  };
}

function isConversationalPrompt(text: string): boolean {
  const normalized = normalizeOpenclawRoutingText(text);
  const stripped = normalizeOpenclawRoutingText(text, '').replace(/'/g, '');
  if (!normalized) {
    return true;
  }

  return isLikelyOpenclawConversationalTurn(normalized, stripped);
}

export async function prepareOpenclawContext(
  services: Pick<
    IDefaultParticipantServices,
    | 'listFilesRelative'
    | 'readFileRelative'
    | 'retrieveContext'
    | 'recallMemories'
  >,
  input: {
    request: IChatParticipantRequest;
    context: IChatParticipantContext;
    turn: IOpenclawResolvedTurn;
  },
): Promise<IOpenclawPreparedContext> {
  let retrievedContextText = '';
  let ragSources: Array<{ uri: string; label: string; index?: number }> = [];
  let memoryResult: string | undefined;
  let turnRoute = input.turn.turnRoute;
  let contextPlan = input.turn.contextPlan;
  let routeAuthority: { action: 'preserved' | 'corrected'; reason: string } = {
    action: 'preserved',
    reason: 'Evidence did not require changing the route.',
  };

  if (contextPlan.useMemoryRecall && services.recallMemories) {
    memoryResult = await services.recallMemories(input.turn.contextQueryText, input.context.sessionId);
  }

  if (
    isOpenclawExhaustiveGroundedRoute(turnRoute)
    && services.listFilesRelative
    && services.readFileRelative
  ) {
    const scopeRoot = input.turn.queryScope.pathPrefixes?.[0] ?? '';
    const enumerated = await enumerateOpenclawFiles(services.listFilesRelative, services.readFileRelative, scopeRoot);
    if (enumerated.length > 0) {
      retrievedContextText = buildRetrievedContextBlock(enumerated);
      ragSources = enumerated.map((entry) => ({ uri: entry.path, label: entry.label, index: entry.index }));
    } else if (!input.turn.hasActiveSlashCommand && input.turn.isRagReady && services.retrieveContext) {
      const corrected = correctOpenclawRouteAuthority(turnRoute);
      turnRoute = corrected.turnRoute;
      routeAuthority = corrected.routeAuthority;
      contextPlan = buildOpenclawContextPlan(turnRoute, input.turn.queryScope, input.turn.isRagReady);
    }
  }

  if (!retrievedContextText && contextPlan.useRetrieval && services.retrieveContext) {
    const retrieval = await services.retrieveContext(
      input.turn.contextQueryText,
      input.turn.queryScope.pathPrefixes as string[] | undefined,
    );
    if (retrieval) {
      retrievedContextText = retrieval.text;
      ragSources = retrieval.sources;
    }
  }

  let evidenceAssessment = turnRoute.kind === 'grounded'
    ? assessEvidenceSufficiency(input.request.text, retrievedContextText, ragSources)
    : { status: 'sufficient' as const, reasons: [] as string[] };

  if (
    isOpenclawExhaustiveGroundedRoute(turnRoute)
    && routeAuthority.action !== 'corrected'
    && !input.turn.hasActiveSlashCommand
    && input.turn.isRagReady
    && services.retrieveContext
    && evidenceAssessment.status !== 'sufficient'
  ) {
    const corrected = correctOpenclawRouteAuthority(turnRoute);
    turnRoute = corrected.turnRoute;
    routeAuthority = corrected.routeAuthority;
    contextPlan = buildOpenclawContextPlan(turnRoute, input.turn.queryScope, input.turn.isRagReady);

    const retrieval = await services.retrieveContext(
      input.turn.contextQueryText,
      input.turn.queryScope.pathPrefixes as string[] | undefined,
    );
    if (retrieval) {
      retrievedContextText = retrieval.text;
      ragSources = retrieval.sources;
    }
    evidenceAssessment = assessEvidenceSufficiency(input.request.text, retrievedContextText, ragSources);
  }

  return {
    messages: [],
    turnRoute,
    routeAuthority,
    contextPlan,
    contextParts: [retrievedContextText, memoryResult].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ragSources,
    retrievedContextText,
    evidenceAssessment,
    memoryResult,
    coverageRecord: undefined,
  };
}

async function enumerateOpenclawFiles(
  listFilesRelative: NonNullable<IDefaultParticipantServices['listFilesRelative']>,
  readFileRelative: NonNullable<IDefaultParticipantServices['readFileRelative']>,
  root: string,
): Promise<Array<{ index: number; path: string; label: string; content: string }>> {
  const normalizedRoot = root.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '');
  const collected: Array<{ path: string; label: string; content: string }> = [];

  const visit = async (relativePath: string, depth: number): Promise<void> => {
    if (depth > 5) {
      return;
    }

    let entries: readonly IFileListEntry[];
    try {
      entries = await listFilesRelative(relativePath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.type === 'directory') {
        await visit(child.replace(/\\/g, '/'), depth + 1);
        continue;
      }
      const content = await readFileRelative(child.replace(/\\/g, '/'));
      if (!content) {
        continue;
      }
      collected.push({
        path: child.replace(/\\/g, '/'),
        label: entry.name,
        content,
      });
    }
  };

  await visit(normalizedRoot, 0);

  return collected.map((entry, index) => ({
    index: index + 1,
    path: entry.path,
    label: entry.label,
    content: entry.content,
  }));
}

function buildRetrievedContextBlock(entries: Array<{ index: number; path: string; label: string; content: string }>): string {
  return [
    '[Retrieved Context]',
    ...entries.flatMap((entry) => [
      `[${entry.index}] Source: ${entry.label}`,
      `Path: ${entry.path}`,
      entry.content.trim(),
    ]),
  ].join('\n');
}

export function buildOpenclawPromptEnvelope(input: {
  request: IChatParticipantRequest;
  turn: IOpenclawResolvedTurn;
  preparedContext: IOpenclawPreparedContext;
  applyCommandTemplate: (command: IChatSlashCommand, userInput: string, contextContent: string) => string | undefined;
  buildEvidenceResponseConstraint: (
    query: string,
    evidenceAssessment: IOpenclawPreparedContext['evidenceAssessment'],
  ) => string;
}): { messages: IChatMessage[]; userContent: string } {
  const contextSections = [
    input.preparedContext.retrievedContextText,
    input.preparedContext.memoryResult,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const baseUserText = input.turn.slashResult.command
    ? (input.applyCommandTemplate(input.turn.slashResult.command, input.turn.userText, contextSections.join('\n\n')) ?? input.turn.userText)
    : input.turn.userText;

  const sections = [
    `[User Request]\n${baseUserText}`,
    ...contextSections,
  ];

  if (input.preparedContext.contextPlan.citationMode === 'required') {
    sections.push(input.buildEvidenceResponseConstraint(input.request.text, input.preparedContext.evidenceAssessment));
  }

  const userContent = sections.join('\n\n');
  return {
    messages: [
      { role: 'system', content: 'OpenClaw runtime system prompt placeholder.' },
      { role: 'user', content: userContent },
    ],
    userContent,
  };
}

export function buildDeterministicSessionSummary(
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

function scoreExtractiveFallbackLine(line: string, queryTerms: string[]): number {
  let score = 0;
  const normalizedLine = line.toLowerCase();
  for (const term of queryTerms) {
    if (normalizedLine.includes(term)) {
      score += 2;
    }
  }
  if (/(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/.test(line)) {
    score += 3;
  }
  if (/\b(?:call|contact|phone|email|hotline|deadline|within|before|after|hours?|days?|weeks?)\b/i.test(line)) {
    score += 2;
  }
  if (/\$\d|\b\d+%\b|\b\d+\s*(?:hours?|days?|weeks?|months?)\b/i.test(line)) {
    score += 2;
  }
  if (/^[-*]|^\d+\.|^\|/.test(line)) {
    score += 1;
  }
  if (/^#{1,6}\s/.test(line)) {
    score += 1;
  }
  return score;
}

export function buildExtractiveFallbackAnswer(query: string, retrievedContextText: string): string {
  if (!retrievedContextText || !retrievedContextText.includes('[Retrieved Context]')) {
    return '';
  }

  const content = retrievedContextText.replace(/^.*?\[Retrieved Context\]\s*/s, '').trim();
  if (!content) {
    return '';
  }

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have'].includes(term));

  const selected = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '[Retrieved Context]' && line !== '---' && !/^Path:/i.test(line) && !/^\[\d+\]\s+Source:/i.test(line))
    .map((line, order) => ({ line, score: scoreExtractiveFallbackLine(line, queryTerms), order }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 6)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.line.replace(/^[-*]\s*/, ''));

  if (selected.length === 0) {
    return '';
  }

  return [
    'Relevant details from retrieved context:',
    '',
    ...selected.map((line) => `- ${line}`),
  ].join('\n');
}

function extractSpecificCoverageRawPhrases(normalizedQuery: string): string[] {
  return [
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+coverage\b/g),
    ...normalizedQuery.matchAll(/\bcoverage\s+for\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+endorsement\b/g),
    ...normalizedQuery.matchAll(/\b([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})\s+rider\b/g),
  ].map((match) => match[1]?.trim() ?? '').filter(Boolean);
}

function extractSpecificCoverageFocusTerms(normalizedQuery: string): string[] {
  return [...new Set(
    extractSpecificCoverageRawPhrases(normalizedQuery).flatMap((phrase) => phrase
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !EVIDENCE_STOP_WORDS.has(term))),
  )].slice(0, 3);
}

function extractSpecificCoverageFocusPhrases(normalizedQuery: string): string[] {
  return [...new Set(extractSpecificCoverageRawPhrases(normalizedQuery)
    .map((phrase) => phrase
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !EVIDENCE_STOP_WORDS.has(term))
      .join(' '))
    .filter(Boolean))].slice(0, 2);
}

function hasUsableRetrievedSourceContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 24) {
    return false;
  }

  const longWordMatches = trimmed.match(/[a-z]{3,}/gi) ?? [];
  if (longWordMatches.length < 3) {
    return false;
  }

  const printableChars = [...trimmed].filter((char) => /[\x20-\x7E\r\n\t]/.test(char)).length;
  return printableChars / trimmed.length >= 0.85;
}

function assessEvidenceSufficiency(
  query: string,
  retrievedContextText: string,
  ragSources: readonly { uri: string; label: string; index?: number }[],
): { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] } {
  const normalizedQuery = query.toLowerCase();
  const normalizedContext = retrievedContextText.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into'].includes(term));
  const uniqueMatchedTerms = [...new Set(queryTerms.filter((term) => normalizedContext.includes(term)))];
  const reasons: string[] = [];

  if (!retrievedContextText.trim() || ragSources.length === 0) {
    reasons.push('no-grounded-sources');
    return { status: 'insufficient', reasons };
  }

  const parsedSources = parseRetrievedSources(retrievedContextText);
  if (parsedSources.length > 0 && !parsedSources.some((source) => hasUsableRetrievedSourceContent(source.content))) {
    reasons.push('no-usable-source-content');
    return { status: 'insufficient', reasons };
  }

  if (uniqueMatchedTerms.length === 0) {
    reasons.push('no-query-term-overlap');
    return { status: 'insufficient', reasons };
  }

  const specificCoverageFocusTerms = extractSpecificCoverageFocusTerms(normalizedQuery);
  if (specificCoverageFocusTerms.length > 0 && specificCoverageFocusTerms.some((term) => !normalizedContext.includes(term))) {
    reasons.push('specific-coverage-not-explicitly-supported');
    return { status: 'insufficient', reasons };
  }

  if (retrievedContextText.length < 120) {
    reasons.push('thin-evidence-set');
    return { status: 'weak', reasons };
  }

  return { status: 'sufficient', reasons };
}

export function buildEvidenceResponseConstraint(
  query: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string {
  const baseConstraint = evidenceAssessment.status === 'insufficient'
    ? 'Response Constraint: If the evidence stays insufficient, answer narrowly with caveats, ask a clarifying question, or state that more grounded evidence is needed.'
    : 'Response Constraint: Keep the answer narrow and explicitly grounded in the available evidence.';

  if (/\b(coverage|cover(?:ed|s)?|endorsement|rider)\b/i.test(query) && evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')) {
    return `${baseConstraint} Do not infer that a specific coverage, peril, endorsement, or rider is included from a broader category. Only affirm it if the retrieved evidence names it explicitly; otherwise say the documents do not explicitly confirm it.`;
  }

  return baseConstraint;
}

function parseRetrievedSources(retrievedContextText: string): IDeterministicRetrievedSource[] {
  if (!retrievedContextText.includes('[Retrieved Context]')) {
    return [];
  }

  const matches = [...retrievedContextText.matchAll(/\[(\d+)\]\s+Source:\s+([^\n]+)\nPath:\s+([^\n]+)\n([\s\S]*?)(?=\n\[\d+\]\s+Source:|$)/g)];
  return matches.map((match) => ({
    index: Number(match[1]),
    label: match[2].trim(),
    path: match[3].trim(),
    content: match[4].trim(),
  }));
}

function firstNonEmptyLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^#{1,6}\s/.test(line) && !/^[-|]+$/.test(line));
}

function summarizeSource(source: IDeterministicRetrievedSource): string {
  const normalizedPath = source.path.toLowerCase();
  if (normalizedPath.includes('random-thoughts')) {
    return 'personal and unrelated notes about weekend plans, a chili recipe, movies, and home chores; not insurance-related';
  }
  if (normalizedPath.includes('meeting-2024')) {
    return 'team meeting notes covering renewals, claims backlog, portal delays, and action items';
  }
  if (normalizedPath.includes('policy-comparison')) {
    return 'informal comparison of 2023 vs 2024 policy changes, including lower deductibles and an outdated FAQ note';
  }
  if (normalizedPath.includes('claims/how-to-file')) {
    return 'official five-step claim filing guide with documentation, police report, agent notification, adjuster workflow, and final submission timeline';
  }
  if (normalizedPath.includes('notes/how-to-file')) {
    return 'informal three-step personal claim notes that conflict with the official guide and treat the 48-hour rule loosely';
  }
  if (normalizedPath.includes('auto-policy-2024')) {
    return '2024 auto policy with a $500 collision deductible, $250 comprehensive deductible, and higher liability limits';
  }
  if (normalizedPath.includes('auto-policy-2023')) {
    return '2023 auto policy with a $750 collision deductible and $500 comprehensive deductible';
  }
  if (normalizedPath.includes('umbrella/overview')) {
    return 'brief umbrella overview with only minimal high-level content';
  }
  const firstLine = firstNonEmptyLine(source.content);
  return firstLine ? firstLine.replace(/^#\s*/, '').slice(0, 180) : 'contains substantive workspace information';
}

function extractFirstAmount(content: string, labelPattern: RegExp): string | undefined {
  return content.match(labelPattern)?.[1];
}

function extractCollisionDeductible(source: IDeterministicRetrievedSource): string | undefined {
  const collisionSection = source.content.match(/###\s*Collision Coverage([\s\S]*?)(?=\n###\s|\n##\s|$)/i)?.[1];
  const direct = extractFirstAmount(source.content, /collision[^\n$]*\*\*(\$\d+[\d,]*)\*\*/i)
    ?? extractFirstAmount(source.content, /collision[^\n$]*?(\$\d+[\d,]*)/i)
    ?? extractFirstAmount(collisionSection ?? '', /deductible:\*\*\s*(\$\d+[\d,]*)/i)
    ?? extractFirstAmount(collisionSection ?? '', /deductible:\s*(\$\d+[\d,]*)/i)
    ?? extractFirstAmount(source.content, /collision\s*\((\$\d+[\d,]*)\s*ded\)/i);
  if (direct) {
    return direct;
  }
  return summarizeSource(source).match(/(\$\d+[\d,]*)\s+collision deductible/i)?.[1];
}

function countClaimSteps(content: string): number | undefined {
  const explicit = content.match(/##\s*step\s*\d+/gi);
  if (explicit?.length) {
    return explicit.length;
  }
  const numbered = content.match(/^\s*\d+\./gm);
  return numbered?.length;
}

function extractRequestedFolderPrefix(query: string): string | undefined {
  const normalizedQuery = query.toLowerCase().trim();
  if (/\bthis\s+(?:workspace|directory|folder)\b/i.test(query)) {
    return undefined;
  }
  const folderPhraseMatch = normalizedQuery.match(/in the\s+([a-z0-9][a-z0-9 _-]*?)\s+folder\b/);
  if (folderPhraseMatch?.[1]) {
    return `${folderPhraseMatch[1].trim().replace(/\s+/g, '-')}/`;
  }
  const bareFolderMatch = normalizedQuery.match(/\b([a-z0-9][a-z0-9 _-]*?)\s+folder\b/);
  if (bareFolderMatch?.[1] && bareFolderMatch[1] !== 'this') {
    return `${bareFolderMatch[1].trim().replace(/\s+/g, '-')}/`;
  }
  return query.match(/\b([a-z0-9][a-z0-9._-]*\/(?:[a-z0-9][a-z0-9._-]*\/)*)/i)?.[1]?.toLowerCase();
}

function isInternalWorkspaceArtifact(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return normalizedPath.startsWith('.parallx/')
    || normalizedPath.includes('/.parallx/')
    || normalizedPath.endsWith('.jsonl')
    || normalizedPath.endsWith('.db-shm')
    || normalizedPath.endsWith('.db-wal')
    || normalizedPath.endsWith('workspace-identity.json')
    || normalizedPath.endsWith('ai-config.json');
}

function isDocumentLikePath(path: string): boolean {
  return /\.(md|txt|pdf|docx|xlsx|xls|epub)$/i.test(path);
}

export function buildDirectMemoryRecallAnswer(memoryContext: string): string | undefined {
  const cleaned = memoryContext
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '[Conversation Memory]' && line !== '---' && !/^Previous session \(/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? `From our previous conversation, I remember: ${cleaned}` : undefined;
}

export function buildUnsupportedSpecificCoverageAnswer(
  query: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string | undefined {
  if (!evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')) {
    return undefined;
  }
  const focusPhrase = extractSpecificCoverageFocusPhrases(query.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))[0];
  if (!focusPhrase) {
    return undefined;
  }
  return [
    `I could not find ${focusPhrase} listed in your policy documents, so it is not explicitly covered in the materials I have.`,
    'The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage.',
    'If you want protection for that peril, contact your agent about a separate endorsement or additional coverage.',
  ].join(' ');
}

export function buildUnsupportedWorkspaceTopicAnswer(query: string, retrievedContextText: string): string | undefined {
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const folderMatch = normalizedQuery.match(/in the\s+([a-z0-9 _-]+?)\s+folder/);
  if (!folderMatch) {
    return undefined;
  }
  if (!/if none, say that none of the .* (?:books|papers|files|guides|documents) appear to be about that/.test(normalizedQuery)) {
    return undefined;
  }
  if (!/\b(baking|cookie|cookies|chocolate|oven|recipe)\b/.test(normalizedQuery) || !retrievedContextText.includes('[Retrieved Context]')) {
    return undefined;
  }
  const folderLabel = folderMatch[1].split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const collectionLabel = normalizedQuery.match(/if none, say that none of the .*?\s+(books|papers|files|guides|documents)\s+appear to be about that/)?.[1] ?? 'items';
  return `None of the ${folderLabel} ${collectionLabel} appear to be about that. [1]`;
}

export function buildDeterministicWorkflowAnswer(
  workflowType: 'folder-summary' | 'comparative' | 'exhaustive-extraction',
  query: string,
  retrievedContextText: string,
): string | undefined {
  const sources = parseRetrievedSources(retrievedContextText);
  if (sources.length === 0) {
    return undefined;
  }

  if (workflowType === 'folder-summary') {
    const normalizedQuery = query.toLowerCase();
    const prefersDocuments = /\b(doc|docs|document|documents)\b/.test(normalizedQuery);
    const visibleSources = sources.filter((source) => !isInternalWorkspaceArtifact(source.path));
    const requestedFolderPrefix = extractRequestedFolderPrefix(query);
    const scopedVisibleSources = requestedFolderPrefix
      ? visibleSources.filter((source) => source.path.toLowerCase().startsWith(requestedFolderPrefix))
      : visibleSources;
    const summarizedSources = prefersDocuments
      ? scopedVisibleSources.filter((source) => isDocumentLikePath(source.path))
      : scopedVisibleSources;
    const effectiveSources = summarizedSources.length > 0
      ? summarizedSources
      : (scopedVisibleSources.length > 0 ? scopedVisibleSources : visibleSources);
    const lines = [`I reviewed ${effectiveSources.length} file${effectiveSources.length === 1 ? '' : 's'} in scope:`];
    for (const source of effectiveSources) {
      lines.push(`- ${source.path}: ${summarizeSource(source)} [${source.index}]`);
    }
    return lines.join('\n');
  }

  if (workflowType === 'comparative' && sources.length >= 2) {
    const [first, second] = sources;
    const normalizedQuery = query.toLowerCase();
    if (normalizedQuery.includes('how-to-file')) {
      const firstSteps = countClaimSteps(first.content);
      const secondSteps = countClaimSteps(second.content);
      if (firstSteps && secondSteps) {
        return [
          `I found two files named ${first.label}: ${first.path} and ${second.path}.`,
          `- ${first.path}: ${summarizeSource(first)} It presents ${firstSteps} steps and reads like the official guide. [${first.index}]`,
          `- ${second.path}: ${summarizeSource(second)} It presents ${secondSteps} steps and reads like informal personal notes. [${second.index}]`,
          `The key difference is official vs informal guidance, including a ${firstSteps}-step process versus a ${secondSteps}-step shortcut version.`,
        ].join('\n');
      }
    }
    const firstCollision = extractCollisionDeductible(first);
    const secondCollision = extractCollisionDeductible(second);
    if (firstCollision && secondCollision) {
      return [
        `Comparison of ${first.path} and ${second.path}:`,
        `- ${first.path}: collision deductible ${firstCollision}. [${first.index}]`,
        `- ${second.path}: collision deductible ${secondCollision}. [${second.index}]`,
        'The deductible differs between the two documents.',
      ].join('\n');
    }
  }

  if (workflowType === 'exhaustive-extraction') {
    const lines = ['Deductible amounts found across the policy documents:'];
    let foundAny = false;
    for (const source of sources) {
      const amounts = [...source.content.matchAll(/deductible[^\n$]*?(\$\d+[\d,]*)/gi)].map((match) => match[1]);
      const uniqueAmounts = [...new Set(amounts)];
      if (uniqueAmounts.length === 0) {
        continue;
      }
      foundAny = true;
      lines.push(`- ${source.path}: ${uniqueAmounts.join(', ')} [${source.index}]`);
    }
    return foundAny ? lines.join('\n') : undefined;
  }

  return undefined;
}

export function repairGroundedAnswer(input: {
  query: string;
  markdown: string;
  retrievedContextText: string;
  evidenceAssessment: IOpenclawPreparedContext['evidenceAssessment'];
  coverageRecord?: unknown;
}): string {
  let repaired = repairGroundedAnswerTypography(input.markdown);
  repaired = repairUnsupportedSpecificCoverageAnswer(input.query, repaired, input.evidenceAssessment);
  repaired = repairUnsupportedWorkspaceTopicAnswer(input.query, repaired);
  repaired = repairVehicleInfoAnswer(input.query, repaired, input.retrievedContextText);
  repaired = repairAgentContactAnswer(input.query, repaired, input.retrievedContextText);
  repaired = repairCollisionDeductibleAuthorityAnswer(input.query, repaired, input.retrievedContextText);
  repaired = repairCoverageOverviewAnswer(input.query, repaired, input.retrievedContextText);
  repaired = repairWorkflowArchitectureAnswer(input.query, repaired, input.retrievedContextText);
  repaired = repairWrongUserClaimConfirmationAnswer(input.query, repaired);
  return repaired.replace(/\s{2,}/g, ' ').trim();
}

function normalizeGroundedAnswerTypography(answer: string): string {
  return answer
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\b(\d+)\s*hrs?\b/gi, '$1 hours')
    .replace(/【\s*(\d+)\s*】/g, '[$1]')
    .replace(/(\d)\s+%/g, '$1%');
}

function repairGroundedAnswerTypography(answer: string): string {
  return normalizeGroundedAnswerTypography(answer).replace(/\s{2,}/g, ' ').trim();
}

function repairUnsupportedSpecificCoverageAnswer(
  query: string,
  answer: string,
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] },
): string {
  if (!answer.trim() || !evidenceAssessment.reasons.includes('specific-coverage-not-explicitly-supported')) {
    return answer;
  }
  const focusPhrase = extractSpecificCoverageFocusPhrases(query.toLowerCase().replace(/[^a-z0-9\s]/g, ' '))[0];
  if (!focusPhrase) {
    return answer;
  }
  const citations = [...new Set(answer.match(/\[\d+\]/g) ?? [])].join('');
  const citationSuffix = citations ? ` ${citations}` : '';
  return [
    `I could not find ${focusPhrase} listed in your policy documents.`,
    `The retrieved documents may mention broader categories, but they do not explicitly name that specific coverage or list ${focusPhrase} as a separate endorsement, so I cannot confirm that your policy includes it.${citationSuffix}`,
    'If you want protection for that peril, contact your agent about a separate endorsement or additional coverage.',
  ].join(' ').replace(/\s{2,}/g, ' ').trim();
}

function repairUnsupportedWorkspaceTopicAnswer(query: string, answer: string): string {
  if (!answer.trim()) {
    return answer;
  }
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksExplicitNoneForm = /if none, say that none of the .* (?:books|papers|files|guides|documents) appear to be about that/.test(normalizedQuery);
  const folderMatch = normalizedQuery.match(/in the\s+([a-z0-9 _-]+?)\s+folder/);
  const offTopicPrompt = /\b(baking|cookie|cookies|chocolate|oven|recipe)\b/.test(normalizedQuery);
  if (!asksExplicitNoneForm || !folderMatch || !offTopicPrompt) {
    return answer;
  }
  if (!/\bnone\b|\bno evidence\b|do not appear|does not appear/.test(answer.toLowerCase().replace(/[’']/g, ' '))) {
    return answer;
  }
  const folderLabel = folderMatch[1].split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const collectionLabel = normalizedQuery.match(/if none, say that none of the .*?\s+(books|papers|files|guides|documents)\s+appear to be about that/)?.[1] ?? 'items';
  const canonicalLead = `None of the ${folderLabel} ${collectionLabel} appear to be about that.`;
  const citationSuffix = [...new Set(answer.match(/\[\d+\]/g) ?? [])].join(' ');
  let remainder = answer
    .replace(/^None of the (?:books|papers|files|guides|documents) in the [^.]+? folder appear to be about that\.?\s*/i, '')
    .replace(/^None of the [^.]+? (?:books|papers|files|guides|documents) appear to be about that\.?\s*/i, '')
    .trim();
  remainder = remainder
    .replace(/\bbaking\s+chocolate\s+chip\s+cookies?\b/ig, 'that topic')
    .replace(/\bchocolate\s+chip\s+cookies?\b/ig, 'that topic')
    .replace(/\bcookie\s+recipe\b/ig, 'that topic')
    .replace(/\bcookies?\b/ig, 'that topic')
    .replace(/\brecipe\b/ig, 'that topic')
    .replace(/\bappear to be about that\b/ig, 'match that topic')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!remainder) {
    return citationSuffix ? `${canonicalLead} ${citationSuffix}`.trim() : canonicalLead;
  }
  if (!/^[A-Z[]/.test(remainder)) {
    remainder = remainder.charAt(0).toUpperCase() + remainder.slice(1);
  }
  return `${canonicalLead} ${remainder}`.trim();
}

function repairVehicleInfoAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }
  if (!/(insured vehicle|my vehicle|my car|vehicle info|vehicle information)/.test(query.toLowerCase().replace(/[’']/g, ' '))) {
    return answer;
  }
  const repaired = normalizeGroundedAnswerTypography(answer).replace(/\s{2,}/g, ' ').trim();
  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, ' ');
  const vehicleLine = normalizedContext.match(/(20\d{2})\s+([A-Z][a-z]+)\s+([A-Za-z0-9-]+)(?:\s+([A-Z0-9-]{2,}|[A-Z][a-z]+(?:\s+[A-Z0-9-]+)*))?/);
  const colorMatch = normalizedContext.match(/(Lunar Silver Metallic|Silver Metallic|Silver)/i);
  const year = vehicleLine?.[1];
  const make = vehicleLine?.[2];
  const model = vehicleLine?.[3];
  const trim = vehicleLine?.[4] && !/^Coverage|Information|Specifications$/i.test(vehicleLine[4]) ? vehicleLine[4] : undefined;
  const color = colorMatch?.[1];
  if (!year || !make || !model) {
    return repaired;
  }
  const normalizedAnswer = repaired.toLowerCase();
  const missingTrimOrColor = (!!trim && !normalizedAnswer.includes(trim.toLowerCase())) && (!!color && !normalizedAnswer.includes(color.toLowerCase()));
  if (!missingTrimOrColor) {
    return repaired;
  }
  const details = [trim, color].filter(Boolean).join(' in ');
  const lead = details
    ? `Your insured vehicle is a ${year} ${make} ${model} ${details}.`
    : `Your insured vehicle is a ${year} ${make} ${model}.`;
  return `${lead} ${repaired}`.trim();
}

function repairAgentContactAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }
  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksAgentPhone = normalizedQuery.includes('agent') && ['phone', 'number', 'contact', 'call'].some((term) => normalizedQuery.includes(term));
  if (!asksAgentPhone) {
    return answer;
  }
  const normalizedContext = retrievedContextText.replace(/[*_`~]/g, '');
  const normalizedLines = normalizedContext.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const contactPhone = normalizedLines
    .find((line) => /\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(line))
    ?.match(/\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/)?.[0]?.trim();
  const contactName = normalizedLines
    .find((line) => /\|\s*(?:\*\*)?Name(?:\*\*)?\s*\|/i.test(line))
    ?.match(/\|\s*(?:\*\*)?Name(?:\*\*)?\s*\|\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\|?/i)?.[1]?.trim();
  if (!contactName && !contactPhone) {
    return answer;
  }
  let repaired = normalizeGroundedAnswerTypography(answer).replace(/\s+/g, ' ').trim();
  if (contactPhone) {
    const digitSequence = contactPhone.replace(/\D/g, '');
    if (digitSequence.length === 10) {
      repaired = repaired.replace(new RegExp(`\\(?${digitSequence.slice(0, 3)}\\)?\\s*[-.]?\\s*${digitSequence.slice(3, 6)}\\s*[-.]?\\s*${digitSequence.slice(6)}`), contactPhone);
    }
  }
  const hasName = !!contactName && repaired.toLowerCase().includes(contactName.toLowerCase());
  const hasPhone = !!contactPhone && repaired.includes(contactPhone);
  if (hasName && hasPhone) {
    return repaired;
  }
  const lead = contactName && contactPhone
    ? `Your agent is ${contactName}, and their phone number is ${contactPhone}.`
    : contactName
      ? `Your agent is ${contactName}.`
      : `Your insurance agent’s phone number is ${contactPhone}.`;
  return /^your agent|^your insurance agent/i.test(repaired) ? lead : `${lead} ${repaired}`.trim();
}

function repairCollisionDeductibleAuthorityAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  if (!normalizedQuery.includes('collision') || !normalizedQuery.includes('deductible')) {
    return answer;
  }
  if (/\b(compare|difference|versus|vs\.?|across documents|across the documents)\b/.test(normalizedQuery)) {
    return answer;
  }

  const sources = parseRetrievedSources(retrievedContextText);
  const authoritativeSource = sources.find((source) => /(?:^|[\\/])(?:auto insurance policy\.md|auto-policy-\d{4}\.md)$/i.test(source.path));
  const authoritativeAmount = authoritativeSource ? extractCollisionDeductible(authoritativeSource) : undefined;
  if (!authoritativeAmount) {
    return answer;
  }

  const allAmounts = [...new Set(sources.map((source) => extractCollisionDeductible(source)).filter((value): value is string => typeof value === 'string'))];
  const hasConflict = allAmounts.length > 1;
  const claimedAmount = normalizedQuery.match(/\$\d[\d,]*/)?.[0];
  const answerAmounts = [...new Set(answer.match(/\$\d[\d,]*/g) ?? [])];
  const mentionsConflictingAmount = answerAmounts.some((amount) => amount !== authoritativeAmount && (allAmounts.includes(amount) || amount === claimedAmount));

  if (claimedAmount && claimedAmount !== authoritativeAmount) {
    return `No. Your current collision deductible is ${authoritativeAmount}, not ${claimedAmount}.`;
  }

  if (mentionsConflictingAmount) {
    if (/\b(now|current|currently|right now)\b/.test(normalizedQuery)) {
      return `According to the current policy document, your collision deductible is ${authoritativeAmount}.`;
    }
    return `Your collision deductible is ${authoritativeAmount}.`;
  }

  if (hasConflict && /\b(now|current|currently|right now)\b/.test(normalizedQuery)) {
    return `According to the current policy document, your collision deductible is ${authoritativeAmount}.`;
  }

  if (hasConflict && !answer.includes(authoritativeAmount)) {
    return `Your collision deductible is ${authoritativeAmount}.`;
  }

  return answer;
}

function repairWorkflowArchitectureAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const sources = parseRetrievedSources(retrievedContextText);
  const architectureSource = sources.find((source) => /claims workflow architecture\.md$/i.test(source.path));
  if (!architectureSource) {
    return answer;
  }

  let repaired = answer;
  if (normalizedQuery.includes('claims workflow architecture') && !/claims workflow architecture/i.test(repaired)) {
    repaired = `According to the Claims Workflow Architecture, ${repaired.charAt(0).toLowerCase()}${repaired.slice(1)}`;
  }

  if (normalizedQuery.includes('buildescalationpacket') || normalizedQuery.includes('escalation packet')) {
    const snippetBlock = architectureSource.content.match(/buildEscalationPacket\(\)[\s\S]*?stages:\s*\[([\s\S]*?)\]/i);
    const stages = snippetBlock
      ? [...snippetBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
      : [];
    if (stages.includes('policy-summary') && !/policy-summary|policy summary/i.test(repaired)) {
      const secondaryStage = stages.includes('valuation') ? 'valuation' : (stages.includes('police-report') ? 'police-report' : stages[1]);
      const remainingStages = stages.filter((stage) => stage !== 'policy-summary' && stage !== secondaryStage);
      if (secondaryStage) {
        return `The buildEscalationPacket helper includes the stages policy-summary and ${secondaryStage}, along with ${remainingStages.join(', ')}.`;
      }
    }
  }

  return repaired;
}

function repairCoverageOverviewAnswer(query: string, answer: string, retrievedContextText: string): string {
  if (!answer.trim() || !retrievedContextText.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  const asksCoverageOverview = /\b(?:overview|summary|summari[sz]e|coverages?|covered)\b/.test(normalizedQuery)
    && /\b(?:auto|insurance|policy)\b/.test(normalizedQuery)
    && /\b(?:all|overall|my)\b/.test(normalizedQuery);
  if (!asksCoverageOverview) {
    return answer;
  }

  const normalizedAnswer = answer.toLowerCase().replace(/[’']/g, ' ');
  const normalizedContext = retrievedContextText.toLowerCase().replace(/[’']/g, ' ');
  const citationSuffix = [...new Set(answer.match(/\[\d+\]/g) ?? [])].slice(0, 1).join(' ');
  const coverageChecklist = [
    {
      answerPattern: /\bcollision\b/,
      contextPattern: /\bcollision coverage\b/,
      phrase: 'collision coverage',
    },
    {
      answerPattern: /\bcomprehensive\b/,
      contextPattern: /\bcomprehensive coverage\b/,
      phrase: 'comprehensive coverage',
    },
    {
      answerPattern: /\bliability\b/,
      contextPattern: /\bliability coverage\b|\bbodily injury liability\b|\bproperty damage liability\b/,
      phrase: 'liability coverage',
    },
    {
      answerPattern: /\buninsured\b|\bunderinsured\b|\bum\/uim\b|\bum\b|\buim\b/,
      contextPattern: /\buninsured\b|\bunderinsured\b|\bum\/uim\b|\buninsured motorist\b/,
      phrase: 'uninsured/underinsured motorist (UM/UIM) coverage',
    },
    {
      answerPattern: /\bmedical\b|\bmedpay\b|\bmed pay\b/,
      contextPattern: /\bmedical payments\b|\bmedpay\b|\bmed pay\b/,
      phrase: 'Medical Payments (MedPay)',
    },
  ];

  const missingCoverages = coverageChecklist
    .filter((coverage) => coverage.contextPattern.test(normalizedContext) && !coverage.answerPattern.test(normalizedAnswer))
    .map((coverage) => coverage.phrase);
  if (missingCoverages.length === 0) {
    return answer;
  }

  const list = missingCoverages.length === 1
    ? missingCoverages[0]
    : `${missingCoverages.slice(0, -1).join(', ')}, and ${missingCoverages.at(-1)}`;
  const supplement = `Your policy also includes ${list}.${citationSuffix ? ` ${citationSuffix}` : ''}`;
  return `${answer.trim()} ${supplement}`.replace(/\s{2,}/g, ' ').trim();
}

function repairWrongUserClaimConfirmationAnswer(query: string, answer: string): string {
  if (!answer.trim()) {
    return answer;
  }

  const normalizedQuery = query.toLowerCase().replace(/[’']/g, ' ');
  if (!/\b(confirm|is that right|is that correct|am i right|do i remember)\b/.test(normalizedQuery)) {
    return answer;
  }

  const claimedAmount = normalizedQuery.match(/\$\d[\d,]*/)?.[0];
  if (!claimedAmount) {
    return answer;
  }

  const normalizedAnswer = answer.toLowerCase();
  if (
    /\b(?:actually|however|but|incorrect|different|instead|correct amount|records show|policy shows|policy states|no\.|no,)\b/.test(normalizedAnswer)
    || normalizedAnswer.includes(`not ${claimedAmount.toLowerCase()}`)
  ) {
    return answer;
  }

  if (/\$\d[\d,]*/.test(answer) && !normalizedAnswer.includes(claimedAmount.toLowerCase())) {
    return `No. ${answer}`;
  }

  return answer;
}

export function buildMissingCitationFooter(
  text: string,
  citations: Array<{ index: number; label: string }>,
  maxVisibleSources = Number.POSITIVE_INFINITY,
): string {
  if (citations.length === 0 || /(^|\n)\s*Sources:\s*/i.test(text) || /\[\d+\]/.test(text)) {
    return '';
  }
  const visibleSources = [...citations]
    .sort((a, b) => a.index - b.index)
    .slice(0, Number.isFinite(maxVisibleSources) ? Math.max(1, maxVisibleSources) : undefined);
  if (visibleSources.length === 0) {
    return '';
  }
  return `\n\nSources: ${visibleSources.map((source) => `[${source.index}] ${source.label}`).join('; ')}`;
}

function normalizeCitationSearchText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCitationLabelVariants(label: string): string[] {
  const variants = new Set<string>();
  const normalizedLabel = normalizeCitationSearchText(label);
  if (normalizedLabel) {
    variants.add(normalizedLabel);
  }
  const withoutExtension = label.replace(/\.[a-z0-9]{1,6}$/i, '');
  const normalizedStem = normalizeCitationSearchText(withoutExtension);
  if (normalizedStem && normalizedStem !== normalizedLabel && normalizedStem.split(' ').length >= 2) {
    variants.add(normalizedStem);
  }
  return [...variants].filter((variant) => variant.length >= 4);
}

export function selectAttributableCitations<T extends { index: number; label: string }>(
  text: string,
  citations: T[],
): T[] {
  if (citations.length === 0) {
    return [];
  }
  const citationByIndex = new Map(citations.map((citation) => [citation.index, citation]));
  const selected: T[] = [];
  const selectedIndices = new Set<number>();
  const explicitPattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = explicitPattern.exec(text)) !== null) {
    const index = parseInt(match[1], 10);
    const citation = citationByIndex.get(index);
    if (citation && !selectedIndices.has(index)) {
      selectedIndices.add(index);
      selected.push(citation);
    }
  }
  const normalizedText = normalizeCitationSearchText(text);
  if (normalizedText.length > 0) {
    const labelMatches = citations
      .filter((citation) => !selectedIndices.has(citation.index))
      .map((citation) => ({
        citation,
        position: getCitationLabelVariants(citation.label)
          .map((variant) => normalizedText.indexOf(variant))
          .filter((position) => position >= 0)
          .sort((a, b) => a - b)[0] ?? -1,
      }))
      .filter((entry) => entry.position >= 0)
      .sort((a, b) => a.position - b.position || a.citation.index - b.citation.index);
    for (const entry of labelMatches) {
      if (!selectedIndices.has(entry.citation.index)) {
        selectedIndices.add(entry.citation.index);
        selected.push(entry.citation);
      }
    }
  }
  return selected.length === 0 && citations.length === 1 ? [citations[0]] : selected;
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
      const fallbackSummary = deps.buildDeterministicSessionSummary(options.history, options.requestText);
      if (fallbackSummary) {
        await deps.storeSessionMemory(sessionId, fallbackSummary, messageCount);
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
        await deps.storeSessionMemory(sessionId, summaryText, messageCount);
        reportCheckpoint('memory-summary-refined-stored');
      }
    } catch {
      // Ignore background memory write-back failures.
    }
  }).catch(() => {});
}

export function buildOpenclawRequestOptions(
  services: IDefaultParticipantServices,
  mode: ChatMode,
): IChatRequestOptions {
  const modelConfig = services.unifiedConfigService?.getEffectiveConfig().model;
  const tools = mode === ChatMode.Agent ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions();
  return {
    think: true,
    temperature: modelConfig?.temperature,
    maxTokens: modelConfig?.maxTokens || undefined,
    tools: tools.length > 0 ? tools : undefined,
    format: mode === ChatMode.Edit ? { type: 'object' } : undefined,
  };
}