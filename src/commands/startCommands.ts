// startCommands.ts — reopening something from the empty editor's Start.
//
// Start (workbenchWatermark.ts) lists the pages and files opened recently,
// from the one recency list (recentsService.ts). Each entry is a button that
// runs this command with the entry's key, so it is a command like any other:
// in the scene, recordable, and runnable by keys. Pages open through the
// canvas's own open command, files through the editor resolver tools use.

import type { CommandDescriptor } from './commandTypes.js';
import type { IEditorService } from '../services/serviceTypes.js';
import type { IRecentsServiceShape } from '../services/recentsService.js';
import { resolveFileEditorInput } from '../api/bridges/editorsBridge.js';

export const openRecentItem: CommandDescriptor = {
  id: 'workbench.action.openRecentItem',
  title: 'Open Recent Item',
  category: 'File',
  async handler(ctx, key?: unknown) {
    const recents = ctx.getService<IRecentsServiceShape>('IRecentsService');
    const opens = recents?.getRecentOpens() ?? [];
    // With no key (the palette), the most recent one.
    const item = typeof key === 'string' ? opens.find((r) => r.key === key) : opens[0];
    if (!item) return;
    if (item.kind === 'page') {
      const commands = ctx.getService<{ executeCommand(id: string, ...args: unknown[]): Promise<unknown> }>('ICommandService');
      await commands?.executeCommand('canvas.openPage', item.target);
      return;
    }
    const input = await resolveFileEditorInput(item.target);
    if (input) await ctx.getService<IEditorService>('IEditorService')?.openEditor(input, { pinned: false });
  },
};
