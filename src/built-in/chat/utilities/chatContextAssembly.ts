import { isChatFileAttachment, isChatImageAttachment } from '../../../services/chatTypes.js';
import type { IChatAttachment, IChatMessage, IContextPill } from '../../../services/chatTypes.js';

import type {
  ChatAttachmentResult,
  ChatConceptResult,
  ChatMemoryResult,
  ChatPageResult,
  ChatRagResult,
} from './chatContextSourceLoader.js';

type ChatRagSource = NonNullable<ChatRagResult>['sources'][number];

export interface IChatEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatContextAssemblyDeps {
  readonly retrieveContext?: (query: string) => Promise<{ text: string; sources: Array<{ uri: string; label: string; index?: number }> } | undefined>;
  readonly addReference: (uri: string, label: string, index?: number) => void;
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
  readonly maxConceptContextChars: number;
  readonly pageResult: ChatPageResult;
  readonly ragResult: ChatRagResult;
  readonly memoryResult: ChatMemoryResult;
  readonly conceptResult: ChatConceptResult;
  readonly attachmentResults: readonly ChatAttachmentResult[];
}

export interface IChatContextAssemblyResult {
  readonly contextParts: string[];
  readonly ragSources: ChatRagSource[];
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatEvidenceAssessment;
  readonly pills: IContextPill[];
}

export async function assembleChatContext(
  deps: IChatContextAssemblyDeps,
  options: IChatContextAssemblyOptions,
): Promise<IChatContextAssemblyResult> {
  const contextParts: string[] = [];
  const ragSources: ChatRagSource[] = [];
  let retrievedContextText = '';
  const directReferenceUris = new Set<string>();

  if (options.pageResult && options.pageResult.textContent) {
    const pageUri = `parallx-page://${options.pageResult.pageId}`;
    deps.addReference(pageUri, options.pageResult.title);
    directReferenceUris.add(pageUri);
    directReferenceUris.add(options.pageResult.title);
    contextParts.push(
      `[Currently open page: "${options.pageResult.title}" (id: ${options.pageResult.pageId})]\n${options.pageResult.textContent}`,
    );
  }

  const alreadyInContext = new Set<string>();
  if (options.attachments?.length) {
    for (const attachment of options.attachments) {
      alreadyInContext.add(attachment.fullPath);
      alreadyInContext.add(attachment.name);
    }
  }
  for (const directRef of directReferenceUris) {
    alreadyInContext.add(directRef);
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
    if (result.text && !seenRagBlocks.has(result.text)) {
      contextParts.push(result.text);
      seenRagBlocks.add(result.text);
    }

    for (const source of result.sources) {
      if (alreadyInContext.has(source.uri) || alreadyInContext.has(source.label)) {
        continue;
      }
      deps.addReference(source.uri, source.label, source.index);
      ragSources.push(source);
      alreadyInContext.add(source.uri);
      alreadyInContext.add(source.label);
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
    let memoryContext = options.memoryResult;
    if (memoryContext.length > options.maxMemoryContextChars) {
      memoryContext = memoryContext.slice(0, options.maxMemoryContextChars) + '\n[…memory truncated]';
    }
    contextParts.push(memoryContext);
  }

  if (options.conceptResult) {
    let conceptContext = options.conceptResult;
    if (conceptContext.length > options.maxConceptContextChars) {
      conceptContext = conceptContext.slice(0, options.maxConceptContextChars) + '\n[…concepts truncated]';
    }
    contextParts.push(conceptContext);
  }

  const fileAttachments = options.attachments?.filter(isChatFileAttachment) ?? [];
  for (const [index, attachment] of options.attachmentResults.entries()) {
    const sourceAttachment = fileAttachments[index];
    if (sourceAttachment && !directReferenceUris.has(sourceAttachment.fullPath)) {
      deps.addReference(sourceAttachment.fullPath, sourceAttachment.name);
      directReferenceUris.add(sourceAttachment.fullPath);
      directReferenceUris.add(sourceAttachment.name);
      alreadyInContext.add(sourceAttachment.fullPath);
      alreadyInContext.add(sourceAttachment.name);
    }
    if (attachment.content !== null) {
      contextParts.push(`File: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\``);
    } else {
      contextParts.push(`File: ${attachment.name}\n[Could not read file]`);
    }
  }

  if (options.attachments?.length) {
    for (const attachment of options.attachments) {
      if (isChatImageAttachment(attachment)) {
        contextParts.push(`Attached image: ${attachment.name}`);
      }
    }
  }

  const pills: IContextPill[] = [];
  if (deps.reportContextPills) {
    const sysContent = options.messages[0]?.content ?? '';
    pills.push({
      id: 'system-prompt',
      label: 'System prompt',
      type: 'system',
      tokens: Math.ceil(sysContent.length / 4),
      removable: false,
    });

    for (const source of ragSources) {
      pills.push({
        id: source.uri,
        label: source.label,
        type: 'rag',
        tokens: 0,
        removable: true,
        index: source.index,
      });
    }

    if (options.attachments?.length) {
      for (const attachment of options.attachments) {
        pills.push({
          id: attachment.fullPath,
          label: attachment.name,
          type: 'attachment',
          tokens: 0,
          removable: true,
        });
      }
    }

    pills.push(...options.mentionPills);

    const totalNonSysChars = contextParts.reduce((sum, part) => sum + part.length, 0);
    for (const pill of pills) {
      if (pill.type === 'rag' || pill.type === 'attachment') {
        const match = contextParts.find((part) => part.includes(pill.label));
        if (match) {
          (pill as { tokens: number }).tokens = Math.ceil(match.length / 4);
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
      for (let index = contextParts.length - 1; index >= 0; index -= 1) {
        const part = contextParts[index];
        const shouldExclude = pills.some(
          (pill) => excluded.has(pill.id) && pill.removable && part.includes(pill.label),
        );
        if (shouldExclude) {
          contextParts.splice(index, 1);
        }
      }
    }
  }

  return {
    contextParts,
    ragSources,
    retrievedContextText,
    evidenceAssessment,
    pills,
  };
}