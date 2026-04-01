// initCommand.ts — /init slash command handler (M11 Task 1.6)
//
// Scans the workspace file tree, README, package.json, and common config files,
// then generates AGENTS.md via the LLM. Also creates the .parallx/ directory
// structure if it doesn't exist.
//
// OpenClaw reference: `/init` command auto-generates CLAUDE.md (now AGENTS.md)
// from workspace inspection.

import type { IChatResponseStream, IChatMessage } from '../../../services/chatTypes.js';
import type { IInitCommandServices } from '../chatTypes.js';
import { defaultSkillContents } from '../skills/defaultSkillContents.js';

// IInitCommandServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IInitCommandServices } from '../chatTypes.js';

// ── Constants ──

/** Max depth for the file tree scan. */
const MAX_TREE_DEPTH = 4;
/** Max entries in the tree output. */
const MAX_TREE_ENTRIES = 200;
/** Max bytes to read from key config files. */
const MAX_CONFIG_READ = 8192;

/** Files to inspect for project context. */
const CONFIG_FILES = [
  'README.md', 'readme.md', 'README.txt',
  'package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg',
  'go.mod', 'build.gradle', 'pom.xml', 'Makefile', 'CMakeLists.txt',
  'tsconfig.json', '.eslintrc.json', '.prettierrc',
  'ARCHITECTURE.md', 'CONTRIBUTING.md',
  'docker-compose.yml', 'Dockerfile',
];

// ── Implementation ──

/**
 * Execute the /init command.
 * Scans workspace and generates AGENTS.md.
 */
export async function executeInitCommand(
  services: IInitCommandServices,
  response: IChatResponseStream,
  signal?: AbortSignal,
): Promise<void> {
  if (!services.listFiles || !services.readFile) {
    response.warning('/init requires a workspace folder to be open.');
    return;
  }

  response.progress('Scanning workspace...');

  // 1. Build file tree
  const tree = await buildFileTree(services, '', 0);
  const treeStr = tree.join('\n');

  // 2. Read key config files
  const configContext: string[] = [];
  for (const file of CONFIG_FILES) {
    try {
      const exists = await services.exists?.(file);
      if (!exists) continue;
      const content = await services.readFile(file);
      if (content && content.trim()) {
        const truncated = content.length > MAX_CONFIG_READ
          ? content.slice(0, MAX_CONFIG_READ) + '\n... (truncated)'
          : content;
        configContext.push(`--- ${file} ---\n${truncated}`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  response.progress('Generating AGENTS.md...');

  // 3. Build LLM prompt
  const scanData = [
    `Workspace: "${services.getWorkspaceName()}"`,
    '',
    'File tree:',
    '```',
    treeStr,
    '```',
  ];

  if (configContext.length > 0) {
    scanData.push('', 'Key project files:', '', configContext.join('\n\n'));
  }

  const systemPrompt = [
    'You are an expert at analyzing codebases. Your task is to generate an AGENTS.md file — a markdown document that describes a project to an AI assistant.',
    '',
    'The document should include:',
    '1. **Project name and one-line description**',
    '2. **Architecture overview** — key directories and their purpose',
    '3. **Conventions** — coding style, naming patterns, important rules',
    '4. **Important files** — files an AI should know about',
    '5. **Build & Run instructions** — how to develop, test, and build',
    '',
    'Guidelines:',
    '- Be concise but thorough (aim for 30-60 lines)',
    '- Use markdown headers (##) for sections',
    '- Reference actual file paths from the tree',
    '- If you see a README or ARCHITECTURE.md, use it as primary source',
    '- Output ONLY the AGENTS.md content — no preamble, no "here is the file"',
  ].join('\n');

  const messages: IChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: scanData.join('\n') },
  ];

  // 4. Generate via LLM
  let generatedContent = '';
  try {
    for await (const chunk of services.sendChatRequest(messages, undefined, signal)) {
      if (chunk.content) {
        generatedContent += chunk.content;
        response.markdown(chunk.content);
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      response.warning('/init was cancelled.');
      return;
    }
    response.warning(`Failed to generate AGENTS.md: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!generatedContent.trim()) {
    response.warning('The model returned empty content. Try again or write AGENTS.md manually.');
    return;
  }

  // 5. Write AGENTS.md to .parallx/
  if (services.writeFile) {
    try {
      await services.writeFile('.parallx/AGENTS.md', generatedContent.trim() + '\n');
      response.markdown('\n\n---\n**AGENTS.md** has been created in `.parallx/`.');

      // 6. Create .parallx/ directory structure if it doesn't exist
      const dirs = ['.parallx', '.parallx/rules', '.parallx/commands', '.parallx/skills'];
      for (const dir of dirs) {
        const exists = await services.exists?.(dir);
        if (!exists) {
          // Create a .gitkeep to ensure the directory exists
          await services.writeFile(`${dir}/.gitkeep`, '');
        }
      }
      response.markdown('\n`.parallx/` directory structure created (rules, commands, skills).');

      // 7. Write default skills (skip any that already exist)
      let skillsWritten = 0;
      for (const [name, content] of defaultSkillContents) {
        const skillPath = `.parallx/skills/${name}/SKILL.md`;
        const skillExists = await services.exists?.(skillPath);
        if (!skillExists) {
          await services.writeFile(skillPath, content);
          skillsWritten++;
        }
      }
      if (skillsWritten > 0) {
        response.markdown(`\n🛠️ ${skillsWritten} default skill(s) installed to \`.parallx/skills/\`.`);
      }

      // Invalidate prompt file cache so AGENTS.md is picked up
      services.invalidatePromptFiles?.();
    } catch (err) {
      response.warning(`Could not write AGENTS.md: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    response.markdown('\n\n---\nCopy the content above and save it as `.parallx/AGENTS.md` in your workspace.');
  }
}

// ── File tree builder ──

async function buildFileTree(
  services: IInitCommandServices,
  relativePath: string,
  depth: number,
  entries: string[] = [],
): Promise<string[]> {
  if (depth > MAX_TREE_DEPTH || entries.length >= MAX_TREE_ENTRIES) {
    return entries;
  }

  try {
    const items = await services.listFiles!(relativePath);
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES) break;

      // Skip hidden files/dirs and common large dirs
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist' ||
          item.name === 'build' || item.name === '__pycache__' || item.name === '.git' ||
          item.name === 'vendor' || item.name === 'target' || item.name === 'coverage') {
        continue;
      }

      const indent = '  '.repeat(depth);
      const relPath = relativePath ? `${relativePath}/${item.name}` : item.name;

      if (item.type === 'directory') {
        entries.push(`${indent}${item.name}/`);
        await buildFileTree(services, relPath, depth + 1, entries);
      } else {
        entries.push(`${indent}${item.name}`);
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return entries;
}
