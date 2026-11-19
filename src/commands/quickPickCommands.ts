// quickPickCommands.ts — the buttons of a quick pick of several, as commands
//
// The pick's Cancel and its confirming button run these, so they are what a
// keybinding, the palette or the model reaches too. Each acts on the pick of
// several in front (src/api/quickPickMany.ts); with none open it does nothing.

import type { CommandDescriptor } from './commandTypes.js';
import { acceptQuickPickMany, cancelQuickPickMany } from '../api/quickPickMany.js';

export const quickPickAccept: CommandDescriptor = {
  id: 'quickPick.accept',
  title: 'Accept the Ticked Items',
  category: 'Quick Pick',
  handler: () => { acceptQuickPickMany(); },
};

export const quickPickCancel: CommandDescriptor = {
  id: 'quickPick.cancel',
  title: 'Close the Pick',
  category: 'Quick Pick',
  handler: () => { cancelQuickPickMany(); },
};
