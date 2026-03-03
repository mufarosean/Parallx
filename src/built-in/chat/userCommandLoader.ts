// userCommandLoader.ts — Load user-defined commands from .parallx/commands/ (M11 Task 3.7)
//
// Reads `.parallx/commands/*.md` files, parses YAML frontmatter for:
//   name, description
// The markdown body becomes the prompt template.
// `{context}` placeholder is replaced with user's attached context.
// `{input}` placeholder is replaced with user's remaining text after the command.
//
// VS Code reference:
//   Custom prompt files in VS Code chat (.github/copilot-instructions.md pattern)

import type { IChatSlashCommand } from './chatSlashCommands.js';

// ── Types ──

/** Filesystem abstraction for reading command files. */
export interface IUserCommandFileSystem {
  /** List .md files in .parallx/commands/. Returns relative paths. */
  listCommandFiles(): Promise<string[]>;
  /** Read a command file's content by relative path. */
  readCommandFile(relativePath: string): Promise<string>;
}

/** Parsed frontmatter from a command file. */
interface ICommandFrontmatter {
  name?: string;
  description?: string;
}

// ── Frontmatter Parser ──

/**
 * Parse simple YAML frontmatter from a markdown file.
 * Returns the frontmatter key-value pairs and the body text.
 */
function parseFrontmatter(content: string): { meta: ICommandFrontmatter; body: string } {
  const meta: ICommandFrontmatter = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx > 0) {
      const yamlBlock = content.substring(3, endIdx).trim();
      body = content.substring(endIdx + 3).trim();

      for (const line of yamlBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) { continue; }
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        let value = line.substring(colonIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key === 'name') { meta.name = value; }
        if (key === 'description') { meta.description = value; }
      }
    }
  }

  return { meta, body };
}

// ── Loader ──

/**
 * Load user-defined slash commands from `.parallx/commands/*.md`.
 *
 * Each file becomes a command:
 *   - `name` from frontmatter (or filename without extension)
 *   - `description` from frontmatter (or first line of body)
 *   - `promptTemplate` = body content
 */
export async function loadUserCommands(
  fs: IUserCommandFileSystem,
): Promise<IChatSlashCommand[]> {
  const commands: IChatSlashCommand[] = [];

  let files: string[];
  try {
    files = await fs.listCommandFiles();
  } catch {
    return commands; // No commands directory or error reading it
  }

  for (const filePath of files) {
    try {
      const content = await fs.readCommandFile(filePath);
      const { meta, body } = parseFrontmatter(content);

      // Derive command name from frontmatter or filename
      const fileName = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
      const name = meta.name || fileName;
      if (!name) { continue; }

      // Derive description from frontmatter or first non-empty line
      const description = meta.description
        || body.split('\n').find(l => l.trim().length > 0)?.trim().substring(0, 80)
        || `User command: ${name}`;

      // The body IS the prompt template
      // Ensure {input} and {context} placeholders are present
      let promptTemplate = body;
      if (!promptTemplate.includes('{input}')) {
        promptTemplate += '\n\n{input}';
      }
      if (!promptTemplate.includes('{context}')) {
        promptTemplate = '{context}\n\n' + promptTemplate;
      }

      commands.push({
        name,
        description,
        promptTemplate,
        isBuiltIn: false,
      });
    } catch {
      // Skip invalid command files
      continue;
    }
  }

  return commands;
}
