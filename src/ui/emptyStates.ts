// emptyStates.ts — the app's voice registry for blank surfaces (M89 S2).
//
// Empty states are the app's speaking moments (Slack/Duolingo school —
// see docs/Parallx_Milestone_89.md): the one place a blank panel either
// feels cared-for or utilitarian. Every core surface's line lives HERE so the
// voice stays consistent, greppable, and testable. Surfaces either render
// through `renderEmptyState()` (standard hero) or import their entry's
// strings when they own a custom layout (canvas sidebar, chat).
//
// A tool that can be turned off keeps its own lines (an `EmptyStateEntry`
// next to its code, rendered with `renderEmptyStateEntry`), so no core copy
// names a tool the user may not have. emptyStates.test.ts holds those to
// the same voice rules.
//
// Voice rules (enforced by emptyStates.test.ts):
//   - headline: warm, ≤ 6 words, no terminal period, never "Nothing here"
//     / "No data" / "N/A" (the anti-voice list);
//   - hint: one sentence that ALWAYS names the next action — a key, a
//     button, or a concrete verb ("press C", "click Create", "ask the AI").

export interface EmptyStateEntry {
  readonly id: string;
  /** Lucide icon name (surfaces that render an icon slot use it). */
  readonly icon?: string;
  readonly headline: string;
  readonly hint: string;
}

export const EMPTY_STATES = {
  'canvas.noPages': {
    id: 'canvas.noPages',
    icon: 'file-text',
    headline: 'Start your knowledge base',
    hint: 'Pages are blocks of text, lists, headings, images, and more. Nest pages to build a tree of notes.',
  },
  'chat.newSession': {
    id: 'chat.newSession',
    icon: 'px-ai-mark',
    // Says something only this app can say. "How can I help you?" / "What are
    // we working on?" are what every other assistant opens with.
    headline: 'What’s open is in reach',
    // Every claim here is true: the open editor's selection and the current
    // canvas block are auto-attached to a turn, and pages/files are reachable
    // through retrieval and @mentions.
    hint: 'Ask about your files, pages, or whatever you have selected. The selection comes along automatically.',
  },
  'chat.sessions': {
    id: 'chat.sessions',
    icon: 'px-ai-mark',
    headline: 'Your chats live here',
    hint: 'Start a conversation below. Saved sessions appear here.',
  },
  'chat.models': {
    id: 'chat.models',
    icon: 'cpu',
    headline: 'Bring a model online',
    hint: 'Try `ollama pull llama3.2` in a terminal, or enable a cloud provider in AI settings.',
  },
  'toolGallery.empty': {
    id: 'toolGallery.empty',
    icon: 'blocks',
    headline: 'Extensions live here',
    hint: 'Drop a tool folder into ext/ and new tools appear here automatically.',
  },
  'toolGallery.filter': {
    id: 'toolGallery.filter',
    icon: 'filter',
    headline: 'No tools match that',
    hint: 'Try fewer words, or switch the filter back to Installed.',
  },
} as const satisfies Record<string, EmptyStateEntry>;

export type EmptyStateId = keyof typeof EMPTY_STATES;

/**
 * Standard empty-state hero: icon slot (caller may swap in an SVG), a
 * headline, and a hint. Styling in ui.css (`.px-empty*`) — semantic tokens
 * only, informational-opacity text per the Linear hierarchy rule.
 */
export function renderEmptyState(id: EmptyStateId): HTMLElement {
  return renderEmptyStateEntry(EMPTY_STATES[id]);
}

/** The same hero for an entry a tool keeps itself. */
export function renderEmptyStateEntry(entry: EmptyStateEntry): HTMLElement {
  const root = document.createElement('div');
  root.className = 'px-empty';
  root.dataset.emptyStateId = entry.id;

  const headline = document.createElement('div');
  headline.className = 'px-empty__headline';
  headline.textContent = entry.headline;
  root.appendChild(headline);

  const hint = document.createElement('div');
  hint.className = 'px-empty__hint';
  hint.textContent = entry.hint;
  root.appendChild(hint);

  return root;
}
