// widgetTemplates.ts — the picker's Templates rail (M86 C3).
//
// A template is a preconfigured widget recipe: type + config + refresh
// policy. One click adds a working widget instead of a blank one to
// configure. Recipes deliberately span unrelated life domains — the
// dashboard is a generic glance-and-act layer, and the gallery is where a
// new user discovers what it can be shaped into. A recipe only appears
// when its widget type is currently registered.

import type { WidgetRefreshPolicy } from './dashboardTypes.js';

export interface WidgetTemplate {
  readonly name: string;
  readonly description: string;
  readonly typeId: string;
  readonly config: Record<string, unknown>;
  readonly refreshPolicy?: WidgetRefreshPolicy;
}

export const WIDGET_TEMPLATES: readonly WidgetTemplate[] = [
  {
    name: 'Pomodoro timer',
    description: '25-minute focus sessions, logged automatically.',
    typeId: 'parallx.dashboard.timer',
    config: { minutes: 25, label: 'Focus' },
  },
  {
    name: 'Study coverage board',
    description: 'Track topics from unread to mastered. Add your syllabus as items.',
    typeId: 'parallx.dashboard.tracker',
    config: { items: [], stages: ['Unread', 'Notes', 'Practiced', 'Mastered'] },
  },
  {
    name: 'Renewals tracker',
    description: 'Insurance, warranties, subscriptions: what needs attention?',
    typeId: 'parallx.dashboard.tracker',
    config: { items: [], stages: ['Active', 'Renewal due', 'Renewed'] },
  },
  {
    name: 'Who do I call…',
    description: 'A standing answer pulled from your own documents (retrieval, no AI).',
    typeId: 'parallx.dashboard.saved-query',
    config: { query: 'Who do I call for plumbing or home repairs?', mode: 'retrieval', topK: 5 },
  },
  {
    name: 'Expiring soon (AI)',
    description: 'A background agent scans your workspace for upcoming deadlines and renewals.',
    typeId: 'parallx.dashboard.saved-query',
    config: { query: 'What deadlines, renewals, or expirations are coming up in the next 30 days?', mode: 'ai', topK: 5 },
    refreshPolicy: { kind: 'cron', cron: '0 12 * * 1' },
  },
  {
    name: 'Morning news brief',
    description: 'AI-researched local headlines, refreshed weekday mornings.',
    typeId: 'parallx.dashboard.news-brief',
    config: {},
    refreshPolicy: { kind: 'cron', cron: '0 12 * * 1-5' },
  },
  {
    name: 'Daily brief (AI)',
    description: 'One card that reads your agenda and workspace, and plans your day.',
    typeId: 'parallx.dashboard.ai-custom',
    config: {
      prompt: 'Look at my planner (today\'s tasks and events) and anything notable in my workspace, then write a short "here is your day" brief: schedule first, then the 3 most important things to do, then anything at risk. Keep it under 200 words.',
      skill: '',
    },
    refreshPolicy: { kind: 'cron', cron: '0 12 * * *' },
  },
  {
    name: 'Notes on the dashboard',
    description: 'Pin a canvas page (an index, contacts, a checklist) where you can see it.',
    typeId: 'parallx.canvas.page-embed',
    config: { page: '' },
  },
];
