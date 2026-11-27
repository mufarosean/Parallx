// navigationCommands.ts — Go Back and Go Forward: one record of where he has
// been, across tools and tabs (services/navigationHistory.ts). Alt+Left and
// Alt+Right; the mouse's side buttons and the arrows at the start of the bar
// under the tabs run the same. A tool that keeps Alt+Left for itself while
// its tab is in front binds it with a when-clause, which wins while it holds.

import type { CommandDescriptor } from './commandTypes.js';
import { navigationHistory } from '../services/navigationHistory.js';

export const GO_BACK_COMMAND = 'workbench.action.navigateBack';
export const GO_FORWARD_COMMAND = 'workbench.action.navigateForward';

export const goBack: CommandDescriptor = {
  id: GO_BACK_COMMAND,
  title: 'Go Back',
  category: 'Go',
  keybinding: 'Alt+Left',
  aiInvocable: true,
  aiDescription: 'Go back to where the user was before: the previous tab, page or place, across tools.',
  handler: () => navigationHistory.back(),
};

export const goForward: CommandDescriptor = {
  id: GO_FORWARD_COMMAND,
  title: 'Go Forward',
  category: 'Go',
  keybinding: 'Alt+Right',
  aiInvocable: true,
  aiDescription: 'Go forward again, after going back.',
  handler: () => navigationHistory.forward(),
};

export const ALL_NAVIGATION_COMMANDS: CommandDescriptor[] = [goBack, goForward];
