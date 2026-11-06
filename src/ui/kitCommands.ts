// kitCommands.ts — how the kit's controls run commands: the command service,
// installed once at boot (re-exported by kit.ts).

import type { IKitCommandAction } from './kit.js';

type CommandRunner = (id: string, ...args: unknown[]) => Promise<unknown>;
let _runCommand: CommandRunner | undefined;

/** Called once at boot with the command service, so a control can run a command by id. */
export function installKitCommands(service: { executeCommand(id: string, ...args: unknown[]): Promise<unknown> }): void {
  _runCommand = (id, ...args) => service.executeCommand(id, ...args);
}

/** Run a command by id from a surface that is not a kit control (a menu item, say). */
export function runKitCommand(command: string, ...args: unknown[]): void { runCommand({ command, args }); }

/** Run a command action (the kit's controls call this). */
export function runCommand(action: IKitCommandAction): void {
  if (!_runCommand) { console.warn(`[kit] no command service yet; "${action.command}" not run`); return; }
  void _runCommand(action.command, ...(action.args ?? [])).catch((err) => console.warn(`[kit] command "${action.command}" failed:`, err));
}
