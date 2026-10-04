// chatContributions.ts — chat slash commands, skills and drop handlers tools bring
//
// A tool adds to the chat while it runs: a slash command, a skill, or a
// handler for its own drag data dropped on the chat input. Turned off, all
// go. Nothing is written into the workspace: a contributed skill
// lives here, beside the ones the user keeps in .parallx/skills/ (which win
// on a name clash).
//
// Module-global hub (contributions survive activation order), fed through
// the per-tool API (apiFactory: api.chat.registerSlashCommand / registerSkill
// / registerDropHandler) and read by the command registries, the skill loader
// and the chat input.

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

// ── Drop handlers: drags a tool's own views start, accepted by the chat input ──
//
// The chat input attaches dropped files (file URIs, absolute paths, OS file
// drags) by itself. A tool whose views drag their own data type (say, items
// from a library) registers a handler for that type while it runs: the input
// then accepts the drag, and when the drop carried no file it could attach,
// the handler says what to attach or what to tell the user.

/** What a drop handler makes of a drop. */
export interface ChatDropResult {
  /** Absolute file paths to attach. */
  readonly paths?: readonly string[];
  /** A message shown in the input when nothing could be attached. */
  readonly warning?: string;
}

export interface ContributedChatDropHandler {
  /** The drag data type it handles (e.g. `application/x-mytool-items`). */
  readonly mimeType: string;
  /** Called with the drag's data of that type, read when the drop happened. */
  resolve(data: string): ChatDropResult | undefined | Promise<ChatDropResult | undefined>;
  readonly ownerToolId: string;
}

const _dropHandlers: ContributedChatDropHandler[] = [];

const MIME = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

export function registerChatDropHandler(handler: ContributedChatDropHandler): IDisposable {
  if (!handler || typeof handler.mimeType !== 'string' || !MIME.test(handler.mimeType)) {
    throw new Error(`[api.chat] Drop handler type "${String(handler?.mimeType)}" must be a media type like "application/x-name".`);
  }
  if (typeof handler.resolve !== 'function') throw new Error(`[api.chat] Drop handler for "${handler.mimeType}" needs resolve().`);
  const entry: ContributedChatDropHandler = { ...handler, mimeType: handler.mimeType.toLowerCase() };
  _dropHandlers.push(entry);
  _onDidChange.fire();
  return toDisposable(() => {
    const i = _dropHandlers.indexOf(entry);
    if (i >= 0) { _dropHandlers.splice(i, 1); _onDidChange.fire(); }
  });
}

/** The registered handlers for any of these drag types, in registration order. */
export function getChatDropHandlers(types?: readonly string[]): readonly ContributedChatDropHandler[] {
  if (!types) return [..._dropHandlers];
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  return _dropHandlers.filter((h) => wanted.has(h.mimeType));
}
