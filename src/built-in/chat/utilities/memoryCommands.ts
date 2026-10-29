// memoryCommands.ts — the agent's lessons, readable and correctable by you.
//
// docs/MEMORY_BRIEF.md step 2. The lessons the agent writes
// (.parallx/memory/lessons, indexed in MEMORY.md) had no surface: the only
// way to read or fix what it had written down was to open hidden files.
// These commands serve any view that shows them (Agents' Mind tab draws
// them); the files stay the truth.
//
//   parallx.memory.lessons        → { available, lessons: [{ slug, description, sources }] }
//   parallx.memory.openLesson     (slug) → opens its file in the editor
//   parallx.memory.archiveLesson  (slug) → moves it to _archive, out of the index
//   parallx.memory.lessonWrong    (slug) → archives it and tells the agent, in
//                                          today's daily file, not to rely on it
//
// Nothing here deletes: an archived lesson stays in .parallx/memory/_archive.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { IWorkspaceMemoryService } from '../../../services/types/workspace.js';
import { readLesson, type ILessonSource } from '../../../services/lessonProvenance.js';

export interface IMemoryLessonRow {
  readonly slug: string;
  readonly description: string;
  readonly sources: readonly ILessonSource[];
}

interface ICommandRegistry {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
}

const slugOf = (raw: unknown): string => (typeof raw === 'string' ? raw : typeof (raw as { slug?: unknown })?.slug === 'string' ? (raw as { slug: string }).slug : '').trim();

/** The lessons, index order first, then any lesson file the index does not list. */
export async function listLessons(memory: IWorkspaceMemoryService): Promise<IMemoryLessonRow[]> {
  const index = await memory.parseMemoryIndex();
  const slugs = [...index.map((e) => e.slug)];
  for (const slug of await memory.listLessons()) if (!slugs.includes(slug)) slugs.push(slug);
  const rows: IMemoryLessonRow[] = [];
  for (const slug of slugs) {
    const text = await memory.readLessonFile(slug).catch(() => '');
    if (!text.trim()) continue;
    rows.push({ slug, description: index.find((e) => e.slug === slug)?.description ?? '', sources: readLesson(text).sources });
  }
  return rows;
}

export function registerMemoryCommands(commands: ICommandRegistry, memory: IWorkspaceMemoryService | undefined, open?: (uri: string) => void): IDisposable[] {
  const archive = async (slug: string): Promise<boolean> => {
    if (!memory || !slug) return false;
    const archived = await memory.archiveLessonFile(slug);
    await memory.removeMemoryIndexEntry(slug);
    return archived;
  };
  return [
    commands.registerCommand('parallx.memory.lessons', async () =>
      memory ? { available: true, lessons: await listLessons(memory) } : { available: false, lessons: [] }),
    commands.registerCommand('parallx.memory.openLesson', (raw: unknown) => {
      const slug = slugOf(raw);
      const uri = slug ? memory?.memoryRoot?.joinPath('lessons', `${slug}.md`) : undefined;
      if (!uri || !open) return false;
      open(uri.toString());
      return true;
    }),
    commands.registerCommand('parallx.memory.archiveLesson', (raw: unknown) => archive(slugOf(raw))),
    commands.registerCommand('parallx.memory.lessonWrong', async (raw: unknown) => {
      const slug = slugOf(raw);
      if (!memory || !slug) return false;
      const description = (await memory.parseMemoryIndex()).find((e) => e.slug === slug)?.description;
      const archived = await archive(slug);
      // The correction is a lesson too: the next turn reads today's file.
      await memory.appendDailyMemory(`- The user marked the lesson "${description || slug}" wrong. It is archived: do not rely on it, and do not write it again without new evidence.`);
      return archived;
    }),
  ];
}
