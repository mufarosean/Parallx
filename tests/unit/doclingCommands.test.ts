// doclingCommands.test.ts — the document reader's two commands: one opens its
// place in Settings, the other reads the PDF on screen again.
import { describe, expect, it, vi } from 'vitest';
import { installDocling, readDocumentAgain, DOCUMENT_READER_PANEL } from '../../src/commands/doclingCommands';
import { DOCUMENT_READER_PANEL_ID } from '../../src/built-in/settings/documentReaderPanel';
import { M70_EXCLUDED_COMMANDS } from '../../src/commands/m70CommandPolicy';
import type { CommandExecutionContext } from '../../src/commands/commandTypes';

const ctx = (services: Record<string, unknown>): CommandExecutionContext => ({ getService: <T>(id: string) => services[id] as T | undefined, workbench: null, origin: 'palette' } as unknown as CommandExecutionContext);

describe('Set Up Document Reader…', () => {
  it('opens Settings on the reader\'s own panel, and starts nothing', async () => {
    const executeCommandFrom = vi.fn(async () => undefined);
    await installDocling.handler(ctx({ ICommandService: { executeCommandFrom } }));
    expect(executeCommandFrom).toHaveBeenCalledWith('palette', 'settings.open', DOCUMENT_READER_PANEL);
    expect(DOCUMENT_READER_PANEL).toBe(DOCUMENT_READER_PANEL_ID); // the command and the panel name the same place
    expect(installDocling.title.endsWith('…')).toBe(true);
  });

  it('is out of the AI\'s reach, with the commands that set the reader up and remove it', () => {
    for (const id of ['parallx.installDocling', 'documentReader.setUp', 'documentReader.remove']) expect(M70_EXCLUDED_COMMANDS.has(id)).toBe(true);
    expect(installDocling.aiInvocable).toBeUndefined();
    expect(readDocumentAgain.aiInvocable).toBeUndefined();
  });
});

describe('Read This Document Again', () => {
  it('asks the PDF on screen to read itself again, and is there only for a PDF', async () => {
    const readWithReader = vi.fn(async () => undefined);
    await readDocumentAgain.handler(ctx({ IEditorGroupService: { activeGroup: { activePane: { readWithReader } } } }));
    expect(readWithReader).toHaveBeenCalledOnce();
    expect(readDocumentAgain.when).toBe("activeEditor == 'parallx.editor.pdf'");
  });

  it('does nothing over a pane that is not a PDF, or with no pane', async () => {
    await expect(readDocumentAgain.handler(ctx({ IEditorGroupService: { activeGroup: { activePane: {} } } }))).resolves.toBeUndefined();
    await expect(readDocumentAgain.handler(ctx({}))).resolves.toBeUndefined();
  });
});
