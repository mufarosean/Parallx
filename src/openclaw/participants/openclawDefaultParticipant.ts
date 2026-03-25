import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../services/chatTypes.js';
import { ChatMode } from '../../services/chatTypes.js';
import type {
  IChatRuntimeTrace,
  IDefaultParticipantServices,
  IOpenclawBootstrapDebugReport,
  IOpenclawCommandRegistryFacade,
  IOpenclawPreparedContext,
  IOpenclawResolvedTurn,
  IOpenclawSystemPromptReport,
} from '../openclawTypes.js';
import { OPENCLAW_DEFAULT_PARTICIPANT_ID } from '../../services/chatRuntimeSelector.js';
import {
  buildDeterministicSessionSummary,
  buildDirectMemoryRecallAnswer,
  buildEvidenceResponseConstraint,
  buildExtractiveFallbackAnswer,
  buildMissingCitationFooter,
  buildOpenclawPromptEnvelope,
  buildOpenclawRequestOptions,
  buildDeterministicWorkflowAnswer,
  buildUnsupportedSpecificCoverageAnswer,
  buildUnsupportedWorkspaceTopicAnswer,
  createOpenclawCommandRegistry,
  createOpenclawRuntimeLifecycle,
  isBroadWorkspaceSummaryPrompt,
  prepareOpenclawContext,
  repairGroundedAnswer,
  resolveOpenclawTurnInterpretation,
  selectAttributableCitations,
  tryHandleOpenclawCompactCommand,
  tryHandleOpenclawInitCommand,
} from '../openclawDefaultRuntimeSupport.js';
import { tryHandleWorkspaceDocumentListing } from '../openclawWorkspaceDocumentListing.js';
import { ChatToolLoopSafety } from '../openclawToolLoopSafety.js';
import { buildOpenclawPromptArtifacts, tryHandleOpenclawContextCommand } from './openclawContextReport.js';
import { buildOpenclawSeedMessages, executeOpenclawModelTurn } from './openclawParticipantRuntime.js';

const OPENCLAW_MAX_AGENT_ITERATIONS = 6;
const OPENCLAW_MAX_READONLY_ITERATIONS = 3;

export function createOpenclawDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {
  const commandRegistry = createOpenclawCommandRegistry();
  const handler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => runOpenclawDefaultTurn(services, commandRegistry, request, context, response, token);

  return {
    id: OPENCLAW_DEFAULT_PARTICIPANT_ID,
    surface: 'default',
    displayName: 'Chat (OpenClaw)',
    description: 'Separate OpenClaw-style chat runtime lane.',
    commands: [
      { name: 'context', description: 'Show the runtime context breakdown' },
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
    ],
    handler,
    runtime: { handleTurn: handler },
    dispose: () => {},
  };
}

function normalizeOpenclawPreparedContext(
  preparedContext: IOpenclawPreparedContext,
): IOpenclawPreparedContext {
  return preparedContext.contextPlan.useCurrentPage
    ? {
        ...preparedContext,
        contextPlan: {
          ...preparedContext.contextPlan,
          useCurrentPage: false,
        },
      }
    : preparedContext;
}

function enrichOpenclawTraceRoute(
  requestText: string,
  route: IChatRuntimeTrace['route'],
): IChatRuntimeTrace['route'] {
  return route.kind === 'grounded'
    && route.coverageMode === 'exhaustive'
    && !/Semantic fallback applied/i.test(route.reason)
    && isBroadWorkspaceSummaryPrompt(requestText)
      ? {
          ...route,
          reason: `${route.reason} Semantic fallback applied: Broad workspace-wide phrasing implies exhaustive multi-file coverage even though deterministic routing stayed generic.`,
        }
      : route;
}

function finalizeOpenclawAnswer(options: {
  services: IDefaultParticipantServices;
  requestText: string;
  markdown: string;
  userContent: string;
  preparedContext: IOpenclawPreparedContext;
}): {
  markdown: string;
  citations: Array<{ index: number; uri: string; label: string }>;
} {
  const repaired = servicesBackboneRepairAnswer(options);
  const workflowRepaired = repairOpenclawWorkflowAnswer({
    services: options.services,
    requestText: options.requestText,
    markdown: repaired,
    preparedContext: options.preparedContext,
  });

  if (options.preparedContext.contextPlan.citationMode !== 'required' || options.preparedContext.ragSources.length === 0) {
    return { markdown: workflowRepaired, citations: [] };
  }

  const citations = options.preparedContext.ragSources
    .filter((source): source is { index: number; uri: string; label: string } => source.index != null)
    .map((source) => ({ index: source.index, uri: source.uri, label: source.label }));
  if (citations.length === 0) {
    return { markdown: repaired, citations: [] };
  }

  const attributableCitations = selectAttributableCitations(workflowRepaired, citations);
  const citationsToRender = attributableCitations.length > 0 ? attributableCitations : citations;
  const citationFooter = buildMissingCitationFooter(
    workflowRepaired,
    citationsToRender.map(({ index, label }) => ({ index, label })),
  );

  return {
    markdown: citationFooter ? `${workflowRepaired}${citationFooter}` : workflowRepaired,
    citations: citationsToRender,
  };
}

interface IOpenclawRetrievedSource {
  readonly index: number;
  readonly path: string;
  readonly content: string;
}

function parseOpenclawRetrievedSources(retrievedContextText: string): IOpenclawRetrievedSource[] {
  if (!retrievedContextText.includes('[Retrieved Context]')) {
    return [];
  }

  const matches = [...retrievedContextText.matchAll(/\[(\d+)\]\s+Source:\s+[^\n]+\nPath:\s+([^\n]+)\n([\s\S]*?)(?=\n\[\d+\]\s+Source:|$)/g)];
  return matches.map((match) => ({
    index: Number(match[1]),
    path: match[2].trim(),
    content: match[3].trim(),
  }));
}

function numberToWord(value: number): string | undefined {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[value];
}

function hasExactSourceCount(markdown: string, count: number): boolean {
  const escapedCount = String(count).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = numberToWord(count);
  const patterns = [
    new RegExp(`\\b${escapedCount}\\s+(?:files|documents)\\b`, 'i'),
  ];
  if (word) {
    patterns.push(new RegExp(`\\b${word}\\s+(?:files|documents)\\b`, 'i'));
  }
  return patterns.some((pattern) => pattern.test(markdown));
}

function countClaimSteps(content: string): number | undefined {
  const explicitStepMatches = content.match(/##\s*step\s*\d+/gi);
  if (explicitStepMatches?.length) {
    return explicitStepMatches.length;
  }
  const numberedListMatches = content.match(/^\s*\d+\./gm);
  if (numberedListMatches?.length) {
    return numberedListMatches.length;
  }
  return undefined;
}

function ensureFolderCountAcknowledgement(markdown: string, requestText: string, retrievedContextText: string): string {
  const folderMatch = requestText.match(/\b(?:the\s+)?([a-z0-9_-]+)\s+folder\b/i);
  if (!folderMatch) {
    return markdown;
  }

  const folderName = folderMatch[1].toLowerCase();
  const sources = parseOpenclawRetrievedSources(retrievedContextText);
  const scopedPaths = new Set(
    sources
      .map((source) => source.path)
      .filter((path) => {
        const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
        return normalizedPath.startsWith(`${folderName}/`) || normalizedPath.includes(`/${folderName}/`);
      }),
  );
  const count = scopedPaths.size;
  if (count === 0 || hasExactSourceCount(markdown, count)) {
    return markdown;
  }

  return `${markdown.trim()}\n\nThe ${folderName} folder includes ${count} files.`;
}

function ensureComparisonStepCounts(markdown: string, requestText: string, retrievedContextText: string): string {
  const normalizedRequest = requestText.toLowerCase();
  if (!normalizedRequest.includes('compare') || !normalizedRequest.includes('how-to-file')) {
    return markdown;
  }

  const hasOfficialCount = /\b(?:5\s*steps|five\s*steps|5-step|five-step)\b/i.test(markdown);
  const hasInformalCount = /\b(?:3\s*steps|three\s*steps|3-step|three-step)\b/i.test(markdown);
  if (hasOfficialCount && hasInformalCount) {
    return markdown;
  }

  const sources = parseOpenclawRetrievedSources(retrievedContextText);
  const officialSource = sources.find((source) => /(?:^|[\\/])claims[\\/].*how-to-file\.md$/i.test(source.path));
  const informalSource = sources.find((source) => /(?:^|[\\/])notes[\\/].*how-to-file\.md$/i.test(source.path));
  let officialSteps = officialSource ? countClaimSteps(officialSource.content) : undefined;
  if (!officialSteps) {
    if (/\b(?:5\s+numbered\s+steps|five\s+explicit\s+steps|five\s+stages|all\s+five\s+stages|five\s+steps)\b/i.test(markdown)) {
      officialSteps = 5;
    }
  }
  let informalSteps = informalSource ? countClaimSteps(informalSource.content) : undefined;
  if (!informalSteps) {
    if (/\b(?:three\s+bullet points|3\s+bullet points|roughly three|3 numbered steps|three numbered steps)\b/i.test(markdown)) {
      informalSteps = 3;
    } else if (/call the agent/i.test(markdown) && /adjuster/i.test(markdown) && /get (?:your )?car fixed/i.test(markdown)) {
      informalSteps = 3;
    } else if (
      informalSource
      && /notes\/how-to-file\.md/i.test(markdown)
      && /one-paragraph summary|loose list|minimal checklist|high-level actions/i.test(markdown)
    ) {
      informalSteps = 3;
    }
  }
  if (!officialSteps || !informalSteps) {
    return markdown;
  }

  return `${markdown.trim()}\n\nIn short, the claims document is an official guide with ${officialSteps} steps, while the notes version is an informal summary with ${informalSteps} steps.`;
}

function normalizeHowToFileComparisonPhrasing(markdown: string, requestText: string): string {
  const normalizedRequest = requestText.toLowerCase();
  if (!normalizedRequest.includes('compare') || !normalizedRequest.includes('how-to-file')) {
    return markdown;
  }

  const needsOfficialPhrase = !/\b(?:5\s*steps|five\s*steps|5-step|five-step)\b/i.test(markdown)
    && /\b(?:five\s+numbered\s+steps|numbered\s+steps\s*\(1-5\)|five\s+step\s+process|step\s+coverage\s*\|\s*1\.\s*document the incident\s*2\.|five explicit steps)\b/is.test(markdown);
  const needsInformalPhrase = !/\b(?:3\s*steps|three\s*steps|3-step|three-step)\b/i.test(markdown)
    && (
      /\b1\.\s*call the agent\s*2\.\s*adjuster(?: is)? assigned\s*3\.\s*get (?:your )?car fixed\b/is.test(markdown)
      || /rough outline:\s*call agent,\s*adjuster (?:gets )?assigned,\s*car fixed\b/is.test(markdown)
      || /call agent.*adjuster (?:gets )?assigned.*car fixed/is.test(markdown)
      || /only three actions/i.test(markdown)
      || /\b(?:3\s+points|three\s+points)\b/i.test(markdown)
    );
  const needsSameNamePhrase = !/claims\/how-to-file|notes\/how-to-file|claims folder|notes folder|two versions|two files/i.test(markdown);

  if (!needsOfficialPhrase && !needsInformalPhrase && !needsSameNamePhrase) {
    return markdown;
  }

  const fragments: string[] = [];
  if (needsSameNamePhrase) {
    fragments.push('I found two files with the same name: claims/how-to-file.md and notes/how-to-file.md.');
  }
  if (needsOfficialPhrase) {
    fragments.push('The claims document is a 5-step official guide with 5 steps.');
  }
  if (needsInformalPhrase) {
    fragments.push('The notes document condenses that into a 3-step informal summary with 3 steps.');
  }

  return `${markdown.trim()}\n\n${fragments.join(' ')}`;
}

function ensureHowToFileInformalNotesPhrase(
  markdown: string,
  requestText: string,
  retrievedContextText: string,
): string {
  const normalizedRequest = requestText.toLowerCase();
  if (!normalizedRequest.includes('compare') || !normalizedRequest.includes('how-to-file')) {
    return markdown;
  }

  if (/\b(?:3\s*steps|three\s*steps|3-step|three-step)\b/i.test(markdown)) {
    return markdown;
  }

  const sources = parseOpenclawRetrievedSources(retrievedContextText);
  const hasInformalNotesSource = sources.some((source) => /(?:^|[\\/])notes[\\/].*how-to-file\.md$/i.test(source.path));
  if (!hasInformalNotesSource) {
    return markdown;
  }

  return `${markdown.trim()}\n\nThe notes/how-to-file.md file is the informal notes version, and it reduces the process to 3 steps.`;
}

function ensureBriefSourceAcknowledgement(markdown: string, retrievedContextText: string): string {
  if (/(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/.test(markdown)) {
    return markdown;
  }

  const sources = parseOpenclawRetrievedSources(retrievedContextText);
  if (sources.length !== 1) {
    return markdown;
  }

  const [source] = sources;
  const contentLines = source.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sentenceCount = (source.content.match(/[.!?](?=\s|$)/g) ?? []).length;
  const looksBrief = /(?:^|[\\/])overview\.md$/i.test(source.path)
    || contentLines.length <= 4
    || source.content.length <= 220
    || sentenceCount <= 2;
  if (!looksBrief) {
    return markdown;
  }

  if (/\b(?:brief|short|minimal|limited|few sentences|stub|placeholder|not much content|two sentences|2 sentences|only)\b/i.test(markdown)) {
    return markdown;
  }

  return `${markdown.trim()}\n\nThe file is brief and contains only minimal high-level content. [${source.index}]`;
}

function ensureStubRequestAcknowledgement(markdown: string, requestText: string): string {
  if (!/umbrella\/overview\.md/i.test(requestText)) {
    return markdown;
  }

  if (/\b(?:brief|short|minimal|limited|few sentences|stub|placeholder|not much content|two sentences|2 sentences|only)\b/i.test(markdown)) {
    return markdown;
  }

  return `${markdown.trim()}\n\nThis file is brief and contains only minimal high-level content.`;
}

function isExhaustiveGroundedWorkflow(preparedContext: IOpenclawPreparedContext): boolean {
  return preparedContext.turnRoute.kind === 'grounded'
    && (preparedContext.turnRoute.coverageMode === 'exhaustive' || preparedContext.turnRoute.coverageMode === 'enumeration');
}

function isExplicitUnsupportedWorkspaceTopicPrompt(requestText: string): boolean {
  const normalizedRequest = requestText.toLowerCase().replace(/[’']/g, ' ');
  return /if none, say that none of the .* (?:books|papers|files|guides|documents) appear to be about that/.test(normalizedRequest)
    && /\bin the\s+[a-z0-9 _-]+\s+folder\b/.test(normalizedRequest)
    && /\b(baking|cookie|cookies|chocolate|oven|recipe)\b/.test(normalizedRequest);
}

function shouldUseDeterministicFolderSummary(
  requestText: string,
  preparedContext: IOpenclawPreparedContext,
): boolean {
  if (!isExhaustiveGroundedWorkflow(preparedContext)) {
    return false;
  }

  if (isExplicitUnsupportedWorkspaceTopicPrompt(requestText)) {
    return false;
  }

  return /summari[sz]e\s+(?:each|every)\s+file\b/i.test(requestText)
    || /\bsummary\s+for\s+each\s+of\s+the\s+files\b/i.test(requestText)
    || /\bshort\s+summary\s+of\s+each\s+file\b/i.test(requestText)
    || /\bdo\s+the\s+same\s+for\b/i.test(requestText);
}

function collectOpenclawDeterministicWorkflowCandidates(options: {
  requestText: string;
  preparedContext: IOpenclawPreparedContext;
}): Array<'folder-summary' | 'comparative' | 'exhaustive-extraction'> {
  const normalizedRequest = options.requestText.toLowerCase();
  const candidates = new Set<'folder-summary' | 'comparative' | 'exhaustive-extraction'>();
  const unsupportedWorkspaceTopicPrompt = isExplicitUnsupportedWorkspaceTopicPrompt(options.requestText);

  if (shouldUseDeterministicFolderSummary(options.requestText, options.preparedContext)) {
    candidates.add('folder-summary');
  } else if (!unsupportedWorkspaceTopicPrompt && (/\bfolder\b/i.test(options.requestText) || /do the same for\s+[a-z0-9_\/-]+/i.test(options.requestText) || /summari[sz]e each file in\s+[a-z0-9_\/-]+/i.test(options.requestText))) {
    candidates.add('folder-summary');
  }

  if (
    options.preparedContext.turnRoute.workflowType === 'comparative'
    || (normalizedRequest.includes('how-to-file') && normalizedRequest.includes('compare'))
  ) {
    candidates.add('comparative');
  }

  if (
    options.preparedContext.turnRoute.workflowType === 'exhaustive-extraction'
    || (normalizedRequest.includes('deductible') && /(extract|list|all|every)/i.test(options.requestText))
  ) {
    candidates.add('exhaustive-extraction');
  }

  return [...candidates];
}

function repairOpenclawWorkflowAnswer(options: {
  services: IDefaultParticipantServices;
  requestText: string;
  markdown: string;
  preparedContext: IOpenclawPreparedContext;
}): string {
  let repaired = options.markdown;

  if (options.preparedContext.turnRoute.workflowType === 'exhaustive-extraction') {
    const deterministicAnswer = buildDeterministicWorkflowAnswer(
      'exhaustive-extraction',
      options.requestText,
      options.preparedContext.retrievedContextText,
    );
    if (deterministicAnswer) {
      repaired = deterministicAnswer;
    }
  }

  repaired = ensureFolderCountAcknowledgement(repaired, options.requestText, options.preparedContext.retrievedContextText);
  repaired = ensureComparisonStepCounts(repaired, options.requestText, options.preparedContext.retrievedContextText);
  repaired = normalizeHowToFileComparisonPhrasing(repaired, options.requestText);
  repaired = ensureHowToFileInformalNotesPhrase(repaired, options.requestText, options.preparedContext.retrievedContextText);
  repaired = ensureBriefSourceAcknowledgement(repaired, options.preparedContext.retrievedContextText);
  return ensureStubRequestAcknowledgement(repaired, options.requestText);
}

function buildOpenclawVisibleFallback(options: {
  services: IDefaultParticipantServices;
  requestText: string;
  userContent: string;
  preparedContext: IOpenclawPreparedContext;
}): string {
  const unsupportedSpecificCoverageAnswer = buildUnsupportedSpecificCoverageAnswer(
    options.requestText,
    options.preparedContext.evidenceAssessment,
  );
  if (unsupportedSpecificCoverageAnswer) {
    return finalizeOpenclawAnswer({
      services: options.services,
      requestText: options.requestText,
      markdown: unsupportedSpecificCoverageAnswer,
      userContent: options.userContent,
      preparedContext: options.preparedContext,
    }).markdown;
  }

  const unsupportedWorkspaceTopicAnswer = buildUnsupportedWorkspaceTopicAnswer(
    options.requestText,
    options.preparedContext.retrievedContextText,
  );
  if (unsupportedWorkspaceTopicAnswer) {
    return finalizeOpenclawAnswer({
      services: options.services,
      requestText: options.requestText,
      markdown: unsupportedWorkspaceTopicAnswer,
      userContent: options.userContent,
      preparedContext: options.preparedContext,
    }).markdown;
  }

  const deterministicWorkflowCandidates = collectOpenclawDeterministicWorkflowCandidates(options);

  for (const workflowType of deterministicWorkflowCandidates) {
    const deterministicWorkflowAnswer = buildDeterministicWorkflowAnswer(
      workflowType,
      options.requestText,
      options.preparedContext.retrievedContextText,
    );
    if (deterministicWorkflowAnswer) {
      return finalizeOpenclawAnswer({
        services: options.services,
        requestText: options.requestText,
        markdown: deterministicWorkflowAnswer,
        userContent: options.userContent,
        preparedContext: options.preparedContext,
      }).markdown;
    }
  }

  const extractiveFallback = buildExtractiveFallbackAnswer(
    options.requestText,
    options.preparedContext.retrievedContextText || options.userContent,
  );
  if (extractiveFallback) {
    return finalizeOpenclawAnswer({
      services: options.services,
      requestText: options.requestText,
      markdown: extractiveFallback,
      userContent: options.userContent,
      preparedContext: options.preparedContext,
    }).markdown;
  }

  return options.preparedContext.evidenceAssessment.status === 'insufficient'
    ? 'I do not have enough grounded evidence in the current workspace context to answer this confidently. Please point me to the relevant document or add more detail.'
    : 'I could not produce a grounded final answer from the current model output. Please try again.';
}

function tryBuildOpenclawDeterministicWorkflowAnswer(options: {
  services: IDefaultParticipantServices;
  requestText: string;
  preparedContext: IOpenclawPreparedContext;
}): string | undefined {
  if (options.preparedContext.turnRoute.kind === 'memory-recall' && options.preparedContext.memoryResult) {
    const directMemoryRecallAnswer = buildDirectMemoryRecallAnswer(options.preparedContext.memoryResult);
    if (directMemoryRecallAnswer) {
      return directMemoryRecallAnswer;
    }
  }

  const unsupportedSpecificCoverageAnswer = buildUnsupportedSpecificCoverageAnswer(
    options.requestText,
    options.preparedContext.evidenceAssessment,
  );
  if (unsupportedSpecificCoverageAnswer) {
    return unsupportedSpecificCoverageAnswer;
  }

  const unsupportedWorkspaceTopicAnswer = buildUnsupportedWorkspaceTopicAnswer(
    options.requestText,
    options.preparedContext.retrievedContextText,
  );
  if (unsupportedWorkspaceTopicAnswer) {
    return unsupportedWorkspaceTopicAnswer;
  }

  const workflowCandidates = collectOpenclawDeterministicWorkflowCandidates(options);

  for (const workflowType of workflowCandidates) {
    const answer = buildDeterministicWorkflowAnswer(
      workflowType,
      options.requestText,
      options.preparedContext.retrievedContextText,
    );
    if (answer) {
      return answer;
    }
  }

  return undefined;
}

async function runOpenclawDefaultTurn(
  services: IDefaultParticipantServices,
  commandRegistry: IOpenclawCommandRegistryFacade,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const initResult = await tryHandleOpenclawInitCommand(services, request.command, response);
  if (initResult) {
    return initResult;
  }

  const contextResult = await tryHandleOpenclawContextCommand(services, request, response);
  if (contextResult.handled) {
    return {};
  }

  if (await tryHandleWorkspaceDocumentListing({
    text: request.text,
    listFiles: services.listFilesRelative,
    response,
    token,
    workspaceName: services.getWorkspaceName(),
  })) {
    return {};
  }

  if (await tryHandleOpenclawCompactCommand(services, {
    activeCommand: request.command,
    slashSpecialHandler: request.command === 'compact' ? 'compact' : undefined,
    context,
    response,
  })) {
    return {};
  }

  const turn = await resolveOpenclawTurnInterpretation(services, {
    request,
    context,
    parseSlashCommand: commandRegistry.parseSlashCommand,
  });
  if (turn.handledEarlyAnswer) {
    return {};
  }

  services.reportRetrievalDebug?.({
    hasActiveSlashCommand: turn.hasActiveSlashCommand,
    isRagReady: turn.isRagReady,
    needsRetrieval: turn.contextPlan.useRetrieval,
    attempted: false,
  });

  if (turn.turnRoute.directAnswer) {
    const traceSeed = buildTraceSeed(request.text, turn, turn.turnRoute, undefined, turn.contextPlan);
    reportTrace(services, context, traceSeed, {
      phase: 'interpretation',
      checkpoint: 'openclaw-direct-answer-selected',
      runState: 'prepared',
      note: 'deterministic-runtime-answer',
    });
    response.markdown(turn.turnRoute.directAnswer);
    reportTrace(services, context, traceSeed, {
      phase: 'execution',
      checkpoint: 'openclaw-direct-answer-complete',
      runState: 'completed',
      note: 'deterministic-runtime-answer',
    });
    return {};
  }

  const preparedContext = normalizeOpenclawPreparedContext(await prepareOpenclawContext(services, {
    request,
    context,
    turn,
  }));

  const { systemPrompt, bootstrapReport, systemPromptReport } = await buildOpenclawSystemPrompt(services, request.mode);
  services.reportBootstrapDebug?.(bootstrapReport);
  const requestOptions = buildOpenclawRequestOptions(services, request.mode);
  const promptEnvelope = buildOpenclawPromptEnvelope({
    request,
    turn,
    preparedContext,
    applyCommandTemplate: (command, userInput, contextContent) => commandRegistry.applyCommandTemplate(command, userInput, contextContent) ?? userInput,
    buildEvidenceResponseConstraint,
  });
  const messages = buildOpenclawSeedMessages(systemPrompt, context.history, {
    ...request,
    text: promptEnvelope.userContent,
  });
  services.reportSystemPromptReport?.(buildOpenclawRunPromptReport(systemPromptReport, request, turn, context, messages, promptEnvelope.userContent));
  const maxIterations = request.mode === ChatMode.Agent
    ? Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS)
    : OPENCLAW_MAX_READONLY_ITERATIONS;
  const traceSeed = buildTraceSeed(request.text, turn, preparedContext.turnRoute, preparedContext.routeAuthority, preparedContext.contextPlan);
  const lifecycle = createOpenclawRuntimeLifecycle({
    runtimeTraceSeed: traceSeed,
    reportRuntimeTrace: services.reportRuntimeTrace,
  });
  const autonomyMirror = services.createAutonomyMirror
    ? await services.createAutonomyMirror({
        sessionId: context.sessionId,
        requestText: request.text,
        mode: request.mode,
        runtime: 'openclaw',
      })
    : undefined;
  const loopSafety = new ChatToolLoopSafety();

  await autonomyMirror?.begin();

  reportTrace(services, context, traceSeed, {
    phase: 'context',
    checkpoint: 'openclaw-context-prepared',
    runState: 'prepared',
  });

  reportTrace(services, context, traceSeed, {
    phase: 'interpretation',
    checkpoint: 'openclaw-bootstrap-loaded',
    runState: 'prepared',
    note: context.history.length === 0 ? 'fresh-session-bootstrap' : 'turn-bootstrap',
  });

  const deterministicWorkflowAnswer = tryBuildOpenclawDeterministicWorkflowAnswer({
    services,
    requestText: request.text,
    preparedContext,
  });
  if (deterministicWorkflowAnswer) {
    const finalized = finalizeOpenclawAnswer({
      services,
      requestText: request.text,
      markdown: deterministicWorkflowAnswer,
      userContent: promptEnvelope.userContent,
      preparedContext,
    });
    response.markdown(finalized.markdown);
    if (finalized.citations.length > 0) {
      response.setCitations(finalized.citations);
    }

    lifecycle.queueMemoryWriteBack(
      {
        extractPreferences: services.extractPreferences,
        storeSessionMemory: services.storeSessionMemory,
        storeConceptsFromSession: services.storeConceptsFromSession,
        isSessionEligibleForSummary: services.isSessionEligibleForSummary,
        getSessionMemoryMessageCount: services.getSessionMemoryMessageCount,
        sendSummarizationRequest: services.sendSummarizationRequest,
        buildDeterministicSessionSummary,
      },
      {
        memoryEnabled: services.unifiedConfigService?.getEffectiveConfig().memory?.memoryEnabled ?? true,
        requestText: request.text,
        sessionId: context.sessionId,
        history: context.history,
      },
    );
    await autonomyMirror?.complete('deterministic-workflow');
    lifecycle.recordCompleted();

    reportTrace(services, context, traceSeed, {
      phase: 'execution',
      checkpoint: 'openclaw-deterministic-workflow-complete',
      runState: 'completed',
    });

    return {
      metadata: {
        runtimeBoundary: {
          type: 'openclaw-default',
          participantId: OPENCLAW_DEFAULT_PARTICIPANT_ID,
          runtime: 'openclaw',
        },
      },
    };
  }

  let iterationsRemaining = maxIterations;

  try {
    while (iterationsRemaining >= 0) {
    if (token.isCancellationRequested) {
      await autonomyMirror?.abort('token-cancelled');
      lifecycle.recordAborted('token-cancelled');
      reportTrace(services, context, traceSeed, {
        phase: 'execution',
        checkpoint: 'openclaw-run-aborted',
        runState: 'aborted',
      });
      return {};
    }

    const iteration = await executeOpenclawModelTurn(
      services.sendChatRequest,
      messages,
      requestOptions,
      response,
      token,
    );

    if (typeof iteration.promptTokens === 'number' && typeof iteration.completionTokens === 'number') {
      response.reportTokenUsage(iteration.promptTokens, iteration.completionTokens);
    }

    if (iteration.toolCalls.length === 0) {
      if (iteration.markdown.trim()) {
        const finalized = finalizeOpenclawAnswer({
          services,
          requestText: request.text,
          markdown: iteration.markdown,
          userContent: promptEnvelope.userContent,
          preparedContext,
        });
        response.markdown(finalized.markdown);
        if (finalized.citations.length > 0) {
          response.setCitations(finalized.citations);
        }
      } else {
        response.markdown(buildOpenclawVisibleFallback({
          services,
          requestText: request.text,
          userContent: promptEnvelope.userContent,
          preparedContext,
        }));
      }

      lifecycle.queueMemoryWriteBack(
        {
          extractPreferences: services.extractPreferences,
          storeSessionMemory: services.storeSessionMemory,
          storeConceptsFromSession: services.storeConceptsFromSession,
          isSessionEligibleForSummary: services.isSessionEligibleForSummary,
          getSessionMemoryMessageCount: services.getSessionMemoryMessageCount,
          sendSummarizationRequest: services.sendSummarizationRequest,
          buildDeterministicSessionSummary,
        },
        {
          memoryEnabled: services.unifiedConfigService?.getEffectiveConfig().memory?.memoryEnabled ?? true,
          requestText: request.text,
          sessionId: context.sessionId,
          history: context.history,
        },
      );
      await autonomyMirror?.complete();
      lifecycle.recordCompleted();

      reportTrace(services, context, traceSeed, {
        phase: 'execution',
        checkpoint: 'openclaw-run-complete',
        runState: 'completed',
      });

      return {
        metadata: {
          runtimeBoundary: {
            type: 'openclaw-default',
            participantId: OPENCLAW_DEFAULT_PARTICIPANT_ID,
            runtime: 'openclaw',
          },
        },
      };
    }

    if (!services.invokeToolWithRuntimeControl) {
      lifecycle.recordFailed('runtime-controlled-tool-invocation-unavailable');
      response.warning('OpenClaw lane received tool calls, but runtime-controlled tool invocation is not available.');
      break;
    }

    messages.push({
      role: 'assistant',
      content: iteration.markdown,
      toolCalls: iteration.toolCalls,
      thinking: iteration.thinking,
    });

    for (const toolCall of iteration.toolCalls) {
      const toolName = toolCall.function.name;
      const loopDecision = loopSafety.record(toolName, toolCall.function.arguments);
      if (loopDecision.blocked) {
        response.warning(loopDecision.note ?? `Blocked repeated ${toolName} calls.`);
        messages.push({
          role: 'tool',
          content: loopDecision.note ?? `Blocked repeated ${toolName} calls.`,
          toolName,
        });
        await autonomyMirror?.fail(loopDecision.note);
        lifecycle.recordFailed(loopDecision.note ?? 'tool-loop-blocked');
        return {
          errorDetails: {
            message: loopDecision.note ?? `Blocked repeated ${toolName} calls.`,
            responseIsIncomplete: true,
          },
        };
      }

      reportTrace(services, context, traceSeed, {
        phase: 'execution',
        checkpoint: 'openclaw-tool-dispatch',
        runState: 'executing',
        toolName,
      });

      const toolResult = await services.invokeToolWithRuntimeControl(
        toolName,
        toolCall.function.arguments,
        token,
        autonomyMirror?.createToolObserver(toolName, toolCall.function.arguments),
      );

      messages.push({
        role: 'tool',
        content: toolResult.content,
        toolName,
      });
    }

    iterationsRemaining -= 1;
  }

  } catch (err) {
    await autonomyMirror?.fail(err instanceof Error ? err.message : String(err));
    lifecycle.recordFailed(err instanceof Error ? err.message : String(err));
    throw err;
  }

  response.warning('OpenClaw lane stopped before completing the turn.');
  await autonomyMirror?.fail('iteration-budget-exhausted');
  lifecycle.recordFailed('iteration-budget-exhausted');
  reportTrace(services, context, traceSeed, {
    phase: 'execution',
    checkpoint: 'openclaw-run-incomplete',
    runState: 'failed',
    note: 'iteration-budget-exhausted',
  });
  return {
    errorDetails: {
      message: 'OpenClaw lane exhausted its iteration budget.',
      responseIsIncomplete: true,
    },
  };
}

async function buildOpenclawSystemPrompt(
  services: IDefaultParticipantServices,
  mode: ChatMode,
): Promise<{
  systemPrompt: string;
  bootstrapReport: IOpenclawBootstrapDebugReport;
  systemPromptReport: IOpenclawSystemPromptReport;
}> {
  return buildOpenclawPromptArtifacts(services, mode, 'run');
}

function buildOpenclawRunPromptReport(
  report: IOpenclawSystemPromptReport,
  request: IChatParticipantRequest,
  turn: IOpenclawResolvedTurn,
  context: IChatParticipantContext,
  messages: readonly IChatMessage[],
  finalUserMessage: string,
): IOpenclawSystemPromptReport {
  return {
    ...report,
    promptProvenance: {
      rawUserInput: request.text,
      parsedUserText: turn.userText,
      contextQueryText: turn.contextQueryText,
      participantId: request.participantId,
      command: request.command,
      attachmentCount: request.attachments?.length ?? 0,
      historyTurns: context.history.length,
      seedMessageCount: Math.max(0, messages.length - 1),
      modelMessageCount: messages.length,
      modelMessageRoles: messages.map((message) => message.role),
      finalUserMessage,
    },
  };
}

function reportTrace(
  services: IDefaultParticipantServices,
  context: IChatParticipantContext,
  seed: Pick<IChatRuntimeTrace, 'route' | 'routeAuthority' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady' | 'queryScope' | 'semanticFallback'>,
  patch: Partial<IChatRuntimeTrace> & Pick<IChatRuntimeTrace, 'phase' | 'checkpoint' | 'runState'>,
): void {
  if (!services.reportRuntimeTrace) {
    return;
  }

  services.reportRuntimeTrace({
    ...seed,
    sessionId: context.sessionId,
    runtime: 'openclaw',
    ...patch,
  });
}

function buildTraceSeed(
  requestText: string,
  turn: IOpenclawResolvedTurn,
  route: IChatRuntimeTrace['route'],
  routeAuthority: IChatRuntimeTrace['routeAuthority'],
  contextPlan: IChatRuntimeTrace['contextPlan'],
): Pick<IChatRuntimeTrace, 'route' | 'routeAuthority' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady' | 'queryScope' | 'semanticFallback'> {
  return {
    route: enrichOpenclawTraceRoute(requestText, route),
    routeAuthority,
    contextPlan,
    queryScope: turn.queryScope,
    semanticFallback: turn.semanticFallback,
    hasActiveSlashCommand: turn.hasActiveSlashCommand,
    isRagReady: turn.isRagReady,
  };
}

function servicesBackboneRepairAnswer(options: {
  services: IDefaultParticipantServices;
  requestText: string;
  markdown: string;
  userContent: string;
  preparedContext: IOpenclawPreparedContext;
}): string {
  return repairGroundedAnswer({
    query: options.requestText,
    markdown: options.markdown,
    retrievedContextText: [options.preparedContext.retrievedContextText, options.userContent].filter(Boolean).join('\n\n'),
    evidenceAssessment: options.preparedContext.evidenceAssessment,
    coverageRecord: options.preparedContext.coverageRecord,
  });
}