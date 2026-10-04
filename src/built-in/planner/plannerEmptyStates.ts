// plannerEmptyStates.ts — Planner's own empty-state lines. They stay with
// Planner (not in the core's ui/emptyStates.ts), held to the same voice rules
// by emptyStates.test.ts.

import type { EmptyStateEntry } from '../../ui/emptyStates.js';

export const PLANNER_EMPTY_STATES = {
  day: {
    id: 'planner.day',
    icon: 'calendar',
    headline: 'A clear day',
    hint: 'Capture a task with Create, or ask the AI in chat. New tasks land in the review queue so you never break flow to plan.',
  },
  filter: {
    id: 'planner.filter',
    icon: 'filter',
    headline: 'All clear on this view',
    hint: 'No tasks match this filter. Switch views above, or click Create to capture something new.',
  },
} as const satisfies Record<string, EmptyStateEntry>;
