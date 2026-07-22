// emptyStates.ts — the app's voice registry for blank surfaces (M89 S2).
//
// Empty states are the app's speaking moments (Slack/Duolingo school —
// see docs/Parallx_Milestone_89.md): the one place a blank panel either
// feels cared-for or utilitarian. EVERY empty-state line lives HERE so the
// voice stays consistent, greppable, and testable. Surfaces either render
// through `renderEmptyState()` (standard hero) or import their entry's
// strings when they own a custom layout (canvas sidebar, chat).
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
  'planner.day': {
    id: 'planner.day',
    icon: 'calendar',
    headline: 'A clear day',
    hint: 'Capture a task with Create, or ask the AI in chat. New tasks land in the review queue so you never break flow to plan.',
  },
  'planner.filter': {
    id: 'planner.filter',
    icon: 'filter',
    headline: 'All clear on this view',
    hint: 'No tasks match this filter. Switch views above, or click Create to capture something new.',
  },
  'planner.automations': {
    id: 'planner.automations',
    icon: 'zap',
    headline: 'Put the app to work',
    hint: 'Click New automation and describe the job: refresh a dashboard each morning, post a daily digest. The AI runs it on schedule.',
  },
  'search.noResults': {
    id: 'search.noResults',
    icon: 'search',
    headline: 'No matches for that',
    hint: 'Try fewer words or a different phrasing. Search covers file contents, not just names.',
  },
  'canvas.noPages': {
    id: 'canvas.noPages',
    icon: 'file-text',
    headline: 'Start your knowledge base',
    hint: 'Pages are blocks of text, lists, headings, images, and more. Nest pages to build a tree of notes.',
  },
  'chat.newSession': {
    id: 'chat.newSession',
    icon: 'px-ai-mark',
    headline: 'How can I help you?',
    hint: 'Ask about your notes, plan your day, or say "watch this for me" to set a standing watch.',
  },
  'autonomyLog.empty': {
    id: 'autonomyLog.empty',
    icon: 'heart-pulse',
    headline: 'All quiet so far',
    hint: 'When the assistant acts on its own (heartbeat findings, scheduled runs), the receipts appear here.',
  },
  'mind.noBeliefs': {
    id: 'mind.noBeliefs',
    icon: 'brain',
    headline: 'No beliefs yet',
    hint: 'The agent forms them as it reviews your work. Check back after a few sessions.',
  },
  'chat.sessions': {
    id: 'chat.sessions',
    icon: 'message-circle',
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
  'welcome.recent': {
    id: 'welcome.recent',
    icon: 'history',
    headline: 'A fresh start',
    hint: 'Files and workspaces you open appear here.',
  },
} as const satisfies Record<string, EmptyStateEntry>;

export type EmptyStateId = keyof typeof EMPTY_STATES;

/**
 * Standard empty-state hero: icon slot (caller may swap in an SVG), a
 * headline, and a hint. Styling in ui.css (`.px-empty*`) — semantic tokens
 * only, informational-opacity text per the Linear hierarchy rule.
 */
export function renderEmptyState(id: EmptyStateId): HTMLElement {
  const entry = EMPTY_STATES[id];
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
