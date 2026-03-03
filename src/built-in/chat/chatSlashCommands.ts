// chatSlashCommands.ts — Slash command registry & parser (M11 Tasks 3.5–3.7)
//
// Provides:
//   1. IChatSlashCommand — a registered slash command with structured prompt template
//   2. SlashCommandRegistry — stores built-in + user-defined commands
//   3. parseSlashCommand() — extracts /command from user input
//   4. Built-in commands: /explain, /fix, /test, /doc, /review, /compact, /init
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatSlashCommands.ts

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import type { IChatSlashCommand, IParsedSlashCommand } from './chatTypes.js';

// IChatSlashCommand, IParsedSlashCommand — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatSlashCommand, IParsedSlashCommand } from './chatTypes.js';

// ── Built-in Commands ──

const BUILTIN_COMMANDS: IChatSlashCommand[] = [
  {
    name: 'explain',
    description: 'Explain how the selected code or concept works',
    promptTemplate:
      'You are a patient technical teacher. Explain the following clearly and thoroughly.\n' +
      'If context is attached, focus your explanation on that specific code.\n' +
      'Use examples where helpful. Structure with headings.\n\n' +
      '{context}\n\n' +
      'Explain: {input}',
    isBuiltIn: true,
  },
  {
    name: 'fix',
    description: 'Find and fix problems in the code',
    promptTemplate:
      'You are a senior developer debugging code. Analyze the following for bugs, errors, and issues.\n' +
      'For each issue found:\n' +
      '1. Describe the problem\n' +
      '2. Explain why it\'s wrong\n' +
      '3. Show the corrected code\n\n' +
      '{context}\n\n' +
      'Fix: {input}',
    isBuiltIn: true,
  },
  {
    name: 'test',
    description: 'Generate tests for the code',
    promptTemplate:
      'You are a test engineer. Generate comprehensive unit tests for the following code.\n' +
      'Use the project\'s existing test framework (Vitest preferred, or whatever is configured).\n' +
      'Cover: happy paths, edge cases, error handling, boundary conditions.\n' +
      'Use descriptive test names. Group related tests with describe().\n\n' +
      '{context}\n\n' +
      'Generate tests for: {input}',
    isBuiltIn: true,
  },
  {
    name: 'doc',
    description: 'Generate documentation or comments',
    promptTemplate:
      'You are a technical writer. Generate clear, accurate documentation for the following code.\n' +
      'Include:\n' +
      '- JSDoc/TSDoc comments for functions, classes, and interfaces\n' +
      '- @param and @returns descriptions\n' +
      '- Brief usage examples where helpful\n' +
      '- Any important caveats or gotchas\n\n' +
      '{context}\n\n' +
      'Document: {input}',
    isBuiltIn: true,
  },
  {
    name: 'review',
    description: 'Code review — suggest improvements',
    promptTemplate:
      'You are a thorough code reviewer. Review the following code for:\n' +
      '1. **Correctness** — logic bugs, off-by-one errors, null safety\n' +
      '2. **Performance** — unnecessary allocations, O(n²) patterns, memory leaks\n' +
      '3. **Readability** — naming, structure, comments, complexity\n' +
      '4. **Security** — injection, XSS, unsafe operations\n' +
      '5. **Best practices** — patterns, conventions, idiomatic usage\n\n' +
      'For each issue, rate severity (🔴 Critical / 🟡 Suggestion / 🟢 Nitpick).\n' +
      'Show corrected code for critical issues.\n\n' +
      '{context}\n\n' +
      'Review: {input}',
    isBuiltIn: true,
  },
  {
    name: 'compact',
    description: 'Summarize conversation to free token budget',
    promptTemplate: '',
    isBuiltIn: true,
    specialHandler: 'compact',
  },
  {
    name: 'init',
    description: 'Scan workspace and generate AGENTS.md',
    promptTemplate: '',
    isBuiltIn: true,
    specialHandler: 'init',
  },
];

// ── Registry ──

/**
 * Registry for built-in and user-defined slash commands.
 */
export class SlashCommandRegistry extends Disposable {

  private readonly _commands = new Map<string, IChatSlashCommand>();

  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  constructor() {
    super();
    // Register built-in commands
    for (const cmd of BUILTIN_COMMANDS) {
      this._commands.set(cmd.name, cmd);
    }
  }

  /** Get all registered commands (built-in + user-defined). */
  getCommands(): IChatSlashCommand[] {
    return Array.from(this._commands.values());
  }

  /** Get a command by name. */
  getCommand(name: string): IChatSlashCommand | undefined {
    return this._commands.get(name);
  }

  /** Register a user-defined command. Returns a disposable to unregister. */
  registerCommand(command: IChatSlashCommand): { dispose(): void } {
    this._commands.set(command.name, command);
    this._onDidChange.fire();
    return {
      dispose: () => {
        // Only remove if it's still the same command (not overwritten)
        if (this._commands.get(command.name) === command) {
          this._commands.delete(command.name);
          this._onDidChange.fire();
        }
      },
    };
  }

  /** Register multiple user-defined commands (e.g. from .parallx/commands/). */
  registerCommands(commands: IChatSlashCommand[]): { dispose(): void } {
    for (const cmd of commands) {
      this._commands.set(cmd.name, cmd);
    }
    this._onDidChange.fire();
    return {
      dispose: () => {
        for (const cmd of commands) {
          if (this._commands.get(cmd.name) === cmd) {
            this._commands.delete(cmd.name);
          }
        }
        this._onDidChange.fire();
      },
    };
  }

  /**
   * Apply a command's prompt template to user input and context.
   * Returns the transformed message text, or undefined for special-handler commands.
   */
  applyTemplate(
    command: IChatSlashCommand,
    userInput: string,
    contextContent: string,
  ): string | undefined {
    if (command.specialHandler) {
      return undefined; // Handled by dedicated logic
    }
    let result = command.promptTemplate;
    result = result.replace(/\{input\}/g, userInput || '(no additional instructions)');
    result = result.replace(/\{context\}/g, contextContent || '(no context attached)');
    return result;
  }
}

// ── Parser ──

/**
 * Parse user input for a leading /command.
 *
 * @param text — Raw user input text
 * @param registry — Command registry to look up the command
 * @returns Parsed result with command (if found) and remaining text
 */
export function parseSlashCommand(text: string, registry: SlashCommandRegistry): IParsedSlashCommand {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return { command: undefined, commandName: undefined, remainingText: trimmed };
  }

  // Extract command name (everything up to first space)
  const spaceIdx = trimmed.indexOf(' ');
  const commandName = spaceIdx > 0
    ? trimmed.substring(1, spaceIdx)
    : trimmed.substring(1);
  const remainingText = spaceIdx > 0
    ? trimmed.substring(spaceIdx + 1).trim()
    : '';

  const command = registry.getCommand(commandName);

  return {
    command,
    commandName,
    remainingText,
  };
}
