// composePageRuntime.ts — the live execution behind `canvas_compose_page`.
//
// Runs a focused streaming model turn whose output IS the page body, and routes
// each content delta into the open editor's stream sink (the user watches the
// page being typed). Commits through the pane (standard revision-checked save);
// falls back to a direct DB write when the page isn't open or the pane dies
// mid-stream — the composed content is never lost.
//
// Dependency-injected and DOM-free so the whole flow (stream → sink → commit /
// cancel → revert / closed-pane fallback) is unit-testable with fakes.

import type { ICancellationToken } from '../../../services/chatTypes.js';
import type { IPageStreamSink } from '../canvasEditorProvider.js';
import type { ComposePageFn, IComposePageOutcome } from './composePageTool.js';
import { markdownToTiptapJson } from '../markdownImport.js';

export interface IComposeRuntimeDeps {
  /** Resolve the target page (title + current body as markdown), or null. */
  getPage(pageId: string): Promise<{ title: string; bodyMarkdown: string } | null>;
  /** The open pane's stream sink, if the page is open. */
  getSink(pageId: string): IPageStreamSink | undefined;
  /** Streaming model call on the active model. */
  sendChatRequest(
    messages: readonly { role: 'system' | 'user'; content: string }[],
    signal: AbortSignal,
  ): AsyncIterable<{ readonly content: string; readonly done: boolean }>;
  /** Persist a composed markdown body directly (page closed / pane died). */
  writeBody(pageId: string, markdown: string): Promise<void>;
}

/**
 * Models often wrap whole-document output in a markdown code fence despite
 * instructions. This stateful filter strips a leading fence line and withholds
 * a possible trailing fence (flushing it only if it turns out NOT to be one),
 * so neither is typed into the page.
 */
export class FenceStripper {
  private _atFirstLine = true;
  private _firstLineBuf = '';
  private _held = '';

  /** Transform a raw delta into what should be shown/accumulated. */
  push(delta: string): string {
    let text = this._held + delta;
    this._held = '';

    if (this._atFirstLine) {
      this._firstLineBuf += text;
      const nl = this._firstLineBuf.indexOf('\n');
      if (nl === -1) return ''; // still inside the first line — wait
      const firstLine = this._firstLineBuf.slice(0, nl);
      const rest = this._firstLineBuf.slice(nl + 1);
      this._atFirstLine = false;
      this._firstLineBuf = '';
      text = /^```/.test(firstLine.trim()) ? rest : firstLine + '\n' + rest;
    }

    // Withhold a suffix that could be a trailing fence ("\n```" possibly with
    // trailing whitespace) until we know more.
    const m = text.match(/\n`{0,3}\s*$/);
    if (m && m.index !== undefined) {
      this._held = text.slice(m.index);
      text = text.slice(0, m.index);
    }
    return text;
  }

  /** Stream over — flush anything held back unless it's a trailing fence. */
  flush(): string {
    const out = (this._atFirstLine ? this._firstLineBuf : this._held);
    this._atFirstLine = false;
    this._firstLineBuf = '';
    this._held = '';
    return /^\s*```\s*$/.test(out.trim()) || /^\n`{3}\s*$/.test(out) ? '' : out;
  }
}

export function createComposePageRuntime(deps: IComposeRuntimeDeps): ComposePageFn {
  return async (pageId: string, instruction: string, token: ICancellationToken): Promise<IComposePageOutcome> => {
    const page = await deps.getPage(pageId);
    if (!page) return { ok: false, summary: `Page not found: ${pageId}. Pass an existing page UUID.` };

    const abort = new AbortController();
    const cancelSub = token.onCancellationRequested(() => abort.abort());
    if (token.isCancellationRequested) abort.abort();

    const messages = [
      {
        role: 'system' as const,
        content:
          'You write the body of a canvas page. Respond with ONLY the page body as plain markdown. ' +
          'Do not wrap the document in a code fence. No preamble, no commentary, no closing remarks.',
      },
      {
        role: 'user' as const,
        content:
          `Page title: "${page.title}"\n\n` +
          `Current body (markdown):\n${page.bodyMarkdown.trim() || '(empty)'}\n\n` +
          `Instruction: ${instruction}\n\nWrite the complete new body now.`,
      },
    ];

    const sink = deps.getSink(pageId);
    const streaming = !!sink && sink.begin();
    const stripper = new FenceStripper();
    let markdown = '';

    const fail = async (summary: string): Promise<IComposePageOutcome> => {
      if (streaming) await sink!.end(false); // revert the pane to its pre-stream state
      return { ok: false, summary };
    };

    try {
      for await (const chunk of deps.sendChatRequest(messages, abort.signal)) {
        if (token.isCancellationRequested) break;
        if (!chunk.content) continue;
        const text = stripper.push(chunk.content);
        if (!text) continue;
        markdown += text;
        if (streaming) sink!.push(text);
      }
      const tail = stripper.flush();
      if (tail) {
        markdown += tail;
        if (streaming) sink!.push(tail);
      }
    } catch (err) {
      return fail(`Composition failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      cancelSub.dispose();
    }

    if (token.isCancellationRequested) return fail('Composition cancelled — the page was restored.');
    if (!markdown.trim()) return fail('The model produced no content — the page is unchanged.');

    let blockCount = 0;
    try { blockCount = (markdownToTiptapJson(markdown, { assignBlockIds: false }).content ?? []).length; } catch { /* count is cosmetic */ }

    if (streaming) {
      const committed = await sink!.end(true);
      if (!committed) {
        // The pane closed mid-stream — persist the accumulated body directly.
        await deps.writeBody(pageId, markdown);
      }
      return { ok: true, summary: `Composed "${page.title}" — ${blockCount} block(s), streamed live into the open editor.` };
    }
    await deps.writeBody(pageId, markdown);
    return { ok: true, summary: `Composed "${page.title}" — ${blockCount} block(s) written.` };
  };
}
