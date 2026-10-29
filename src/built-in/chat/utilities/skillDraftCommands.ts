// skillDraftCommands.ts — reviewing the skills the AI drafted.
//
// docs/SKILL_AUTHORING_BRIEF.md step 2. Drafts sit in
// .parallx/skills/_drafts/<name>/ (tools/skillDraftTool.ts), where the skill
// loader never looks. These commands serve any view that lists them, with the
// three verbs suggested routines use:
//
//   parallx.skills.drafts         → { available, drafts: [{ name, description, derivedFrom }] }
//   parallx.skills.openDraft      (name) → opens its SKILL.md to read or edit
//   parallx.skills.addDraft       (name) → moves it into .parallx/skills, where the loader picks it up
//   parallx.skills.dismissDraft   (name) → moves the draft to the trash
//
// The agent never adds its own draft; only these commands, run by you, do.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { URI } from '../../../platform/uri.js';
import { parseSkillFrontmatter } from '../../../services/skillLoaderService.js';

export interface ISkillDraftRow {
  readonly name: string;
  readonly description: string;
  /** The chat it was drafted in, when recorded. */
  readonly derivedFrom?: string;
}

interface IDraftFiles {
  exists(uri: URI): Promise<boolean>;
  readdir(uri: URI): Promise<readonly { name: string; type: number | string }[]>;
  readFile(uri: URI): Promise<{ content: string }>;
  rename(source: URI, target: URI): Promise<void>;
  delete(uri: URI, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void>;
}

interface ICommandRegistry {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
}

const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
const nameOf = (raw: unknown): string => {
  const n = typeof raw === 'string' ? raw : typeof (raw as { name?: unknown })?.name === 'string' ? (raw as { name: string }).name : '';
  return NAME.test(n.trim()) ? n.trim() : '';
};

export function registerSkillDraftCommands(
  commands: ICommandRegistry,
  files: IDraftFiles | undefined,
  root: () => URI | undefined,
  open: (uri: string) => void,
): IDisposable[] {
  const skills = () => root()?.joinPath('.parallx', 'skills');
  const draft = (name: string) => skills()?.joinPath('_drafts', name);

  const list = async (): Promise<ISkillDraftRow[]> => {
    const dir = skills()?.joinPath('_drafts');
    if (!files || !dir || !(await files.exists(dir))) return [];
    const rows: ISkillDraftRow[] = [];
    for (const entry of await files.readdir(dir)) {
      if (!NAME.test(entry.name)) continue;
      const file = dir.joinPath(entry.name, 'SKILL.md');
      if (!(await files.exists(file))) continue;
      const fm = parseSkillFrontmatter((await files.readFile(file)).content)?.frontmatter ?? {};
      const derived = fm['derived-from'];
      rows.push({ name: entry.name, description: String(fm['description'] ?? ''), ...(typeof derived === 'string' ? { derivedFrom: derived } : {}) });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };

  return [
    commands.registerCommand('parallx.skills.drafts', async () =>
      files && root() ? { available: true, drafts: await list() } : { available: false, drafts: [] }),
    commands.registerCommand('parallx.skills.openDraft', (raw: unknown) => {
      const name = nameOf(raw);
      const file = name ? draft(name)?.joinPath('SKILL.md') : undefined;
      if (!file) return false;
      open(file.toString());
      return true;
    }),
    commands.registerCommand('parallx.skills.addDraft', async (raw: unknown) => {
      const name = nameOf(raw);
      const from = name ? draft(name) : undefined;
      const to = name ? skills()?.joinPath(name) : undefined;
      if (!files || !from || !to || !(await files.exists(from))) return { added: false, reason: 'There is no such draft.' };
      if (await files.exists(to)) return { added: false, reason: `A skill named "${name}" already exists. Rename the draft first.` };
      await files.rename(from, to);
      return { added: true };
    }),
    commands.registerCommand('parallx.skills.dismissDraft', async (raw: unknown) => {
      const name = nameOf(raw);
      const from = name ? draft(name) : undefined;
      if (!files || !from || !(await files.exists(from))) return false;
      await files.delete(from, { recursive: true, useTrash: true });
      return true;
    }),
  ];
}
