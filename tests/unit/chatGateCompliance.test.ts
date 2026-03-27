/**
 * chatGateCompliance.test.ts — Structural gate compliance test for the chat built-in
 *
 * Reads every chat child file's source and asserts that its relative
 * imports only come from designated allowed sources.  This test is the
 * automated guardrail for chat's folder-scoped architecture.
 *
 * If this test fails, someone added a cross-folder import that violates
 * the gate rules.  Fix it by moving the symbol to chatTypes.ts or
 * adjusting the import to go through an allowed path.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';

// ── Chat root ───────────────────────────────────────────────────────────────

const CHAT_DIR = resolve(__dirname, '../../src/built-in/chat');

// ── Exempt files (can import anything — orchestrators / non-TS) ─────────────

const EXEMPT_FILES = new Set([
  'main.ts',                        // Top-level activation orchestrator
  'parallx-manifest.json',          // Tool manifest
  'defaults/SOUL.md',               // Default prompt file
  'defaults/TOOLS.md',              // Default prompt file
  'input/chatInput.css',            // Stylesheet
  'widgets/chatWidget.css',         // Stylesheet
  'widgets/chatView.css',           // Stylesheet
  'widgets/chatTokenStatusBar.css', // Stylesheet
  'skills/exhaustive-summary/SKILL.md',   // Built-in workflow skill (M39)
  'skills/folder-overview/SKILL.md',      // Built-in workflow skill (M39)
  'skills/document-comparison/SKILL.md',  // Built-in workflow skill (M39)
  'skills/scoped-extraction/SKILL.md',    // Built-in workflow skill (M39)
  'skills/builtInSkillManifests.ts',      // Built-in skill manifest registry (M41)
  'skills/defaultSkillContents.ts',       // Default skill file contents for /init (M45)
]);

// ── Per-file import rules ───────────────────────────────────────────────────
//
// For each non-exempt .ts file, list the intra-chat path prefixes that are
// allowed in its relative imports.  The test only checks relative imports
// that resolve within the chat directory.  External and platform imports
// are always permitted.
//
// `chatTypes` is always allowed (it is the type hub) and does not need to
// be listed here.  Every other intra-chat import target must be listed
// explicitly for the importing file.

const FOLDER_RULES: Record<string, string[]> = {

  // ── Root leaves ─────────────────────────────────────────────────────────
  // chatTypes.ts and chatIcons.ts have their own purity tests below.

  // ── config/ — imports only chatTypes ────────────────────────────────────
  'config/chatSystemPrompts.ts':    [],

  // ── data/ — data service hub ────────────────────────────────────────────
  'data/chatDataService.ts': ['providers/', 'widgets/', 'config/', 'tools/', 'utilities/'],

  // ── input/ — chat input components ──────────────────────────────────────
  'input/chatContextAttachments.ts': ['chatIcons'],
  'input/chatContextPills.ts':       ['chatIcons'],
  'input/chatInputPart.ts':          ['chatIcons', 'input/'],
  'input/chatMentionAutocomplete.ts': ['chatIcons'],
  'input/chatRequestParser.ts':      [],

  // ── pickers/ — model/mode/tool pickers ──────────────────────────────────
  'pickers/chatModelPicker.ts': ['chatIcons'],
  'pickers/chatModePicker.ts':  ['chatIcons'],
  // ── rendering/ — message rendering ──────────────────────────────────────
  'rendering/chatCodeActions.ts':   [],
  'rendering/chatContentParts.ts':  ['chatIcons', 'rendering/'],
  'rendering/chatDiffViewer.ts':    [],
  'rendering/chatListRenderer.ts':  ['chatIcons', 'rendering/'],
  'rendering/chatTaskCards.ts':     [],

  // ── tools/ — built-in tool implementations ──────────────────────────────
  'tools/builtInTools.ts':  ['tools/'],
  'tools/fileTools.ts':     [],
  'tools/memoryTools.ts':   [],
  'tools/pageTools.ts':     ['tools/'],
  'tools/terminalTools.ts': [],
  'tools/transcriptTools.ts': [],
  'tools/writeTools.ts':    [],

  // ── widgets/ — chat widget components ───────────────────────────────────
  'widgets/chatSessionSidebar.ts': ['chatIcons'],
  'widgets/chatTokenStatusBar.ts': ['chatIcons', 'config/'],
  'widgets/chatView.ts':          ['providers/', 'widgets/'],
  'widgets/chatWidget.ts':        ['chatIcons', 'input/', 'rendering/', 'pickers/', 'providers/', 'widgets/'],

  // ── providers/ — LLM providers ──────────────────────────────────────────
  'providers/ollamaProvider.ts': [],

  // ── commands/ — slash/init commands ─────────────────────────────────────
  'commands/initCommand.ts': ['skills/'],

  // ── utilities/ — mention resolution, shared helpers ──────────────────
  'utilities/chatAgentTaskWidgetAdapter.ts': [],
  'utilities/chatBridgeParticipantRuntime.ts': ['utilities/'],
  'utilities/chatGroundedResponseHelpers.ts': ['utilities/'],
  'utilities/chatMentionResolver.ts': [],
  'utilities/chatParticipantCommandDispatcher.ts': ['utilities/'],
  'utilities/chatParticipantInterpretation.ts': ['utilities/'],
  'utilities/chatParticipantRuntimeTrace.ts': [],
  'utilities/chatRuntimePromptMessages.ts': [],
  'utilities/chatScopeResolver.ts':          [],
  'utilities/chatSystemPromptComposer.ts': ['config/'],
  'utilities/chatTokenBarAdapter.ts':        ['widgets/'],
  'utilities/chatTurnRouter.ts':             ['utilities/'],
  'utilities/chatTurnSemantics.ts':          [],
  'utilities/chatViewerOpeners.ts':          [],
  'utilities/chatWidgetAttachmentAdapter.ts': [],
  'utilities/chatWidgetPickerAdapter.ts':    [],
  'utilities/chatWidgetRequestAdapter.ts':   [],
  'utilities/chatWidgetSessionAdapter.ts':   [],
  'utilities/chatWorkspaceDigest.ts':        [],
  'utilities/chatTurnExecutionConfig.ts':    [],
  'utilities/chatGroundedExecutor.ts':       ['utilities/'],
  'utilities/chatTurnSynthesis.ts':          [],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract all relative import paths from a TypeScript source string.
 * Matches both static and dynamic imports:
 *   - Static:  `from './foo.js'`, `from '../bar/baz.js'`
 *   - Dynamic: `import('./foo.js')`, `import('../bar/baz.js')`
 * Excludes JSDoc `@see {@link import(...)}` references (not executable).
 * Returns the raw path strings (e.g. `'./chatTypes.js'`).
 */
function extractRelativeImports(source: string): string[] {
  const matches: string[] = [];

  // Static: from '...' and from "..." where path starts with .
  const staticRegex = /from\s+['"](\.\.?\/.+?)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRegex.exec(source)) !== null) {
    matches.push(m[1]);
  }

  // Dynamic: import('...') and import("...") where path starts with .
  // Negative lookbehind excludes @link references inside JSDoc comments.
  const dynamicRegex = /(?<!@link\s)(?<!\{@link\s)import\(\s*['"](\.\.?\/.+?)['"]\s*\)/g;
  while ((m = dynamicRegex.exec(source)) !== null) {
    matches.push(m[1]);
  }

  return matches;
}

/**
 * Check whether a relative import path resolves to something inside
 * the chat directory.  Returns the chat-relative posix path if so,
 * or null if it resolves outside chat (platform, ui, services, etc.).
 */
function resolveToChatRelative(
  childFile: string,
  importPath: string,
): string | null {
  const childDir = resolve(CHAT_DIR, childFile, '..');
  // Strip .js extension and resolve
  const stripped = importPath.replace(/\.js$/, '');
  const absTarget = resolve(childDir, stripped);
  const rel = relative(CHAT_DIR, absTarget);

  // If the resolved path goes outside CHAT_DIR, it's not a chat import
  if (rel.startsWith('..')) return null;

  // Normalise to posix separators
  return rel.split('\\').join('/');
}

/**
 * Recursively collect all .ts files (excluding .d.ts) under a directory.
 * Returns chat-relative posix paths.
 */
function collectTsFiles(dir: string, base: string = ''): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full, rel));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Collect all non-.ts files (CSS, etc.) under a directory.
 * Returns chat-relative posix paths.
 */
function collectNonTsFiles(dir: string, base: string = ''): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...collectNonTsFiles(full, rel));
    } else if (!entry.endsWith('.ts')) {
      files.push(rel);
    }
  }
  return files;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Chat Gate Architecture Compliance', () => {

  // ── Per-file import validation ──────────────────────────────────────────

  for (const [childPath, allowedImports] of Object.entries(FOLDER_RULES)) {
    it(`${childPath} imports only from allowed sources`, () => {
      const fullPath = resolve(CHAT_DIR, childPath);
      if (!existsSync(fullPath)) {
        // File was removed — skip (the coverage test below catches orphan rules)
        return;
      }

      const source = readFileSync(fullPath, 'utf-8');
      const imports = extractRelativeImports(source);

      for (const imp of imports) {
        const chatRel = resolveToChatRelative(childPath, imp);

        // Import resolves outside chat — always allowed
        if (chatRel === null) continue;

        // chatTypes is always allowed (type hub)
        if (chatRel === 'chatTypes') continue;

        // Check if any allowed import prefix matches the resolved path
        const isAllowed = allowedImports.some(prefix => chatRel.startsWith(prefix));

        expect(isAllowed).toBe(true);
        if (!isAllowed) {
          console.error(
            `[GATE VIOLATION] ${childPath} imports '${imp}' → resolves to '${chatRel}'\n` +
            `  Allowed: chatTypes, ${allowedImports.length ? allowedImports.join(', ') : '(none — should have zero intra-chat imports beyond chatTypes)'}`,
          );
        }
      }
    });
  }

  // ── Type hub purity: chatTypes.ts has zero intra-chat imports ───────────

  it('chatTypes.ts has zero intra-chat imports (type hub purity)', () => {
    const fullPath = resolve(CHAT_DIR, 'chatTypes.ts');
    const source = readFileSync(fullPath, 'utf-8');
    const imports = extractRelativeImports(source);
    const intraChatImports: string[] = [];

    for (const imp of imports) {
      const chatRel = resolveToChatRelative('chatTypes.ts', imp);
      if (chatRel !== null) {
        intraChatImports.push(`${imp} → ${chatRel}`);
      }
    }

    expect(intraChatImports).toEqual([]);
    if (intraChatImports.length > 0) {
      console.error(
        `[TYPE HUB VIOLATION] chatTypes.ts must have zero intra-chat imports.\n` +
        `  Found: ${intraChatImports.join(', ')}`,
      );
    }
  });

  // ── Icon leaf purity: chatIcons.ts has zero intra-chat imports ──────────

  it('chatIcons.ts has zero intra-chat imports (icon leaf purity)', () => {
    const fullPath = resolve(CHAT_DIR, 'chatIcons.ts');
    const source = readFileSync(fullPath, 'utf-8');
    const imports = extractRelativeImports(source);
    const intraChatImports: string[] = [];

    for (const imp of imports) {
      const chatRel = resolveToChatRelative('chatIcons.ts', imp);
      if (chatRel !== null) {
        intraChatImports.push(`${imp} → ${chatRel}`);
      }
    }

    expect(intraChatImports).toEqual([]);
    if (intraChatImports.length > 0) {
      console.error(
        `[ICON LEAF VIOLATION] chatIcons.ts must have zero intra-chat imports.\n` +
        `  Found: ${intraChatImports.join(', ')}`,
      );
    }
  });

  // ── Coverage: every .ts file in chat is accounted for ───────────────────

  it('every chat .ts file is in FOLDER_RULES or EXEMPT_FILES', () => {
    const allTsFiles = collectTsFiles(CHAT_DIR);
    const missingFiles: string[] = [];

    // chatTypes.ts and chatIcons.ts are covered by their own purity tests
    const specialFiles = new Set(['chatTypes.ts', 'chatIcons.ts']);

    for (const file of allTsFiles) {
      if (EXEMPT_FILES.has(file)) continue;
      if (specialFiles.has(file)) continue;
      if (FOLDER_RULES[file] !== undefined) continue;
      missingFiles.push(file);
    }

    expect(missingFiles).toEqual([]);
    if (missingFiles.length > 0) {
      console.error(
        `[COVERAGE GAP] The following .ts files are not tracked in the chat gate compliance test.\n` +
        `Add them to FOLDER_RULES, EXEMPT_FILES, or the special purity-test set:\n` +
        missingFiles.map(f => `  - ${f}`).join('\n'),
      );
    }
  });

  // ── Coverage: every non-TS file is accounted for ────────────────────────

  it('every chat non-TS file (CSS) is in EXEMPT_FILES', () => {
    const allNonTsFiles = collectNonTsFiles(CHAT_DIR);
    const missingFiles: string[] = [];

    for (const file of allNonTsFiles) {
      // Construct base name for checking — CSS in subfolders need full path
      if (EXEMPT_FILES.has(file)) continue;
      missingFiles.push(file);
    }

    expect(missingFiles).toEqual([]);
    if (missingFiles.length > 0) {
      console.error(
        `[COVERAGE GAP] The following non-TS files are not tracked:\n` +
        missingFiles.map(f => `  - ${f}`).join('\n'),
      );
    }
  });

  // ── Root file count ≤ 5 ────────────────────────────────────────────────

  it('chat root has ≤ 5 .ts files', () => {
    const rootEntries = readdirSync(CHAT_DIR);
    const rootTsFiles = rootEntries.filter(
      e => e.endsWith('.ts') && !e.endsWith('.d.ts') && statSync(resolve(CHAT_DIR, e)).isFile(),
    );

    expect(rootTsFiles.length).toBeLessThanOrEqual(5);
    if (rootTsFiles.length > 5) {
      console.error(
        `[ROOT BLOAT] Chat root has ${rootTsFiles.length} .ts files (max 5):\n` +
        rootTsFiles.map(f => `  - ${f}`).join('\n'),
      );
    }
  });
});
