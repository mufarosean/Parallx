// databaseCommandStub.ts — the kit's command service, for tests of the
// database editor: a button that declares a database command runs it on
// the active pane, as the app's command service does.
import { installKitCommands } from '../../src/ui/kitCommands';
import { executeDatabaseCommand } from '../../src/built-in/canvas/database/databaseCommands';

export function installDatabaseCommandStub(extra?: (id: string, args: unknown[]) => unknown): void {
  installKitCommands({
    executeCommand: async (id: string, ...args: unknown[]) => {
      if (executeDatabaseCommand(id, args)) return undefined;
      return extra?.(id, args);
    },
  });
}
