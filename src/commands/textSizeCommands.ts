// textSizeCommands.ts — Text size: the app's zoom (Settings › Appearance › Text size).
//
// Five sizes, 90% to 150%, the whole window as zooming does. Ctrl+= and
// Ctrl+- step it from anywhere except a surface with its own zoom: the
// worksheet's sheet zooms its cells with the same keys, as Excel does, so
// while focus is inside it (focusOwnsZoom) they stay the sheet's; pages in
// the Browser tool bind them for the page. Ctrl+0 focuses the side bar, so
// reset is Ctrl+NumPad0 and View › Reset Text Size.

import type { CommandDescriptor } from './commandTypes.js';
import { DEFAULT_TEXT_SIZE, readAppearance, setTextSize, stepTextSize } from '../theme/pxAppearance.js';

/** The keys yield to a surface that zooms itself (FocusTracker sets the key). */
export const TEXT_SIZE_KEYBINDING_WHEN = '!focusOwnsZoom';

export const increaseTextSize: CommandDescriptor = {
  id: 'workbench.action.increaseTextSize',
  title: 'Increase Text Size',
  category: 'View',
  keybinding: 'Ctrl+=',
  keybindingWhen: TEXT_SIZE_KEYBINDING_WHEN,
  aiInvocable: true,
  aiDescription: 'Make the whole app one step larger (text, icons and spacing), up to 150%.',
  handler() {
    setTextSize(stepTextSize(readAppearance().textSize, 1));
  },
};

export const decreaseTextSize: CommandDescriptor = {
  id: 'workbench.action.decreaseTextSize',
  title: 'Decrease Text Size',
  category: 'View',
  keybinding: 'Ctrl+-',
  keybindingWhen: TEXT_SIZE_KEYBINDING_WHEN,
  aiInvocable: true,
  aiDescription: 'Make the whole app one step smaller, down to 90%.',
  handler() {
    setTextSize(stepTextSize(readAppearance().textSize, -1));
  },
};

export const resetTextSize: CommandDescriptor = {
  id: 'workbench.action.resetTextSize',
  title: 'Reset Text Size',
  category: 'View',
  keybinding: 'Ctrl+Numpad0',
  keybindingWhen: TEXT_SIZE_KEYBINDING_WHEN,
  aiInvocable: true,
  aiDescription: 'Return the app to its normal size (100%).',
  handler() {
    setTextSize(DEFAULT_TEXT_SIZE);
  },
};

/** Further keys for the same steps: '+' on its own key or with Shift, and the number pad. */
export const TEXT_SIZE_EXTRA_KEYBINDINGS: readonly { key: string; commandId: string }[] = [
  { key: 'Ctrl+Plus', commandId: increaseTextSize.id },
  { key: 'Ctrl+Shift+Plus', commandId: increaseTextSize.id },
  { key: 'Ctrl+NumpadAdd', commandId: increaseTextSize.id },
  { key: 'Ctrl+NumpadSubtract', commandId: decreaseTextSize.id },
];

export const ALL_TEXT_SIZE_COMMANDS: readonly CommandDescriptor[] = [increaseTextSize, decreaseTextSize, resetTextSize];
