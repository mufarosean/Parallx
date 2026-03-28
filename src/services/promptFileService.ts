// promptFileService.ts — Prompt file loader (M11 Task 1.1)
//
// Reads layered prompt files from .parallx/:
//   .parallx/AGENTS.md  — Project context for the agent
//   .parallx/SOUL.md    — Agent personality and constraints
//   .parallx/TOOLS.md   — Tool usage instructions
//   .parallx/rules/*.md — Pattern-scoped rules
//
// OpenClaw-inspired, non-negotiable architecture (NN-1, NN-2).
// Falls back to built-in defaults when workspace files don't exist.
//
// VS Code reference:
//   .github/copilot-instructions.md + .cursorrules patterns.
//   This is Parallx's equivalent, following OpenClaw's AGENTS.md / SOUL.md / TOOLS.md.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

// ── Types ──

/**
 * A pattern-scoped rule loaded from .parallx/rules/*.md.
 * The frontmatter `pattern:` field is a glob matched against file paths.
 */
export interface IPromptRule {
  /** Glob pattern from frontmatter (e.g. "*.test.ts", "src/services/**"). */
  readonly pattern: string;
  /** The markdown body (after frontmatter). */
  readonly content: string;
  /** Source file path (relative to workspace root). */
  readonly source: string;
}

/**
 * The assembled prompt file layers.
 */
export interface IPromptFileLayers {
  /** Content of SOUL.md (personality/identity). Falls back to built-in default. */
  readonly soul: string;
  /** Content of AGENTS.md (project context). Empty if not present. */
  readonly agents: string;
  /** Content of TOOLS.md (tool instructions). Falls back to auto-generated. */
  readonly tools: string;
  /** Pattern-scoped rules from .parallx/rules/*.md. */
  readonly rules: readonly IPromptRule[];
}

/**
 * File system abstraction for prompt file access.
 * This avoids importing IFileService directly — the chat tool wires it.
 */
export interface IPromptFileAccess {
  /** Read a file's text content by path relative to workspace root. Returns null if not found. */
  readFile(relativePath: string): Promise<string | null>;
  /** Check if a file or directory exists. */
  exists(relativePath: string): Promise<boolean>;
  /** List files in a directory (relative paths). Returns empty array if dir doesn't exist. */
  listDir(relativePath: string): Promise<string[]>;
}

// ── Built-in defaults ──

/**
 * Default SOUL.md content — shipped with Parallx.
 * Used when no workspace-level SOUL.md exists.
 */
const DEFAULT_SOUL = `# Parallx AI Assistant

You are Parallx, a local AI assistant running entirely on the user's machine.
You help the user understand and work with their project files and canvas pages.

## Personality
- Direct, concise, technical
- Explain your reasoning when asked
- Admit when you don't know something
- Never hallucinate file contents — read the actual file

## Constraints
- You can ONLY access files within this workspace
- You MUST ask permission before writing or modifying files
- You MUST NOT fabricate code or file contents
- When referencing files, always verify they exist first
- Keep responses focused — don't repeat the user's question back

## Response Style
- Use code blocks with language tags
- Reference file paths relative to workspace root
- When showing diffs, use unified diff format
- For long explanations, use headers and bullet points`;

// ── Frontmatter parser ──

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Returns the frontmatter key-value pairs and the body after the frontmatter.
 *
 * Supports simple `key: value` pairs only (no nested YAML).
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { meta: {}, body: content };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { meta: {}, body: content };
  }

  const frontmatterBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();
  const meta: Record<string, string> = {};

  for (const line of frontmatterBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key) {
        meta[key] = value;
      }
    }
  }

  return { meta, body };
}

// ── Glob matcher ──

/**
 * Simple glob matcher for rule patterns.
 * Supports: `*` (any chars except /), `**` (any path), `?` (single char).
 * Good enough for .parallx/rules/ patterns.
 */
export function matchGlob(pattern: string, path: string): boolean {
  // Normalise path separators
  const normPath = path.replace(/\\/g, '/');
  const normPattern = pattern.replace(/\\/g, '/');

  // Convert glob to regex
  let regexStr = '^';
  let i = 0;
  while (i < normPattern.length) {
    const ch = normPattern[i];
    if (ch === '*') {
      if (normPattern[i + 1] === '*') {
        // ** matches any path segment
        if (normPattern[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches within a single segment
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += '$';

  try {
    return new RegExp(regexStr).test(normPath);
  } catch {
    return false;
  }
}

// ── Service ──

/**
 * PromptFileService reads and caches layered prompt files from the workspace.
 *
 * Architecture:
 *   SOUL.md   → identity layer (falls back to built-in)
 *   AGENTS.md → project context layer (empty if absent)
 *   TOOLS.md  → tool instructions (auto-generated if absent)
 *   .parallx/rules/*.md → pattern-scoped rules
 *
 * Files are cached and re-read on `invalidate()`. The chat tool
 * should call `invalidate()` when file watchers detect changes.
 */
export class PromptFileService extends Disposable {
  private _fileAccess: IPromptFileAccess | undefined;
  private _cache: IPromptFileLayers | undefined;
  private _autoToolsContent: string = '';

  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  /**
   * Set the file access provider. Called when a workspace folder is available.
   */
  setFileAccess(access: IPromptFileAccess | undefined): void {
    this._fileAccess = access;
    this._cache = undefined;
  }

  /**
   * Set auto-generated TOOLS.md content (from skill manifests).
   * Used as fallback when no user-provided TOOLS.md exists.
   */
  setAutoToolsContent(content: string): void {
    this._autoToolsContent = content;
  }

  /**
   * Invalidate the cache and fire change event.
   * Call when file watchers detect .parallx/AGENTS.md, SOUL.md, or TOOLS.md changes.
   */
  invalidate(): void {
    this._cache = undefined;
    this._onDidChange.fire();
  }

  /**
   * Load all prompt file layers. Returns cached result on subsequent calls
   * until `invalidate()` is called.
   */
  async loadLayers(): Promise<IPromptFileLayers> {
    if (this._cache) {
      return this._cache;
    }

    if (!this._fileAccess) {
      // No workspace — return defaults
      this._cache = {
        soul: DEFAULT_SOUL,
        agents: '',
        tools: this._autoToolsContent,
        rules: [],
      };
      return this._cache;
    }

    const [soul, agents, tools, rules] = await Promise.all([
      this._loadFile('.parallx/SOUL.md', DEFAULT_SOUL),
      this._loadFile('.parallx/AGENTS.md', ''),
      this._loadFile('.parallx/TOOLS.md', this._autoToolsContent),
      this._loadRules(),
    ]);

    this._cache = { soul, agents, tools, rules };
    return this._cache;
  }

  /**
   * Get rules matching a file path. Pass the relative path of the active file.
   */
  getMatchingRules(layers: IPromptFileLayers, activeFilePath?: string): readonly IPromptRule[] {
    if (!activeFilePath || layers.rules.length === 0) {
      return [];
    }
    return layers.rules.filter((rule) => matchGlob(rule.pattern, activeFilePath));
  }

  /**
   * Assemble the full prompt text from layers + matching rules.
   * This is the text injected into the system prompt AFTER the core Parallx identity.
   */
  assemblePromptOverlay(layers: IPromptFileLayers, activeFilePath?: string): string {
    const parts: string[] = [];

    // Layer 1: SOUL.md (personality)
    if (layers.soul) {
      parts.push(layers.soul);
    }

    // Layer 2: AGENTS.md (project context)
    if (layers.agents) {
      parts.push(layers.agents);
    }

    // Layer 3: TOOLS.md (tool instructions)
    if (layers.tools) {
      parts.push(layers.tools);
    }

    // Layer 4: Matching rules
    const matchingRules = this.getMatchingRules(layers, activeFilePath);
    for (const rule of matchingRules) {
      parts.push(`[Rule from ${rule.source}]\n${rule.content}`);
    }

    return parts.join('\n\n');
  }

  // ── Private helpers ──

  private async _loadFile(relativePath: string, fallback: string): Promise<string> {
    if (!this._fileAccess) { return fallback; }
    try {
      const content = await this._fileAccess.readFile(relativePath);
      if (content !== null && content.trim().length > 0) {
        return content.trim();
      }
    } catch {
      // File not found or read error — use fallback
    }
    return fallback;
  }

  private async _loadRules(): Promise<IPromptRule[]> {
    if (!this._fileAccess) { return []; }

    const rulesDir = '.parallx/rules';
    try {
      const exists = await this._fileAccess.exists(rulesDir);
      if (!exists) { return []; }

      const files = await this._fileAccess.listDir(rulesDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      const rules: IPromptRule[] = [];
      for (const file of mdFiles) {
        try {
          const content = await this._fileAccess.readFile(`${rulesDir}/${file}`);
          if (!content) { continue; }

          const { meta, body } = parseFrontmatter(content);
          const pattern = meta['pattern'];
          if (!pattern || !body.trim()) { continue; }

          rules.push({
            pattern,
            content: body.trim(),
            source: `${rulesDir}/${file}`,
          });
        } catch {
          // Skip unreadable rule files
        }
      }

      return rules;
    } catch {
      return [];
    }
  }
}
