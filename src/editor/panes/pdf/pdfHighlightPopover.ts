// pdfHighlightPopover.ts — a highlight's review panel.
//
// Opened from a highlight's margin tab: the colour row (with Delete at its
// end), the note, the canvas pages the passage was sent to, and an AI
// discussion about the passage that is saved on the highlight. The panel
// changes the highlight in place and asks its host to save and redraw.

import type { IChatMessage } from '../../../services/chatTypes.js';
import { setupTooltip } from '../../../ui/tooltip.js';
import { ICON } from './pdfIcons.js';
import { pdfButton } from './pdfButtons.js';
import { HIGHLIGHT_COLORS, highlightSolid } from './pdfHighlights.js';
import type { PdfHighlight } from './pdfHighlights.js';
import type { InlineAIProvider } from './pdfTypes.js';

/** What the review panel needs from the highlights it belongs to. */
export interface HighlightPopoverHost {
  /** The highlight took another colour: remember it, save, redraw its page. */
  recolor(hl: PdfHighlight, colorKey: string): void;
  /** The highlight changed in place (note, discussion): save it. */
  save(): void;
  /** Delete the highlight and close the panel. */
  remove(hl: PdfHighlight): void;
  /** Open a canvas page the passage was sent to. */
  openCanvasPage(pageId: string): void;
  /** Take the passage and its discussion to the chat panel, and close. */
  continueInChat(hl: PdfHighlight): void;
  /** The chat's inline-AI provider, or null when chat is off. */
  inlineAI(): Promise<InlineAIProvider | null>;
  /** A signal for a new AI answer; any answer still streaming stops. */
  newAISignal(): AbortSignal;
  /** A click outside closed the panel; `onTab` when it landed on a margin tab. */
  closedOutside(hl: PdfHighlight, onTab: boolean): void;
}

export interface HighlightPopover {
  readonly element: HTMLElement;
  /** Remove the panel and its outside-click listener. */
  close(): void;
}

/** Open the review panel for `hl` next to `anchor`. */
export function openHighlightPopover(hl: PdfHighlight, anchor: DOMRect, host: HighlightPopoverHost): HighlightPopover {
  const pop = document.createElement('div');
  pop.classList.add('pdf-highlight-popover');

  const swatches = document.createElement('div');
  swatches.classList.add('pdf-highlight-swatches');
  for (const c of HIGHLIGHT_COLORS) {
    const sw = document.createElement('button');
    sw.classList.add('pdf-highlight-swatch');
    if (c.key === hl.color) sw.classList.add('selected');
    sw.style.backgroundColor = highlightSolid(c.rgba);
    sw.setAttribute('aria-label', c.label);
    setupTooltip(sw, c.label);
    sw.addEventListener('click', () => {
      host.recolor(hl, c.key);
      swatches.querySelectorAll('.pdf-highlight-swatch').forEach((n) => n.classList.remove('selected'));
      sw.classList.add('selected');
    });
    swatches.appendChild(sw);
  }
  // Delete sits at the end of the colour row, out of the reading path; Ctrl+Z
  // still brings the highlight back.
  const spacer = document.createElement('span');
  spacer.classList.add('pdf-highlight-spacer');
  const del = pdfButton(ICON.trash, 'Delete Highlight');
  del.classList.add('pdf-highlight-delete');
  del.addEventListener('click', () => host.remove(hl));
  swatches.append(spacer, del);
  pop.appendChild(swatches);

  const body = document.createElement('div');
  body.classList.add('pdf-highlight-body');
  pop.appendChild(body);

  const ta = document.createElement('textarea');
  ta.classList.add('pdf-highlight-note');
  ta.placeholder = 'Add a note…';
  ta.value = hl.note;
  ta.addEventListener('input', () => {
    hl.note = ta.value;
    host.save();
  });
  body.appendChild(ta);

  // Linked canvas pages: open them in the canvas editor.
  if (hl.canvasLinks && hl.canvasLinks.length > 0) {
    const section = document.createElement('div');
    section.classList.add('pdf-highlight-section');
    const label = document.createElement('div');
    label.classList.add('pdf-highlight-section-label');
    label.textContent = 'On canvas';
    section.appendChild(label);
    for (const link of hl.canvasLinks) {
      const row = document.createElement('button');
      row.classList.add('pdf-highlight-link');
      row.innerHTML = `<span class="pdf-highlight-link-icon">${ICON.openExtSm}</span><span class="pdf-highlight-link-title"></span>`;
      row.querySelector('.pdf-highlight-link-title')!.textContent = link.title || 'Untitled';
      row.addEventListener('click', () => host.openCanvasPage(link.pageId));
      section.appendChild(row);
    }
    body.appendChild(section);
  }

  // AI discussion thread anchored to this highlight.
  buildThreadSection(body, hl, host);

  document.body.appendChild(pop);
  position(pop, anchor);

  let closed = false;
  const dismiss = (e: MouseEvent) => {
    if (closed || pop.contains(e.target as Node)) return;
    // The margin tabs refresh on dismiss, but not when the press is on
    // another tab: redrawing would remove that tab mid-gesture and swallow
    // the click that should open its panel.
    host.closedOutside(hl, !!(e.target as HTMLElement | null)?.closest('.pdf-highlight-tab'));
  };
  // Registered a tick later, so the mousedown that opened the panel does
  // not close it at once.
  let registered = false;
  const timer = setTimeout(() => {
    registered = true;
    document.addEventListener('mousedown', dismiss, true);
  }, 0);

  return {
    element: pop,
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (registered) document.removeEventListener('mousedown', dismiss, true);
      pop.remove();
    },
  };
}

/**
 * Below the anchor when it fits, else above, else filling the window with
 * the content scrolling; always inside the window. Hidden until placed, so
 * it never paints once at the bottom of the page and jumps.
 */
function position(pop: HTMLElement, anchor: DOMRect): void {
  pop.style.visibility = 'hidden';
  const margin = 8;
  const maxH = window.innerHeight - margin * 2;
  const pw = pop.offsetWidth;
  const ph = Math.min(pop.offsetHeight, maxH);

  let left = anchor.left;
  if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
  left = Math.max(margin, left);

  const spaceBelow = window.innerHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  let top: number;
  if (ph <= spaceBelow) top = anchor.bottom + 4;
  else if (ph <= spaceAbove) top = anchor.top - ph - 4;
  else top = margin;
  top = Math.min(Math.max(margin, top), window.innerHeight - ph - margin);

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.maxHeight = `${maxH}px`;
  pop.style.visibility = '';
}

/**
 * The panel's AI discussion: the saved transcript plus an input that streams
 * a fresh answer from the inline-AI provider. Each turn is appended to
 * `hl.thread` and saved, so the conversation about a passage stays on the
 * highlight.
 */
function buildThreadSection(parent: HTMLElement, hl: PdfHighlight, host: HighlightPopoverHost): void {
  const section = document.createElement('div');
  section.classList.add('pdf-highlight-section', 'pdf-highlight-thread');

  const header = document.createElement('div');
  header.classList.add('pdf-highlight-thread-header');
  const label = document.createElement('div');
  label.classList.add('pdf-highlight-section-label');
  label.textContent = 'Discuss';
  header.appendChild(label);

  // "Continue in Chat": the passage and its thread go to the main chat panel
  // for a longer conversation (as canvas inline AI's "Send to Chat").
  const continueBtn = document.createElement('button');
  continueBtn.classList.add('pdf-highlight-continue-chat');
  continueBtn.innerHTML = `<span class="pdf-highlight-continue-icon">${ICON.messages}</span>Continue in Chat`;
  setupTooltip(continueBtn, 'Open this discussion in the main chat panel');
  continueBtn.addEventListener('click', () => host.continueInChat(hl));
  header.appendChild(continueBtn);
  section.appendChild(header);

  const transcript = document.createElement('div');
  transcript.classList.add('pdf-highlight-transcript');
  section.appendChild(transcript);

  const renderTurns = (): void => {
    transcript.replaceChildren();
    for (const turn of hl.thread ?? []) {
      const bubble = document.createElement('div');
      bubble.classList.add('pdf-highlight-turn', `is-${turn.role}`);
      bubble.textContent = turn.text;
      transcript.appendChild(bubble);
    }
    transcript.scrollTop = transcript.scrollHeight;
    // "Continue in Chat" only once there is something to continue.
    continueBtn.style.display = (hl.thread?.length ?? 0) > 0 ? '' : 'none';
  };
  renderTurns();

  const inputRow = document.createElement('div');
  inputRow.classList.add('pdf-highlight-ask-row');
  const input = document.createElement('textarea');
  input.classList.add('pdf-highlight-ask');
  input.rows = 1;
  input.placeholder = 'Ask about this passage…';
  input.setAttribute('aria-label', 'Ask AI about this passage');
  const sendBtn = document.createElement('button');
  sendBtn.classList.add('pdf-highlight-ask-send');
  sendBtn.innerHTML = ICON.send;
  sendBtn.setAttribute('aria-label', 'Ask AI');
  setupTooltip(sendBtn, 'Ask AI');
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  section.appendChild(inputRow);

  let streaming = false;
  const ask = async (): Promise<void> => {
    const question = input.value.trim();
    if (!question || streaming) return;
    const provider = await host.inlineAI();
    if (!provider) {
      const warn = document.createElement('div');
      warn.classList.add('pdf-highlight-turn', 'is-ai');
      warn.textContent = 'AI is not available right now.';
      transcript.appendChild(warn);
      return;
    }
    input.value = '';
    input.style.height = 'auto';
    streaming = true;

    // Save and show the question.
    (hl.thread ??= []).push({ role: 'user', text: question, at: Date.now() });
    renderTurns();
    host.save();

    // The system message anchors the passage; earlier turns give continuity.
    const messages: IChatMessage[] = [{
      role: 'system',
      content: 'You are helping a reader understand a passage from a PDF document. '
        + 'The passage is:\n\n---\n' + (hl.text || '(image selection)') + '\n---\n\n'
        + 'Answer their questions about it clearly and concisely.',
    }];
    for (const turn of hl.thread) {
      messages.push({ role: turn.role === 'ai' ? 'assistant' : 'user', content: turn.text });
    }

    const aiBubble = document.createElement('div');
    aiBubble.classList.add('pdf-highlight-turn', 'is-ai');
    transcript.appendChild(aiBubble);
    transcript.scrollTop = transcript.scrollHeight;

    const signal = host.newAISignal();
    let answer = '';
    try {
      // The model reasons first; until its answer starts, the bubble says so.
      for await (const chunk of provider.sendChatRequest(messages, { temperature: 0.4, think: true }, signal)) {
        if (signal.aborted) return;
        if (chunk.thinking && !answer) {
          aiBubble.textContent = 'Thinking…';
          aiBubble.classList.add('pdf-highlight-turn--thinking');
        }
        if (chunk.content) {
          aiBubble.classList.remove('pdf-highlight-turn--thinking');
          answer += chunk.content;
          aiBubble.textContent = answer;
          transcript.scrollTop = transcript.scrollHeight;
        }
      }
    } catch (err) {
      aiBubble.textContent = `Error: ${err instanceof Error ? err.message : 'request failed'}`;
      aiBubble.classList.add('pdf-highlight-turn-error');
      streaming = false;
      return;
    }
    if (signal.aborted) { streaming = false; return; }

    // A model can spend its whole turn reasoning and answer nothing. Say so,
    // and keep neither the question nor an empty answer in the thread.
    if (!answer.trim()) {
      aiBubble.classList.remove('pdf-highlight-turn--thinking');
      aiBubble.textContent = 'The model gave no answer. Try again.';
      aiBubble.classList.add('pdf-highlight-turn-error');
      hl.thread.pop();
      host.save();
      streaming = false;
      return;
    }

    hl.thread.push({ role: 'ai', text: answer, at: Date.now() });
    host.save();
    streaming = false;
  };

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 72) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); }
  });
  sendBtn.addEventListener('click', () => void ask());

  parent.appendChild(section);
}
