// chatContributions.ts — chat slash commands and skills tools bring
//
// A tool adds to the chat while it runs: a slash command or a skill. Turned
// off, both go. Nothing is written into the workspace: a contributed skill
// lives here, beside the ones the user keeps in .parallx/skills/ (which win
// on a name clash).
//
// Module-global hub (contributions survive activation order), fed through
// the per-tool API (apiFactory: api.chat.registerSlashCommand / registerSkill)
// and read by the command registries and the skill loader.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

export interface ContributedSlashCommand {
  readonly name: string;
  readonly description: string;
  /** The prompt sent for `/name <input>`; `{input}` is replaced. */
  readonly promptTemplate: string;
  readonly ownerToolId: string;
}

export interface ContributedSkill {
  /** The SKILL.md content (frontmatter + body), as a skill file would hold it. */
  readonly content: string;
  readonly ownerToolId: string;
}

const _commands = new Map<string, ContributedSlashCommand>();
const _skills = new Map<string, ContributedSkill>();
const _onDidChange = new Emitter<void>();

/** Fires when a tool adds or removes a command or a skill. */
export const onDidChangeChatContributions: Event<void> = _onDidChange.event;

export function getContributedSlashCommands(): readonly ContributedSlashCommand[] {
  return [..._commands.values()];
}

export function getContributedSlashCommand(name: string): ContributedSlashCommand | undefined {
  return _commands.get(name);
}

export function getContributedSkills(): readonly ContributedSkill[] {
  return [..._skills.values()];
}

const NAME = /^[a-z][a-z0-9-]{0,40}$/;

export function registerContributedSlashCommand(cmd: ContributedSlashCommand): IDisposable {
  if (!cmd || !NAME.test(cmd.name)) throw new Error(`[api.chat] Slash command name "${String(cmd?.name)}" must be lowercase letters, digits and dashes.`);
  if (typeof cmd.promptTemplate !== 'string' || !cmd.promptTemplate) throw new Error(`[api.chat] /${cmd.name} needs a promptTemplate.`);
  const existing = _commands.get(cmd.name);
  if (existing && existing.ownerToolId !== cmd.ownerToolId) throw new Error(`[api.chat] /${cmd.name} is already registered by "${existing.ownerToolId}".`);
  const entry = { ...cmd, description: String(cmd.description ?? '') };
  _commands.set(cmd.name, entry);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_commands.get(cmd.name) === entry) { _commands.delete(cmd.name); _onDidChange.fire(); }
  });
}

/** `name` is the skill's frontmatter name (the key the skill loader uses). */
export function registerContributedSkill(name: string, skill: ContributedSkill): IDisposable {
  if (!NAME.test(name)) throw new Error(`[api.chat] Skill name "${name}" must be lowercase letters, digits and dashes.`);
  const existing = _skills.get(name);
  if (existing && existing.ownerToolId !== skill.ownerToolId) throw new Error(`[api.chat] Skill "${name}" is already registered by "${existing.ownerToolId}".`);
  const entry = { ...skill };
  _skills.set(name, entry);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_skills.get(name) === entry) { _skills.delete(name); _onDidChange.fire(); }
  });
}

/**
 * A contributed skill's content by its skills path (`.parallx/skills/<name>/SKILL.md`):
 * the model reads a skill by its location, and a tool's skill has no file.
 */
export function contributedSkillFile(path: string): string | undefined {
  const m = /^\.parallx\/skills\/([a-z][a-z0-9-]{0,40})\/SKILL\.md$/.exec(String(path).replace(/\\/g, '/').replace(/^\.\//, ''));
  return m ? _skills.get(m[1])?.content : undefined;
}
