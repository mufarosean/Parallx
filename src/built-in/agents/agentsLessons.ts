// agentsLessons.ts — Mind in Agents: what the agent has written down.
//
// docs/MEMORY_BRIEF.md step 2. The lessons the agent keeps in
// .parallx/memory (one file each, listed in MEMORY.md), with where each came
// from, and three things you can do: open it, say it is wrong (it is archived
// and the agent is told), or archive it. The files stay the truth; the core's
// parallx.memory.* commands read and change them. Nothing is deleted.

import { appDateString } from '../../services/localTime.js';
import { createButton, createEmptyState, createIconButton, createRow, createSection, createSurface } from '../../ui/kit.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ParallxApi } from './agentsServices.js';

interface ILessonRow {
  slug: string;
  description: string;
  sources: { date: string; session?: string }[];
}

/** Where a lesson came from, in words. Test seam. */
export function lessonOrigin(sources: readonly { date: string; session?: string }[]): string {
  if (!sources.length) return 'Written before sources were kept';
  const day = (iso: string) => appDateString(new Date(`${iso}T12:00:00`), { day: 'numeric', month: 'short', year: 'numeric' });
  const first = sources[0], last = sources[sources.length - 1];
  return sources.length === 1 ? `From a chat on ${day(first.date)}` : `From ${sources.length} chats, ${day(first.date)} to ${day(last.date)}`;
}

/**
 * The buttons run these, then the tab repaints. Agents registers them (a
 * button with a command is in the palette's reach; one with a click handler
 * is not), each calling the core command it names.
 */
export function registerLessonCommands(api: ParallxApi, refresh: () => void): IDisposable[] {
  const via = (core: string) => async (slug: unknown) => {
    const done = await api.commands.executeCommand(core, slug).catch(() => false);
    if (core !== 'parallx.memory.openLesson') refresh();
    return done;
  };
  return [
    api.commands.registerCommand('agents.lesson.open', via('parallx.memory.openLesson')),
    api.commands.registerCommand('agents.lesson.wrong', via('parallx.memory.lessonWrong')),
    api.commands.registerCommand('agents.lesson.archive', via('parallx.memory.archiveLesson')),
  ];
}

/** Draws the section into `host`; settles once the lessons are read. */
export function renderLessons(host: HTMLElement, api: ParallxApi): Promise<void> {
  const sec = createSection(host, 'What it has written down', 'agents-section');
  return api.commands.executeCommand<{ available?: boolean; lessons?: ILessonRow[] }>('parallx.memory.lessons').then((r) => {
    const lessons = r?.lessons ?? [];
    if (!r?.available || !lessons.length) {
      createEmptyState(sec, {
        headline: r?.available === false ? 'No workspace folder is open' : 'Nothing yet',
        hint: r?.available === false
          ? 'Its lessons live in the workspace folder.'
          : 'When the agent learns something worth keeping (a correction, a way you work), it writes a lesson and it shows here.',
      });
      return;
    }
    for (const l of lessons) {
      const name = l.description || l.slug;
      const row = createRow(sec, {
        name, detail: lessonOrigin(l.sources),
        detailTitle: l.sources.map((s) => `${s.date}${s.session ? ` · chat ${s.session}` : ''}`).join('\n') || undefined,
      });
      createSurface(row, { id: 'agents.lesson', owner: 'agents', label: name.length > 60 ? `${name.slice(0, 59)}…` : name, instance: l.slug });
      createIconButton(row, { id: 'agents.lesson.open', command: 'agents.lesson.open', args: [l.slug], icon: 'file-text', size: 'sm', title: 'Open the Lesson File' });
      createButton(row, { id: 'agents.lesson.wrong', command: 'agents.lesson.wrong', args: [l.slug], label: 'Wrong', icon: 'thumbs-down', kind: 'ghost', size: 'sm', title: 'Archive it and tell the agent not to rely on it' });
      createIconButton(row, { id: 'agents.lesson.archive', command: 'agents.lesson.archive', args: [l.slug], icon: 'archive', size: 'sm', title: 'Archive (kept in .parallx/memory/_archive)' });
    }
  }).catch(() => undefined);
}
