// terminalTools.ts — Terminal/command tool registrations (M13 Phase 5)

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IBuiltInToolTerminal,
} from '../chatTypes.js';

// ── Constants ──

/** Command blocklist — commands that should never be executed. */
const COMMAND_BLOCKLIST: readonly string[] = [
  'rm -rf /',
  'format',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'shutdown',
  'reboot',
  'halt',
  'init 0',
  'init 6',
];

function isCommandBlocked(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return COMMAND_BLOCKLIST.some((blocked) => lower.startsWith(blocked) || lower.includes(blocked));
}

// ── Tool definition ──

export function createRunCommandTool(terminal: IBuiltInToolTerminal | undefined, workspaceRoot?: string): IChatTool {
  return {
    name: 'run_command',
    description:
      'Execute a shell command in the workspace directory and return the output. ' +
      'Use for installing dependencies, running builds, executing tests, or gathering system info. ' +
      'Commands run with a 30-second timeout by default. ' +
      'Dangerous commands (rm -rf /, shutdown, etc.) are blocked. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!terminal) {
        return { content: 'Terminal is not available — running outside Electron.', isError: true };
      }

      const command = String(args['command'] || '').trim();
      if (!command) {
        return { content: 'command is required', isError: true };
      }

      // Security: check blocklist
      if (isCommandBlocked(command)) {
        return { content: `Command blocked for safety: "${command}"`, isError: true };
      }

      const timeout = typeof args['timeout'] === 'number' ? args['timeout'] : 30000;

      try {
        const result = await terminal.exec(command, { cwd: workspaceRoot, timeout });

        if (result.error) {
          return { content: `Command error: ${result.error.message}\n\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}`, isError: true };
        }

        let output = '';
        if (result.stdout) { output += result.stdout; }
        if (result.stderr) { output += (output ? '\n\n[stderr]\n' : '') + result.stderr; }
        if (!output) { output = '(no output)'; }

        // Truncate extremely long output
        const MAX_OUTPUT = 50_000;
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + `\n\n... (truncated, ${output.length} chars total)`;
        }

        const exitLabel = result.exitCode === 0 ? '' : ` (exit code: ${result.exitCode})`;
        return { content: `$ ${command}${exitLabel}\n\n${output}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to execute command: ${msg}`, isError: true };
      }
    },
  };
}
