// skillLoaderService.ts — SKILL.md loader and watcher (M11 Task 2.8)
//
// Scans `.parallx/skills/*/SKILL.md` at workspace open, parses YAML
// frontmatter, and registers skills with the tool service.  Watches
// for changes so new skills dropped into the folder appear live.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/tools/ (tool contribution scanning)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IChatTool } from './chatTypes.js';
import type { ToolPermissionLevel } from './chatTypes.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Skill kind — tool (M11) or workflow (M39). */
export type SkillKind = 'tool' | 'workflow';

/** Parsed SKILL.md frontmatter. */
export interface ISkillManifest {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly permission: ToolPermissionLevel;
  readonly parameters: ISkillParameter[];
  readonly tags: readonly string[];
  /** Raw markdown body (after frontmatter). */
  readonly body: string;
  /** Path to the SKILL.md file relative to workspace. */
  readonly relativePath: string;

  // ── M39 fields ──

  /** Whether this skill is a tool declaration or a workflow playbook. Default: 'tool'. */
  readonly kind: SkillKind;
  /** When true, only the user can trigger this skill (not the model). Default: false. */
  readonly disableModelInvocation: boolean;
  /** Whether the skill appears in the slash-command menu. Default: true. */
  readonly userInvocable: boolean;
}

export interface ISkillParameter {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
}

/** Event payload when skills change. */
export interface ISkillsChangeEvent {
  readonly added: readonly ISkillManifest[];
  readonly removed: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Frontmatter parsing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 *
 * This is a lightweight parser — only supports the flat key-value and
 * simple list structures used in SKILL.md. Not a full YAML parser.
 */
export function parseSkillFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) { return null; }

  const yamlBlock = fmMatch[1];
  const body = content.slice(fmMatch[0].length).trim();
  const frontmatter: Record<string, unknown> = {};

  // Track current list context for multi-line list items
  let currentListKey: string | null = null;
  let currentList: Record<string, unknown>[] = [];

  // Track folded/literal block scalar (key: > or key: |)
  let blockScalarKey: string | null = null;
  let blockScalarLines: string[] = [];
  let blockScalarFolded = true; // true = '>' (folded), false = '|' (literal)

  const lines = yamlBlock.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Blank line inside block scalar preserves a newline
      if (blockScalarKey) { blockScalarLines.push(''); }
      continue;
    }

    // Inside a block scalar — collect indented continuation lines
    if (blockScalarKey) {
      if (/^\s{2,}/.test(line)) {
        blockScalarLines.push(trimmed);
        continue;
      }
      // Not indented → flush the block scalar
      const joined = blockScalarFolded
        ? blockScalarLines.filter(Boolean).join(' ')
        : blockScalarLines.join('\n');
      frontmatter[blockScalarKey] = joined;
      blockScalarKey = null;
      blockScalarLines = [];
    }

    // List item under current key: `  - name: value`
    if (currentListKey && /^\s*-\s+\w+:/.test(line)) {
      const itemProps: Record<string, unknown> = {};
      // Parse this and subsequent indented lines as an object
      const itemMatch = trimmed.match(/^-\s+(.+)/);
      if (itemMatch) {
        const pairs = itemMatch[1];
        // Simple single-line: `- name: foo`
        const kvMatch = pairs.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
          itemProps[kvMatch[1]] = _parseYamlValue(kvMatch[2]);
        }
      }
      currentList.push(itemProps);
      continue;
    }

    // Continuation of a list item property: `    type: string`
    if (currentListKey && /^\s{4,}\w+:/.test(line)) {
      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
      if (kvMatch && currentList.length > 0) {
        currentList[currentList.length - 1][kvMatch[1]] = _parseYamlValue(kvMatch[2]);
      }
      continue;
    }

    // End of list context — flush
    if (currentListKey && !/^\s/.test(line)) {
      frontmatter[currentListKey] = currentList;
      currentListKey = null;
      currentList = [];
    }

    // Top-level key: value (supports hyphenated keys like `disable-model-invocation`)
    const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      // Detect start of a list (empty value or `[]`)
      if (rawValue === '' || rawValue === '[]') {
        if (rawValue === '[]') {
          frontmatter[key] = [];
        } else {
          currentListKey = key;
          currentList = [];
        }
        continue;
      }

      // Block scalar: `key: >` (folded) or `key: |` (literal)
      if (rawValue === '>' || rawValue === '|') {
        blockScalarKey = key;
        blockScalarLines = [];
        blockScalarFolded = rawValue === '>';
        continue;
      }

      // Inline array: `[tag1, tag2]`
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1);
        frontmatter[key] = inner.split(',').map((s) => s.trim()).filter(Boolean);
        continue;
      }

      frontmatter[key] = _parseYamlValue(rawValue);
    }
  }

  // Flush trailing list
  if (currentListKey) {
    frontmatter[currentListKey] = currentList;
  }

  // Flush trailing block scalar
  if (blockScalarKey) {
    const joined = blockScalarFolded
      ? blockScalarLines.filter(Boolean).join(' ')
      : blockScalarLines.join('\n');
    frontmatter[blockScalarKey] = joined;
  }

  return { frontmatter, body };
}

function _parseYamlValue(raw: string): string | number | boolean {
  // Booleans
  if (raw === 'true') { return true; }
  if (raw === 'false') { return false; }

  // Numbers
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) { return num; }

  // Quoted strings — strip quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

/**
 * Convert parsed frontmatter into a validated ISkillManifest.
 * Returns null if required fields are missing.
 */
export function validateSkillManifest(
  parsed: { frontmatter: Record<string, unknown>; body: string },
  relativePath: string,
): ISkillManifest | null {
  const fm = parsed.frontmatter;
  const name = String(fm['name'] ?? '').trim();
  const description = String(fm['description'] ?? '').trim();

  if (!name || !description) { return null; }

  const version = String(fm['version'] ?? '1.0.0');
  const author = String(fm['author'] ?? 'unknown');
  const permission = _validPermission(String(fm['permission'] ?? 'requires-approval'));

  // Parse parameters
  const rawParams = Array.isArray(fm['parameters']) ? fm['parameters'] : [];
  const parameters: ISkillParameter[] = rawParams
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => ({
      name: String(p['name'] ?? ''),
      type: String(p['type'] ?? 'string'),
      description: String(p['description'] ?? ''),
      required: p['required'] === true || p['required'] === 'true',
    }))
    .filter((p) => p.name.length > 0);

  // Parse tags
  const rawTags = Array.isArray(fm['tags']) ? fm['tags'] : [];
  const tags = rawTags.map((t) => String(t).trim()).filter(Boolean);

  // M39 fields — kind, disableModelInvocation, userInvocable
  const kind = _validKind(String(fm['kind'] ?? 'tool'));
  const disableModelInvocation = fm['disableModelInvocation'] === true
    || fm['disableModelInvocation'] === 'true'
    || fm['disable-model-invocation'] === true
    || fm['disable-model-invocation'] === 'true';
  const rawUserInvocable = fm['userInvocable'] ?? fm['user-invocable'];
  const userInvocable = rawUserInvocable === false || rawUserInvocable === 'false' ? false : true;

  return {
    name,
    description,
    version,
    author,
    permission,
    parameters,
    tags,
    body: parsed.body,
    relativePath,
    kind,
    disableModelInvocation,
    userInvocable,
  };
}

function _validPermission(raw: string): ToolPermissionLevel {
  if (raw === 'always-allowed' || raw === 'requires-approval' || raw === 'never-allowed') {
    return raw;
  }
  return 'requires-approval';
}

function _validKind(raw: string): SkillKind {
  if (raw === 'tool' || raw === 'workflow') {
    return raw;
  }
  return 'tool';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Manifest → IChatTool conversion
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a skill manifest to the standard IChatTool shape.
 *
 * The tool won't have an `invoke()` handler — it's a declaration only.
 * The invoker must check whether a handler is bound (built-in tools wire
 * this up at registration time).
 */
export function manifestToToolDefinition(manifest: ISkillManifest): IChatTool {
  // Build JSON Schema from parameters
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const param of manifest.parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    name: manifest.name,
    description: manifest.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    handler: async () => ({ content: `Skill "${manifest.name}" has no built-in handler.`, isError: true }),
    requiresConfirmation: manifest.permission === 'requires-approval',
    permissionLevel: manifest.permission,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SkillLoaderService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * File system abstraction for the skill loader (makes unit testing easy).
 * The caller provides these backed by IFileService.
 */
export interface ISkillFileSystem {
  readFile(relativePath: string): Promise<string>;
  listDirs(parentRelativePath: string): Promise<string[]>;
  exists(relativePath: string): Promise<boolean>;
}

/**
 * Scans `.parallx/skills/` for SKILL.md manifests, parses them,
 * and exposes the results for the tool service to consume.
 */
export class SkillLoaderService extends Disposable {

  private readonly _skills = new Map<string, ISkillManifest>();

  private readonly _onDidChangeSkills = this._register(new Emitter<ISkillsChangeEvent>());
  readonly onDidChangeSkills: Event<ISkillsChangeEvent> = this._onDidChangeSkills.event;

  private _fs: ISkillFileSystem | undefined;

  // ── Public API ──

  /** Bind a filesystem accessor. Must be called before `scanSkills()`. */
  setFileSystem(fs: ISkillFileSystem): void {
    this._fs = fs;
  }

  /** All loaded skill manifests. */
  get skills(): readonly ISkillManifest[] {
    return [...this._skills.values()];
  }

  /** Get a specific skill by name. */
  getSkill(name: string): ISkillManifest | undefined {
    return this._skills.get(name);
  }

  /** Convert all loaded skills to IChatTool definitions. */
  getToolDefinitions(): IChatTool[] {
    return this.skills.map(manifestToToolDefinition);
  }

  /**
   * Return a lightweight catalog of workflow skills for system prompt injection.
   * Excludes skills with `disableModelInvocation: true`.
   */
  getWorkflowSkillCatalog(): { name: string; description: string; kind: SkillKind; tags: readonly string[] }[] {
    return this.skills
      .filter(s => s.kind === 'workflow' && !s.disableModelInvocation)
      .map(s => ({ name: s.name, description: s.description, kind: s.kind, tags: s.tags }));
  }

  /**
   * Scan `.parallx/skills/` and load all SKILL.md manifests.
   * Emits `onDidChangeSkills` if the set changes.
   */
  async scanSkills(): Promise<void> {
    if (!this._fs) { return; }

    const SKILLS_DIR = '.parallx/skills';

    const dirExists = await this._fs.exists(SKILLS_DIR);
    if (!dirExists) { return; }

    const dirs = await this._fs.listDirs(SKILLS_DIR);
    const added: ISkillManifest[] = [];
    const seen = new Set<string>();

    for (const dir of dirs) {
      const skillPath = `${SKILLS_DIR}/${dir}/SKILL.md`;
      const fileExists = await this._fs.exists(skillPath);
      if (!fileExists) { continue; }

      try {
        const content = await this._fs.readFile(skillPath);
        const parsed = parseSkillFrontmatter(content);
        if (!parsed) { continue; }

        const manifest = validateSkillManifest(parsed, skillPath);
        if (!manifest) { continue; }

        seen.add(manifest.name);

        // Check if newly loaded or changed
        const existing = this._skills.get(manifest.name);
        if (!existing || existing.version !== manifest.version || existing.description !== manifest.description) {
          this._skills.set(manifest.name, manifest);
          added.push(manifest);
        }
      } catch {
        // Skip invalid skill files
        continue;
      }
    }

    // Find removed skills
    const removed: string[] = [];
    for (const name of this._skills.keys()) {
      if (!seen.has(name)) {
        this._skills.delete(name);
        removed.push(name);
      }
    }

    if (added.length > 0 || removed.length > 0) {
      this._onDidChangeSkills.fire({ added, removed });
    }
  }

  /**
   * Reload a single skill by name (e.g. after a file-watcher event).
   */
  async reloadSkill(skillName: string): Promise<void> {
    if (!this._fs) { return; }

    const skillPath = `.parallx/skills/${skillName}/SKILL.md`;
    const fileExists = await this._fs.exists(skillPath);

    if (!fileExists) {
      // Skill was deleted
      if (this._skills.has(skillName)) {
        this._skills.delete(skillName);
        this._onDidChangeSkills.fire({ added: [], removed: [skillName] });
      }
      return;
    }

    try {
      const content = await this._fs.readFile(skillPath);
      const parsed = parseSkillFrontmatter(content);
      if (!parsed) { return; }

      const manifest = validateSkillManifest(parsed, skillPath);
      if (!manifest) { return; }

      this._skills.set(manifest.name, manifest);
      this._onDidChangeSkills.fire({ added: [manifest], removed: [] });
    } catch {
      // Skip
    }
  }
}
