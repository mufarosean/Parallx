import type {
  IChatSlashCommand,
  IDefaultParticipantServices,
  IUserCommandFileSystem,
} from '../chatTypes.js';
import { SlashCommandRegistry, parseSlashCommand } from '../config/chatSlashCommands.js';
import { loadUserCommands } from './userCommandLoader.js';

export interface IDefaultCommandRegistryFacade {
  readonly registry: SlashCommandRegistry;
  readonly parseSlashCommand: (text: string) => ReturnType<typeof parseSlashCommand>;
  readonly applyCommandTemplate: (command: IChatSlashCommand, input: string, contextContent: string) => string | undefined;
}

function registerUserCommands(
  registry: SlashCommandRegistry,
  userCommandFileSystem?: IUserCommandFileSystem,
): void {
  if (!userCommandFileSystem) {
    return;
  }

  loadUserCommands(userCommandFileSystem).then((commands) => {
    if (commands.length > 0) {
      registry.registerCommands(commands);
    }
  }).catch(() => {
    // Best-effort loading for user commands.
  });
}

function registerWorkflowSkillCommands(
  registry: SlashCommandRegistry,
  services: Pick<IDefaultParticipantServices, 'getWorkflowSkillCatalog'>,
): void {
  const catalog = services.getWorkflowSkillCatalog?.() ?? [];
  const skillCommands = catalog
    .filter((skill) => skill.kind === 'workflow')
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      promptTemplate: '',
      isBuiltIn: false,
      specialHandler: 'skill',
    }));

  if (skillCommands.length > 0) {
    registry.registerCommands(skillCommands);
  }
}

export function createDefaultCommandRegistry(
  services: Pick<IDefaultParticipantServices, 'userCommandFileSystem' | 'getWorkflowSkillCatalog'>,
): IDefaultCommandRegistryFacade {
  const registry = new SlashCommandRegistry();

  registerUserCommands(registry, services.userCommandFileSystem);
  registerWorkflowSkillCommands(registry, services);

  return {
    registry,
    parseSlashCommand: (text) => parseSlashCommand(text, registry),
    applyCommandTemplate: (command, input, contextContent) => registry.applyTemplate(command, input, contextContent),
  };
}