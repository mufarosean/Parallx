// canvasTemplates.ts — Page template gallery (M77 Phase 11.4)
//
// Provides a small set of starter templates so a new page isn't always
// an empty paragraph. Each template:
//   • has a name, short description, and emoji icon
//   • renders a TipTap doc JSON skeleton with placeholders
//
// The picker UI lives in `canvasTemplatePicker.ts`; this file holds the
// data + the API the picker consumes. Templates are pure data — they
// don't touch the DOM or DB themselves; the caller creates the page
// through CanvasDataService and seeds its content via `flushContentSave`.
//
// Why three templates, not thirty: a small curated set tells the user
// "templates exist, here are common shapes" without becoming a directory
// to scroll. Power users will copy-paste or duplicate their own pages.

export interface CanvasPageTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  /** TipTap doc JSON for the page body. */
  buildDoc(): unknown;
  /** Default title applied to the new page. */
  defaultTitle: string;
}

function todayLabel(): string {
  // YYYY-MM-DD with the user's local date (not UTC) so a 10pm note
  // doesn't get tomorrow's date in time zones west of UTC.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const CANVAS_TEMPLATES: CanvasPageTemplate[] = [
  {
    id: 'daily-note',
    name: 'Daily note',
    description: 'Date-stamped journal with three quick sections.',
    icon: '📅',
    defaultTitle: `${todayLabel()} — Daily note`,
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Focus today' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Reflection' }] },
          { type: 'paragraph' },
        ],
      };
    },
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Attendees, agenda, decisions, and action items.',
    icon: '🤝',
    defaultTitle: 'Meeting — ',
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Attendees: ' }] },
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Date: ' }, { type: 'text', text: todayLabel() }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action items' }] },
          { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ]},
        ],
      };
    },
  },
  {
    id: 'project-brief',
    name: 'Project brief',
    description: 'Goal, scope, deliverables, and timeline outline.',
    icon: '🎯',
    defaultTitle: 'Project: ',
    buildDoc(): unknown {
      return {
        type: 'doc',
        content: [
          { type: 'callout', attrs: { emoji: '💡' }, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One-sentence summary of what this project is.' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
          { type: 'paragraph' },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'In:' }, { type: 'text', text: ' ' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Out:' }, { type: 'text', text: ' ' }] }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Deliverables' }] },
          { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
          ]},
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Timeline' }] },
          { type: 'paragraph' },
        ],
      };
    },
  },
];

export function getCanvasTemplates(): readonly CanvasPageTemplate[] {
  return CANVAS_TEMPLATES;
}
