// pdfTypes.ts — what the PDF pane reads of a document (its outline, a
// selection's boxes) and the services it reaches through commands.

import type { IChatMessage, IChatResponseChunk } from '../../../services/chatTypes.js';

export interface PdfOutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: string | any[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

export interface SelectionOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The chat's inline-AI provider (`chat.getInlineAIProvider`). */
export interface InlineAIProvider {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: { temperature?: number; maxTokens?: number; think?: boolean },
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  retrieveContext?: (query: string) => Promise<string | undefined>;
}

/** The command service, as much of it as the pane uses. */
export interface IPaneCommandService {
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}
