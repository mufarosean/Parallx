// modelCallsCommands.ts — AI: Show Model Calls, and the dialog's two actions.
//
// The ledger is the language-models service's (every model call goes
// through its engine broker); the dialog is modelCallsView.ts. Clear and
// Close are commands so the dialog's buttons are declared controls, and
// Clear also works from the palette.

import type { CommandDescriptor, CommandExecutionContext } from './commandTypes.js';
import type { IToolRegistryService } from '../services/serviceTypes.js';
import type { IModelCallLedger } from '../services/modelCallLedger.js';
import { closeModelCallsDialog, showModelCallsDialog } from './modelCallsView.js';

function ledgerOf(ctx: CommandExecutionContext): IModelCallLedger | undefined {
  const lms = ctx.getService<{ getCallLedger?(): IModelCallLedger }>('ILanguageModelsService');
  return lms?.getCallLedger?.();
}

export const showModelCalls: CommandDescriptor = {
  id: 'chat.showModelCalls',
  title: 'Show Model Calls',
  category: 'AI',
  handler(ctx) {
    const ledger = ledgerOf(ctx);
    if (!ledger) return;
    const registry = ctx.getService<IToolRegistryService>('IToolRegistryService');
    showModelCallsDialog(ledger, (toolId) => registry?.getById(toolId)?.description.manifest.name || undefined);
  },
};

export const clearModelCalls: CommandDescriptor = {
  id: 'chat.clearModelCalls',
  title: 'Clear Model Calls',
  category: 'AI',
  handler(ctx) {
    ledgerOf(ctx)?.clear();
  },
};

export const closeModelCalls: CommandDescriptor = {
  id: 'chat.closeModelCalls',
  title: 'Close Model Calls',
  category: 'AI',
  handler() {
    closeModelCallsDialog();
  },
};
