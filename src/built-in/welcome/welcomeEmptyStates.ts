// welcomeEmptyStates.ts — the Welcome page's own empty-state line. It stays
// with Welcome (not in the core's ui/emptyStates.ts), held to the same voice
// rules by emptyStates.test.ts.

import type { EmptyStateEntry } from '../../ui/emptyStates.js';

export const WELCOME_EMPTY_STATES = {
  recent: {
    id: 'welcome.recent',
    icon: 'history',
    headline: 'A fresh start',
    hint: 'Files and workspaces you open appear here.',
  },
} as const satisfies Record<string, EmptyStateEntry>;
