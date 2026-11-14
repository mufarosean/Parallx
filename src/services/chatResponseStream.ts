// chatResponseStream.ts — the stream a participant writes an answer into.
//
// Split from chatService.ts, which makes one for each request. It builds the
// answer's parts as they arrive, and keeps the answer's timing: when its first
// word came, and what the engine reported of each model call
// (chatResponseTiming.ts).

import { ChatContentPartKind } from './chatTypes.js';
import type {
  EditProposalOperation,
  IChatAssistantResponse,
  IChatContentPart,
  IChatEditProposalContent,
  IChatMarkdownContent,
  IChatProvenanceEntry,
  IChatReferenceContent,
  IChatResponseStream,
  IChatThinkingContent,
  IChatToolInvocationContent,
} from './chatTypes.js';
import { thinkingSettled, thinkingStartsCollapsed } from './chatThinkingView.js';
import { noteFirstWord, noteModelCall } from './chatResponseTiming.js';
import type { IModelCallTiming } from './chatResponseTiming.js';

/**
 * Concrete IChatResponseStream implementation.
 *
 * Each method mutates the response's parts array in-place.
 * UI update notifications are coalesced via queueMicrotask: multiple writes
 * within the same microtask (e.g. consecutive streaming chunks) produce a
 * single change event, minimising DOM thrashing.
 *
 * The first thing the model itself writes (reasoning, text, a code block, a
 * tool call, a part pushed whole) stamps the answer's first word; the
 * runtime's own status lines (progress, sources, warnings) do not.
 *
 * VS Code reference: extHostTypes.ts — ChatResponseStream + sendQueue batching
 */
export class ChatResponseStream implements IChatResponseStream {
  private _done = false;
  private _updateScheduled = false;

  constructor(
    private readonly _response: IChatAssistantResponse,
    private readonly _onUpdate: () => void,
  ) {
    this.throwIfDone = this.throwIfDone.bind(this);
    this.close = this.close.bind(this);
    this.reportTokenUsage = this.reportTokenUsage.bind(this);
    this.reportModelCall = this.reportModelCall.bind(this);
    this.setCitations = this.setCitations.bind(this);
    this.getMarkdownText = this.getMarkdownText.bind(this);
    this.replaceLastMarkdown = this.replaceLastMarkdown.bind(this);
    this.replaceMarkdownTail = this.replaceMarkdownTail.bind(this);
    this.markdown = this.markdown.bind(this);
    this.codeBlock = this.codeBlock.bind(this);
    this.progress = this.progress.bind(this);
    this.provenance = this.provenance.bind(this);
    this.reference = this.reference.bind(this);
    this.thinking = this.thinking.bind(this);
    this.warning = this.warning.bind(this);
    this.button = this.button.bind(this);
    this.confirmation = this.confirmation.bind(this);
    this.beginToolInvocation = this.beginToolInvocation.bind(this);
    this.updateToolInvocation = this.updateToolInvocation.bind(this);
    this.editProposal = this.editProposal.bind(this);
    this.editBatch = this.editBatch.bind(this);
    this.push = this.push.bind(this);
  }

  /**
   * Schedule a batched update notification via queueMicrotask.
   * Multiple writes within the same microtask coalesce into one event.
   */
  private _scheduleUpdate(): void {
    if (!this._updateScheduled) {
      this._updateScheduled = true;
      queueMicrotask(() => {
        this._updateScheduled = false;
        this._onUpdate();
      });
    }
  }

  throwIfDone(): void {
    if (this._done) {
      throw new Error('Stream is closed');
    }
  }

  /** Mark the stream as closed — no more writes allowed. */
  close(): void {
    this._done = true;
    // Strip transient parts that may linger.
    // Progress and references are already folded into the thinking part
    // during streaming, but strip any stragglers + tool invocations.
    const parts = this._response.parts as IChatContentPart[];

    // Collect any straggler references not yet folded into thinking
    const stragglerRefs: IChatProvenanceEntry[] = [];
    for (const p of parts) {
      if (p.kind === ChatContentPartKind.Reference) {
        const reference = p as IChatReferenceContent;
        stragglerRefs.push({
          id: reference.uri,
          label: reference.label,
          kind: 'rag',
          uri: reference.uri,
          tokens: 0,
          removable: true,
        });
      }
    }

    // Strip transient standalone parts (Progress spinners, Reference stragglers).
    // ToolInvocation parts are kept — completed tool calls persist in the message
    // so the user can see what tools were called, their args, and results.
    for (let i = parts.length - 1; i >= 0; i--) {
      const kind = parts[i].kind;
      if (
        kind === ChatContentPartKind.Progress ||
        kind === ChatContentPartKind.Reference
      ) {
        parts.splice(i, 1);
      }
    }

    // Fold any straggler references into thinking
    if (stragglerRefs.length > 0) {
      const thinkingPart = parts.find(
        (p) => p.kind === ChatContentPartKind.Thinking,
      ) as IChatThinkingContent | undefined;

      if (thinkingPart) {
        if (!thinkingPart.provenance) {
          thinkingPart.provenance = [];
        }
        for (const ref of stragglerRefs) {
          // Avoid duplicates
          if (!thinkingPart.provenance.some((entry) => (entry.uri ?? entry.id) === (ref.uri ?? ref.id))) {
            thinkingPart.provenance.push(ref);
          }
        }
      }
    }

    // Settle EVERY thinking burst: clear ephemeral progress, collapse, and
    // freeze each burst's duration so per-burst "Thought for Xs" labels stay
    // accurate. Parts are NOT reordered — the whole point of per-burst
    // sequencing is that the turn reads chronologically
    // (think -> tools -> think -> text), like Claude.
    for (const part of parts) {
      if (part.kind !== ChatContentPartKind.Thinking) continue;
      const t = part as IChatThinkingContent;
      t.progressMessage = undefined;
      t.isCollapsed = thinkingSettled(t.isCollapsed);
      if (t.startTime != null && t.endTime == null) {
        t.endTime = Date.now();
      }
    }

    this._scheduleUpdate();
  }

  reportTokenUsage(promptTokens: number, completionTokens: number): void {
    (this._response as any).promptTokens = promptTokens;
    (this._response as any).completionTokens = completionTokens;
  }

  reportModelCall(call: IModelCallTiming): void {
    noteModelCall(this._response, call);
  }

  setCitations(citations: Array<{ index: number; uri: string; label: string }>): void {
    // Attach the citation map to every Markdown part so the renderer
    // can resolve [N] markers to clickable source badges.
    const parts = this._response.parts as IChatContentPart[];
    for (const part of parts) {
      if (part.kind === ChatContentPartKind.Markdown) {
        (part as IChatMarkdownContent).citations = citations;
      }
    }
    this._scheduleUpdate();
  }

  /** Return the concatenated text of all Markdown parts in the response. */
  getMarkdownText(): string {
    const parts = this._response.parts as IChatContentPart[];
    return parts
      .filter(p => p.kind === ChatContentPartKind.Markdown)
      .map(p => (p as IChatMarkdownContent).content)
      .join('');
  }

  replaceLastMarkdown(content: string): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    // Walk backwards to find the last Markdown part
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].kind === ChatContentPartKind.Markdown) {
        (parts[i] as IChatMarkdownContent).content = content;
        this._scheduleUpdate();
        return;
      }
    }
    // No markdown part found — push one if there's content
    if (content) {
      parts.push({ kind: ChatContentPartKind.Markdown, content });
      this._scheduleUpdate();
    }
  }

  replaceMarkdownTail(tail: string, replacement: string): boolean {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].kind !== ChatContentPartKind.Markdown) continue;
      const part = parts[i] as IChatMarkdownContent;
      if (!part.content.endsWith(tail)) return false;
      part.content = part.content.slice(0, part.content.length - tail.length) + replacement;
      this._scheduleUpdate();
      return true;
    }
    return false;
  }

  markdown(content: string): void {
    this.throwIfDone();
    if (content) noteFirstWord(this._response);
    this._sealTrailingThinking();

    // Merge adjacent markdown parts
    const parts = this._response.parts as IChatContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;

    if (last && last.kind === ChatContentPartKind.Markdown) {
      (last as IChatMarkdownContent).content += content;
    } else {
      parts.push({ kind: ChatContentPartKind.Markdown, content });
    }

    this._scheduleUpdate();
  }

  codeBlock(code: string, language?: string): void {
    this.throwIfDone();
    noteFirstWord(this._response);
    this._sealTrailingThinking();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.CodeBlock,
      code,
      language,
    });
    this._scheduleUpdate();
  }

  progress(message: string): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];

    // Fold progress into the CURRENT (trailing) thinking part so the status
    // rides the burst that is actually happening; create one at the end
    // otherwise — chronological, like every other part.
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (last && last.kind === ChatContentPartKind.Thinking) {
      (last as IChatThinkingContent).progressMessage = message;
    } else {
      parts.push({
        kind: ChatContentPartKind.Thinking,
        content: '',
        isCollapsed: thinkingStartsCollapsed(),
        progressMessage: message,
        startTime: Date.now(),
      });
    }
    this._scheduleUpdate();
  }

  provenance(entry: IChatProvenanceEntry): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];

    const thinkingPart = parts.find(
      (p) => p.kind === ChatContentPartKind.Thinking,
    ) as IChatThinkingContent | undefined;

    if (thinkingPart) {
      if (!thinkingPart.provenance) {
        thinkingPart.provenance = [];
      }
      if (!thinkingPart.provenance.some((existing) => (existing.uri ?? existing.id) === (entry.uri ?? entry.id))) {
        thinkingPart.provenance.push(entry);
      }
    } else {
      // Create at the END — never reorder existing parts. (Pre-turn
      // provenance arrives while parts is empty, so it still lands first.)
      parts.push({
        kind: ChatContentPartKind.Thinking,
        content: '',
        isCollapsed: thinkingStartsCollapsed(),
        provenance: [entry],
        startTime: Date.now(),
      });
    }
    this._scheduleUpdate();
  }

  reference(uri: string, label: string, index?: number): void {
    this.provenance({
      id: uri,
      label,
      kind: 'rag',
      uri,
      index,
      tokens: 0,
      removable: true,
    });
  }

  thinking(content: string): void {
    this.throwIfDone();
    if (content) noteFirstWord(this._response);

    // CHRONOLOGICAL sequencing (Claude-style): deltas merge into the thinking
    // part only while it is the LAST part — i.e. the same contiguous
    // reasoning burst. Once a tool call or text lands after it, the next
    // thinking delta starts a NEW part, so multi-round agentic turns read
    // top-to-bottom in the order things actually happened
    // (think -> tools -> think -> text) instead of pooling all reasoning
    // into one front-pinned blob.
    const parts = this._response.parts as IChatContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;

    if (last && last.kind === ChatContentPartKind.Thinking) {
      (last as IChatThinkingContent).content += content;
    } else {
      parts.push({
        kind: ChatContentPartKind.Thinking,
        content,
        // Streaming bursts start expanded unless chat.thinkingView says closed;
        // settling collapses them only in the default view (chatThinkingView.ts).
        isCollapsed: thinkingStartsCollapsed(),
        startTime: Date.now(),
      });
    }

    this._scheduleUpdate();
  }

  /**
   * Seal a trailing thinking burst the moment a non-thinking part follows it:
   * freeze its duration (per-burst "Thought for Xs") and collapse it — the
   * turn has visibly moved on. Called by every part-appending method.
   */
  private _sealTrailingThinking(): void {
    const parts = this._response.parts as IChatContentPart[];
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (last && last.kind === ChatContentPartKind.Thinking) {
      const t = last as IChatThinkingContent;
      if (t.endTime == null && t.startTime != null) t.endTime = Date.now();
      t.isCollapsed = thinkingSettled(t.isCollapsed);
      t.progressMessage = undefined;
    }
  }

  warning(message: string): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Warning,
      message,
    });
    this._scheduleUpdate();
  }

  button(_label: string, _commandId: string, ..._args: unknown[]): void {
    this.throwIfDone();
    // Buttons are rendered as markdown action links in M9.0
    // Full button support arrives in M9.1 with tool invocation UI
    this.markdown(`[${_label}](command:${_commandId})`);
  }

  confirmation(message: string, data: unknown): void {
    this.throwIfDone();
    this._sealTrailingThinking();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.Confirmation,
      message,
      data,
    });
    this._scheduleUpdate();
  }

  beginToolInvocation(toolCallId: string, toolName: string, data?: unknown): void {
    this.throwIfDone();
    noteFirstWord(this._response);
    this._sealTrailingThinking();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.ToolInvocation,
      toolCallId,
      toolName,
      args: (data as Record<string, unknown>) || {},
      status: 'pending',
    });
    this._scheduleUpdate();
  }

  updateToolInvocation(toolCallId: string, data: Partial<IChatToolInvocationContent>): void {
    this.throwIfDone();
    const parts = this._response.parts as IChatContentPart[];
    const toolPart = parts.find(
      (p) => p.kind === ChatContentPartKind.ToolInvocation && p.toolCallId === toolCallId,
    ) as IChatToolInvocationContent | undefined;

    if (toolPart) {
      Object.assign(toolPart, data);
      this._scheduleUpdate();
    }
  }

  editProposal(
    pageId: string,
    operation: EditProposalOperation,
    after: string,
    options?: { blockId?: string; before?: string },
  ): void {
    this.throwIfDone();
    const part: IChatEditProposalContent = {
      kind: ChatContentPartKind.EditProposal,
      pageId,
      blockId: options?.blockId,
      operation,
      before: options?.before,
      after,
      status: 'pending',
    };
    (this._response.parts as IChatContentPart[]).push(part);
    this._scheduleUpdate();
  }

  editBatch(explanation: string, proposals: IChatEditProposalContent[]): void {
    this.throwIfDone();
    (this._response.parts as IChatContentPart[]).push({
      kind: ChatContentPartKind.EditBatch,
      explanation,
      proposals,
    });
    this._scheduleUpdate();
  }

  push(part: IChatContentPart): void {
    this.throwIfDone();
    noteFirstWord(this._response);
    (this._response.parts as IChatContentPart[]).push(part);
    this._scheduleUpdate();
  }
}
