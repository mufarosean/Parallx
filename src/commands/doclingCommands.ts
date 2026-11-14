// doclingCommands.ts — the document reader's commands.
//
// The reader (Docling, with its scan reader) runs in an engine Parallx sets
// up itself (electron/doclingRuntime.cjs). Where that engine stands, its
// set-up with its progress, and removing it live in Settings, in the Document
// Reader panel (built-in/settings/documentReaderPanel.ts): Set Up Document
// Reader… opens it there. How one document was read lives in the PDF view's
// Reading side: Read This Document Again asks the reader for the PDF on
// screen.

import type { CommandDescriptor } from './commandTypes.js';
import type { ICommandService, IEditorGroupService } from '../services/serviceTypes.js';

/** The Settings panel the reader lives in (built-in/settings/documentReaderPanel.ts). */
export const DOCUMENT_READER_PANEL = 'document-reader';

export const installDocling: CommandDescriptor = {
  id: 'parallx.installDocling',
  title: 'Set Up Document Reader…',
  category: 'Parallx',
  handler: async (ctx) => {
    // The origin goes with it, so the palette or the button that asked is what the journal shows.
    await ctx.getService<ICommandService>('ICommandService')?.executeCommandFrom(ctx.origin, 'settings.open', DOCUMENT_READER_PANEL);
  },
};

export const readDocumentAgain: CommandDescriptor = {
  id: 'pdf.readAgain',
  title: 'Read This Document Again',
  category: 'PDF',
  when: "activeEditor == 'parallx.editor.pdf'",
  handler: async (ctx) => {
    const pane = ctx.getService<IEditorGroupService>('IEditorGroupService')?.activeGroup?.activePane as { readWithReader?: () => Promise<void> } | undefined;
    await pane?.readWithReader?.();
  },
};
