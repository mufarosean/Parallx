// languageModelToolsService.ts — Tool registry and invocation (M9 Task 6.1)
//
// Implements ILanguageModelToolsService: registers tools, invokes them with
// confirmation gates, and provides Ollama-formatted tool definitions.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/tools/languageModelToolsService.ts
//   Parallx folds confirmation logic into this single service.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  ILanguageModelToolsService,
  IChatTool,
  IToolResult,
  IToolDefinition,
  ICancellationToken,
} from './chatTypes.js';

// ── Confirmation support ──

/**
 * Callback type for tool confirmation.
 * The service calls this when a tool requires confirmation.
 * Returns true if user approved, false if rejected.
 */
export type ToolConfirmationHandler = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

// ── Service implementation ──

export class LanguageModelToolsService extends Disposable implements ILanguageModelToolsService {

  // ── Tool registry ──

  private readonly _tools = new Map<string, IChatTool>();

  // ── Enablement ──

  private static readonly _STORAGE_KEY = 'parallx.chat.disabledTools';
  private readonly _disabledTools: Set<string>;

  // ── Events ──

  private readonly _onDidChangeTools = this._register(new Emitter<void>());
  readonly onDidChangeTools: Event<void> = this._onDidChangeTools.event;

  // ── Confirmation ──

  private _confirmationHandler: ToolConfirmationHandler | undefined;
  private _autoApprove = false;

  constructor() {
    super();
    // Restore disabled tools from localStorage
    this._disabledTools = new Set<string>();
    try {
      const stored = localStorage.getItem(LanguageModelToolsService._STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          for (const name of arr) {
            if (typeof name === 'string') {
              this._disabledTools.add(name);
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Registration ──

  registerTool(tool: IChatTool): { dispose(): void } {
    if (this._tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    this._tools.set(tool.name, tool);
    this._onDidChangeTools.fire();

    return {
      dispose: () => {
        this._tools.delete(tool.name);
        this._onDidChangeTools.fire();
      },
    };
  }

  // ── Queries ──

  getTools(): readonly IChatTool[] {
    return Array.from(this._tools.values());
  }

  getTool(name: string): IChatTool | undefined {
    return this._tools.get(name);
  }

  /**
   * Get enabled tools formatted as Ollama tool definitions.
   *
   * These are included in the `tools` array of the chat request
   * when in Agent mode.  Only enabled tools are returned.
   */
  getToolDefinitions(): readonly IToolDefinition[] {
    return Array.from(this._tools.values())
      .filter((tool) => !this._disabledTools.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  /**
   * Get read-only (non-confirmation) tool definitions.
   * Used in Ask mode so the AI can browse workspace content without write access.
   */
  getReadOnlyToolDefinitions(): readonly IToolDefinition[] {
    return Array.from(this._tools.values())
      .filter((tool) => !this._disabledTools.has(tool.name) && !tool.requiresConfirmation)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  // ── Invocation ──

  async invokeTool(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult> {
    const tool = this._tools.get(name);
    if (!tool) {
      return { content: `Tool "${name}" not found`, isError: true };
    }

    // Confirmation gate
    if (tool.requiresConfirmation && !this._autoApprove) {
      if (!this._confirmationHandler) {
        return { content: `Tool "${name}" requires confirmation but no handler is registered`, isError: true };
      }

      const approved = await this._confirmationHandler(name, args);
      if (!approved) {
        return { content: 'Tool execution rejected by user', isError: true };
      }
    }

    // Check cancellation before executing
    if (token.isCancellationRequested) {
      return { content: 'Tool execution cancelled', isError: true };
    }

    // Execute the tool handler
    try {
      return await tool.handler(args, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool "${name}" failed: ${message}`, isError: true };
    }
  }

  // ── Configuration ──

  // ── Tool enablement ──

  isToolEnabled(name: string): boolean {
    return !this._disabledTools.has(name);
  }

  setToolEnabled(name: string, enabled: boolean): void {
    const changed = enabled
      ? this._disabledTools.delete(name)
      : !this._disabledTools.has(name) && (this._disabledTools.add(name), true);
    if (changed) {
      this._persistDisabledTools();
      this._onDidChangeTools.fire();
    }
  }

  getEnabledCount(): number {
    let count = 0;
    for (const tool of this._tools.values()) {
      if (!this._disabledTools.has(tool.name)) {
        count++;
      }
    }
    return count;
  }

  private _persistDisabledTools(): void {
    try {
      localStorage.setItem(
        LanguageModelToolsService._STORAGE_KEY,
        JSON.stringify([...this._disabledTools]),
      );
    } catch { /* storage full or unavailable */ }
  }

  // ── Confirmation ──

  /**
   * Set the confirmation handler (called by UI layer).
   * When a tool requires confirmation, this handler is invoked.
   */
  setConfirmationHandler(handler: ToolConfirmationHandler | undefined): void {
    this._confirmationHandler = handler;
  }

  /**
   * Set auto-approve mode (bypasses confirmation for all tools).
   * Equivalent to VS Code's `chat.tools.global.autoApprove` YOLO mode.
   */
  setAutoApprove(enabled: boolean): void {
    this._autoApprove = enabled;
  }

  /** Whether auto-approve is currently enabled. */
  get autoApprove(): boolean {
    return this._autoApprove;
  }
}
