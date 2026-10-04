// searchEmptyStates.ts — Search's own empty-state line. It stays with Search
// (not in the core's ui/emptyStates.ts), held to the same voice rules by
// emptyStates.test.ts.

import type { EmptyStateEntry } from '../../ui/emptyStates.js';

export const SEARCH_EMPTY_STATES = {
  noResults: {
    id: 'search.noResults',
    icon: 'search',
    headline: 'No matches for that',
    hint: 'Try fewer words or a different phrasing. Search covers file contents, not just names.',
  },
} as const satisfies Record<string, EmptyStateEntry>;
