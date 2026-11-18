// progressCommands.ts — the progress-provider registry, reachable from any tool
//
// Built-ins import src/services/progressProviders.ts; an extension has only
// the `api` surface, so it runs this command and keeps the live object it
// returns (`{ register, list, onDidChange }`). The same door as
// `questions.getRegistry`, in the core so no tool is the owner.

import type { CommandDescriptor } from './commandTypes.js';
import { progressProviderRegistry } from '../services/progressProviders.js';

export const progressGetRegistry: CommandDescriptor = {
  id: 'progress.getRegistry',
  title: 'Get Progress Providers',
  category: 'Progress',
  handler: () => progressProviderRegistry,
};
