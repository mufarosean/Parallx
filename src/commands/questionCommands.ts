// questionCommands.ts — the question-provider registry, reachable from any tool
//
// Built-ins import src/services/questionProviders.ts; an extension has only
// the `api` surface, so it runs this command and keeps the live object it
// returns (`{ register, list, onDidChange }`). Same shape as the registries
// tools expose for each other, now in the core so no tool is the owner.

import type { CommandDescriptor } from './commandTypes.js';
import { questionProviderRegistry } from '../services/questionProviders.js';

export const questionsGetRegistry: CommandDescriptor = {
  id: 'questions.getRegistry',
  title: 'Get Question Providers',
  category: 'Questions',
  handler: () => questionProviderRegistry,
};
