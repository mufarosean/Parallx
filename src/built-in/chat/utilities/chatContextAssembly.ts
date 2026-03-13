import { isChatFileAttachment, isChatImageAttachment } from '../../../services/chatTypes.js';
import type { IChatAttachment, IChatMessage, IChatProvenanceEntry, IContextPill } from '../../../services/chatTypes.js';

import type {
  ChatAttachmentResult,
  ChatConceptResult,
  ChatMemoryResult,
  ChatPageResult,
  ChatRagResult,
  ChatTranscriptResult,
} from './chatContextSourceLoader.js';

type ChatRagSource = NonNullable<ChatRagResult>['sources'][number];

export interface IChatEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatContextAssemblyDeps {
  readonly retrieveContext?: (query: string) => Promise<{ text: string; sources: Array<{ uri: string; label: string; index?: number }> } | undefined>;
  readonly reportContextPills?: (pills: IContextPill[]) => void;
  readonly getExcludedContextIds?: () => ReadonlySet<string>;
  readonly assessEvidenceSufficiency: (
    query: string,
    retrievedContextText: string,
    ragSources: readonly ChatRagSource[],
  ) => IChatEvidenceAssessment;
  readonly buildRetrieveAgainQuery: (query: string, retrievedContextText: string) => string | undefined;
}

export interface IChatContextAssemblyOptions {
  readonly userText: string;
  readonly messages: readonly IChatMessage[];
  readonly attachments?: readonly IChatAttachment[];
  readonly mentionPills: readonly IContextPill[];
  readonly useRetrieval: boolean;
  readonly maxMemoryContextChars: number;
  readonly maxTranscriptContextChars: number;
  readonly maxConceptContextChars: number;
  readonly pageResult: ChatPageResult;
  readonly ragResult: ChatRagResult;
  readonly memoryResult: ChatMemoryResult;
  readonly transcriptResult: ChatTranscriptResult;
  readonly conceptResult: ChatConceptResult;
  readonly attachmentResults: readonly ChatAttachmentResult[];
}

export interface IChatContextAssemblyResult {
  readonly contextParts: string[];
  readonly ragSources: ChatRagSource[];
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatEvidenceAssessment;
  readonly provenance: IChatProvenanceEntry[];
  readonly pills: IContextPill[];
}

interface IChatContextBlock {
  readonly text: string;
  readonly sourceIds: string[];
}

function appendProvenance(
  target: IChatProvenanceEntry[],
  entry: IChatProvenanceEntry,
): void {
  const entryKey = entry.uri ?? entry.id;
  if (target.some((candidate) => (candidate.uri ?? candidate.id) === entryKey)) {
    return;
  }
  target.push(entry);
}

function provenanceToPill(entry: IChatProvenanceEntry): IContextPill | undefined {
  if (entry.kind === 'page') {
    return undefined;
  }

  return {
    id: entry.id,
    label: entry.label,
    type: entry.kind,
    tokens: entry.tokens,
    removable: entry.removable,
    index: entry.index,
  };
}

export async function assembleChatContext(
  deps: IChatContextAssemblyDeps,
  options: IChatContextAssemblyOptions,
): Promise<IChatContextAssemblyResult> {
  const contextBlocks: IChatContextBlock[] = [];
  const ragSources: ChatRagSource[] = [];
  const provenance: IChatProvenanceEntry[] = [];
  let retrievedContextText = '';

  const pushContextBlock = (text: string, sourceIds: readonly string[]): void => {
    contextBlocks.push({ text, sourceIds: [...sourceIds] });
  };

  if (options.pageResult && options.pageResult.textContent) {
    const pageUri = `parallx-page://${options.pageResult.pageId}`;
    appendProvenance(provenance, {
      id: pageUri,
      label: options.pageResult.title,
      kind: 'page',
      uri: pageUri,
      tokens: Math.ceil(options.pageResult.textContent.length / 4),
      removable: false,
    });
    pushContextBlock(
      `[Currently open page: "${options.pageResult.title}" (id: ${options.pageResult.pageId})]\n${options.pageResult.textContent}`,
      [pageUri],
    );
  }

  const alreadyInContext = new Set<string>();
  if (options.attachments?.length) {
    for (const attachment of options.attachments) {
      alreadyInContext.add(attachment.fullPath);
      alreadyInContext.add(attachment.name);
    }
  }
  for (const entry of provenance) {
    alreadyInContext.add(entry.id);
    alreadyInContext.add(entry.label);
    if (entry.uri) {
      alreadyInContext.add(entry.uri);
    }
  }
  for (const pill of options.mentionPills) {
    alreadyInContext.add(pill.label);
    const colonIdx = pill.id.indexOf(':');
    if (colonIdx > 0) {
      alreadyInContext.add(pill.id.substring(colonIdx + 1));
    }
  }
  const seenRagBlocks = new Set<string>();

  const appendRagResult = (result: NonNullable<ChatRagResult>): void => {
    const ragSourceIds: string[] = [];
    if (result.text && !seenRagBlocks.has(result.text)) {
      for (const source of result.sources) {
        ragSourceIds.push(source.uri);
      }
      pushContextBlock(result.text, ragSourceIds);
      seenRagBlocks.add(result.text);
    }

    for (const source of result.sources) {
      if (!alreadyInContext.has(source.uri) && !alreadyInContext.has(source.label)) {
        appendProvenance(provenance, {
          id: source.uri,
          label: source.label,
          kind: 'rag',
          uri: source.uri,
          index: source.index,
          tokens: 0,
          removable: true,
        });
        ragSources.push(source);
        alreadyInContext.add(source.uri);
        alreadyInContext.add(source.label);
      }
    }
  };

  if (options.ragResult) {
    retrievedContextText = options.ragResult.text;
    appendRagResult(options.ragResult);
  }

  let evidenceAssessment = deps.assessEvidenceSufficiency(options.userText, retrievedContextText, ragSources);
  if (evidenceAssessment.status === 'insufficient' && deps.retrieveContext && options.useRetrieval) {
    const retrieveAgainQuery = deps.buildRetrieveAgainQuery(options.userText, retrievedContextText);
    if (retrieveAgainQuery) {
      const retrieveAgainResult = await deps.retrieveContext(retrieveAgainQuery).catch(() => null as ChatRagResult);
      if (retrieveAgainResult) {
        retrievedContextText = [retrievedContextText, retrieveAgainResult.text].filter(Boolean).join('\n\n');
        appendRagResult(retrieveAgainResult);
        evidenceAssessment = deps.assessEvidenceSufficiency(options.userText, retrievedContextText, ragSources);
      }
    }
  }

  if (options.memoryResult) {
    const memoryId = 'memory:session-recall';
    let memoryContext = options.memoryResult;
    if (memoryContext.length > options.maxMemoryContextChars) {
      memoryContext = memoryContext.slice(0, options.maxMemoryContextChars) + '\n[…memory truncated]';
    }
    appendProvenance(provenance, {
      id: memoryId,
      label: 'Session memory',
      kind: 'memory',
      tokens: Math.ceil(memoryContext.length / 4),
      removable: true,
    });
    pushContextBlock(memoryContext, [memoryId]);
  }

  if (options.transcriptResult) {
    const transcriptId = 'transcript:recall';
    let transcriptContext = options.transcriptResult;
    if (transcriptContext.length > options.maxTranscriptContextChars) {
      transcriptContext = transcriptContext.slice(0, options.maxTranscriptContextChars) + '\n[…transcript recall truncated]';
    }
    appendProvenance(provenance, {
      id: transcriptId,
      label: 'Transcript recall',
      kind: 'memory',
      tokens: Math.ceil(transcriptContext.length / 4),
      removable: true,
    });
    pushContextBlock(transcriptContext, [transcriptId]);
  }

  if (options.conceptResult) {
    const conceptId = 'concept:recall';
    let conceptContext = options.conceptResult;
    if (conceptContext.length > options.maxConceptContextChars) {
      conceptContext = conceptContext.slice(0, options.maxConceptContextChars) + '\n[…concepts truncated]';
    }
    appendProvenance(provenance, {
      id: conceptId,
      label: 'Concept recall',
      kind: 'concept',
      tokens: Math.ceil(conceptContext.length / 4),
      removable: true,
    });
    pushContextBlock(conceptContext, [conceptId]);
  }

  const fileAttachments = options.attachments?.filter(isChatFileAttachment) ?? [];
  for (const [index, attachment] of options.attachmentResults.entries()) {
    const sourceAttachment = fileAttachments[index];
    if (sourceAttachment) {
      const attachmentId = sourceAttachment.fullPath;
      appendProvenance(provenance, {
        id: attachmentId,
        label: sourceAttachment.name,
        kind: 'attachment',
        uri: attachmentId,
        tokens: attachment.content ? Math.ceil(attachment.content.length / 4) : 0,
        removable: true,
      });
      alreadyInContext.add(attachmentId);
      alreadyInContext.add(sourceAttachment.name);
    }
    if (attachment.content !== null) {
      pushContextBlock(`File: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``, sourceAttachment ? [sourceAttachment.fullPath] : []);
    } else {
      pushContextBlock(`File: ${attachment.name}\n[Could not read file]`, sourceAttachment ? [sourceAttachment.fullPath] : []);
    }
  }

  if (options.attachments?.length) {
    for (const attachment of options.attachments) {
      if (isChatImageAttachment(attachment)) {
        pushContextBlock(`Attached image: ${attachment.name}`, [attachment.fullPath]);
      }
    }
  }

  const pills: IContextPill[] = [];
  if (deps.reportContextPills) {
    const sysContent = options.messages[0]?.content ?? '';
    const pillProvenance: IChatProvenanceEntry[] = [
      {
        id: 'system-prompt',
        label: 'System prompt',
        kind: 'system',
        tokens: Math.ceil(sysContent.length / 4),
        removable: false,
      },
      ...provenance,
      ...options.mentionPills.map((pill) => ({
        id: pill.id,
        label: pill.label,
        kind: pill.type,
        index: pill.index,
        tokens: pill.tokens,
        removable: pill.removable,
      })),
    ];

    pills.push(...pillProvenance.map(provenanceToPill).filter((pill): pill is IContextPill => !!pill));

    const totalNonSysChars = contextBlocks.reduce((sum, part) => sum + part.text.length, 0);
    for (const pill of pills) {
      if ((pill.type === 'rag' || pill.type === 'attachment') && pill.tokens === 0) {
        const match = contextBlocks.find((part) => part.sourceIds.includes(pill.id));
        if (match) {
          (pill as { tokens: number }).tokens = Math.ceil(match.text.length / 4);
        } else if (totalNonSysChars > 0 && pills.length > 1) {
          const nonSystemPills = pills.filter((entry) => entry.type !== 'system');
          (pill as { tokens: number }).tokens = Math.ceil(totalNonSysChars / nonSystemPills.length / 4);
        }
      }
    }

    deps.reportContextPills(pills);
  }

  if (deps.getExcludedContextIds) {
    const excluded = deps.getExcludedContextIds();
    if (excluded.size > 0) {
      const filteredBlocks = contextBlocks.filter((block) => block.sourceIds.every((sourceId) => !excluded.has(sourceId)));
      contextBlocks.length = 0;
      contextBlocks.push(...filteredBlocks);
    }
  }

  const contextParts = contextBlocks.map((block) => block.text);

  return {
    contextParts,
    ragSources,
    retrievedContextText,
    evidenceAssessment,
    provenance,
    pills,
  };
}