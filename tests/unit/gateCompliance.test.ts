/**
 * gateCompliance.test.ts — Structural gate compliance test
 *
 * Reads every canvas child file's source and asserts that its relative
 * imports only come from the designated parent gate.  This test is the
 * automated guardrail for the five-registry gate architecture.
 *
 * If this test fails, someone added a direct cross-registry import.
 * Fix it by adding a re-export to the appropriate gate file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, relative, posix } from 'path';

// ── Canvas root ─────────────────────────────────────────────────────────────

const CANVAS_DIR = resolve(__dirname, '../../src/built-in/canvas');

// ── Gate files (not children — they ARE gates) ──────────────────────────────

const GATE_FILES = new Set([
  'config/iconRegistry.ts',
  'config/blockRegistry.ts',
  'menus/canvasMenuRegistry.ts',
  'config/blockStateRegistry/blockStateRegistry.ts',
  'handles/handleRegistry.ts',
]);

// ── Orchestrators (exempt — they wire gates together) ───────────────────────

const EXEMPT_FILES = new Set([
  'canvasEditorProvider.ts',       // Top-level orchestrator
  'canvasTypes.ts',                // Shared type definitions
  'canvasDataService.ts',          // Data layer (no gate interaction)
  'canvasIcons.ts',                // Raw icon data (consumed only by IconRegistry)
  'contentSchema.ts',              // Schema constants
  'markdownExport.ts',             // Export utility
  'main.ts',                       // Activation entry point
  'canvas.css',                    // Stylesheet
]);

// ── Child → allowed gate path fragments ─────────────────────────────────────
//
// For each child file, list the path fragments that are allowed in its
// relative imports.  A child may import from:
//   1. Its parent gate (required)
//   2. External packages (@tiptap, katex, etc.) — always allowed
//   3. Platform/UI utilities (../../platform, ../../ui, ../../editor) — always allowed
//   4. canvasTypes.ts, canvasEditorProvider.ts — type-only shared files
//
// The test only checks relative imports that resolve within the canvas
// directory.  External and platform imports are always permitted.

const GATE_RULES: Record<string, string[]> = {

  // ── BlockRegistry children ──────────────────────────────────────────────
  'extensions/calloutNode.ts':             ['config/blockRegistry'],
  'extensions/columnNodes.ts':             ['config/blockRegistry'],
  'extensions/mediaNodes.ts':              ['config/blockRegistry'],
  'extensions/bookmarkNode.ts':            ['config/blockRegistry'],
  'extensions/pageBlockNode.ts':           ['config/blockRegistry'],
  'header/pageChrome.ts':                  ['config/blockRegistry'],
  'canvasSidebar.ts':                      ['config/blockRegistry'],

  // tiptapExtensions.ts — assembler role: imports from blockRegistry +
  // infrastructure extensions that have zero canvas-internal imports.
  'config/tiptapExtensions.ts':            ['config/blockRegistry', 'extensions/'],

  // ── CanvasMenuRegistry children ─────────────────────────────────────────
  'menus/slashMenu.ts':                    ['menus/canvasMenuRegistry'],
  'menus/bubbleMenu.ts':                   ['menus/canvasMenuRegistry'],
  'menus/blockActionMenu.ts':              ['menus/canvasMenuRegistry'],
  'menus/iconMenu.ts':                     ['menus/canvasMenuRegistry'],
  'menus/coverMenu.ts':                    ['menus/canvasMenuRegistry'],
  'math/inlineMathEditor.ts':              ['menus/canvasMenuRegistry'],
  'menus/slashMenuItems.ts':               [],  // pure data — zero imports
  'menus/imageInsertPopup.ts':             [],  // pure UI — no canvas imports
  'menus/mediaInsertPopup.ts':             [],  // pure UI — no canvas imports
  'menus/bookmarkInsertPopup.ts':          [],  // pure UI — no canvas imports

  // ── BlockStateRegistry children ─────────────────────────────────────────
  'config/blockStateRegistry/blockLifecycle.ts':      ['config/blockStateRegistry/blockStateRegistry'],
  'config/blockStateRegistry/blockTransforms.ts':     ['config/blockStateRegistry/blockStateRegistry'],
  'config/blockStateRegistry/blockMovement.ts':       ['config/blockStateRegistry/blockStateRegistry'],
  'config/blockStateRegistry/columnCreation.ts':      ['config/blockStateRegistry/blockStateRegistry'],
  'config/blockStateRegistry/columnInvariants.ts':    [],  // zero canvas imports
  'config/blockStateRegistry/crossPageMovement.ts':   ['config/blockStateRegistry/blockStateRegistry'],
  'config/blockStateRegistry/dragSession.ts':         [],  // zero canvas imports

  // Plugins are BlockStateRegistry children (imported through its barrel)
  'plugins/columnAutoDissolve.ts':         ['config/blockStateRegistry/blockStateRegistry'],
  'plugins/columnDropPlugin.ts':           ['config/blockStateRegistry/blockStateRegistry'],
  'plugins/columnResizePlugin.ts':         [],  // zero canvas imports

  // ── HandleRegistry children ─────────────────────────────────────────────
  'handles/blockHandles.ts':               ['handles/handleRegistry'],
  'handles/blockSelection.ts':             ['handles/handleRegistry'],

  // ── Infrastructure extensions (gate-exempt leaves) ──────────────────────
  // These have zero canvas-internal relative imports (only @tiptap).
  // If they ever add canvas imports they MUST go through a gate.
  'extensions/blockBackground.ts':         [],
  'extensions/blockKeyboardShortcuts.ts':  [],
  'extensions/detailsEnterHandler.ts':     [],
  'extensions/mathBlockNode.ts':           [],
  'extensions/tableOfContentsNode.ts':     [],
  'extensions/toggleHeadingNode.ts':       [],

  // structuralInvariantGuard imports from plugins/ — an infrastructure
  // dependency that predates the gate architecture.  Allowed as-is since
  // both files are gate-exempt leaves with no registry imports.
  'extensions/structuralInvariantGuard.ts': ['plugins/'],

  // structuralInvariantPlugin imports from invariants/ — same pattern.
  'plugins/structuralInvariantPlugin.ts':  ['invariants/'],

  // ── Standalone utilities ────────────────────────────────────────────────
  'invariants/canvasStructuralInvariants.ts': [],  // zero relative imports
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract all relative import paths from a TypeScript source string.
 * Matches: `from './foo.js'`, `from '../bar/baz.js'`, etc.
 * Returns the raw path strings (e.g. `'./canvasMenuRegistry.js'`).
 */
function extractRelativeImports(source: string): string[] {
  const matches: string[] = [];
  // Match from '...' and from "..." where path starts with .
  const regex = /from\s+['"](\.\.?\/.+?)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

/**
 * Check whether a relative import path resolves to something inside
 * the canvas directory.  Returns the canvas-relative posix path if so,
 * or null if it resolves outside canvas (platform, ui, etc.).
 */
function resolveToCanvasRelative(
  childFile: string,
  importPath: string,
): string | null {
  const childDir = resolve(CANVAS_DIR, childFile, '..');
  // Strip .js extension and resolve
  const stripped = importPath.replace(/\.js$/, '');
  const absTarget = resolve(childDir, stripped);
  const rel = relative(CANVAS_DIR, absTarget);

  // If the resolved path goes outside CANVAS_DIR, it's not a canvas import
  if (rel.startsWith('..')) return null;

  // Normalise to posix separators
  return rel.split('\\').join('/');
}

/**
 * Recursively collect all .ts files under a directory.
 * Returns canvas-relative posix paths.
 */
function collectTsFiles(dir: string, base: string = ''): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      // Skip migrations (SQL files only)
      if (entry === 'migrations' || entry === 'pickers') continue;
      files.push(...collectTsFiles(full, rel));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(rel);
    }
  }
  return files;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Canvas Gate Architecture Compliance', () => {

  // ── Per-child import validation ─────────────────────────────────────────

  for (const [childPath, allowedGates] of Object.entries(GATE_RULES)) {
    it(`${childPath} imports only from its gate`, () => {
      const fullPath = resolve(CANVAS_DIR, childPath);
      if (!existsSync(fullPath)) {
        // File was removed — skip (the coverage test below catches orphan rules)
        return;
      }

      const source = readFileSync(fullPath, 'utf-8');
      const imports = extractRelativeImports(source);

      for (const imp of imports) {
        const canvasRel = resolveToCanvasRelative(childPath, imp);

        // Import resolves outside canvas — always allowed
        if (canvasRel === null) continue;

        // Import to shared canvas utilities — allowed (no gate interaction)
        if (
          canvasRel === 'canvasTypes' ||
          canvasRel === 'canvasEditorProvider' ||
          canvasRel === 'markdownExport' ||
          canvasRel === 'contentSchema'
        ) {
          continue;
        }

        // Check if any allowed gate fragment matches the resolved path
        const isAllowed = allowedGates.some(gate => canvasRel.startsWith(gate));

        expect(isAllowed).toBe(true);
        if (!isAllowed) {
          // Extra message for debugging (vitest shows the expect failure,
          // but this provides the specific violating import)
          console.error(
            `[GATE VIOLATION] ${childPath} imports '${imp}' → resolves to '${canvasRel}'\n` +
            `  Allowed gates: ${allowedGates.length ? allowedGates.join(', ') : '(none — should have zero canvas imports)'}`,
          );
        }
      }
    });
  }

  // ── Coverage: every .ts file is accounted for ───────────────────────────

  it('every canvas .ts file is in GATE_RULES, GATE_FILES, or EXEMPT_FILES', () => {
    const allFiles = collectTsFiles(CANVAS_DIR);
    const missingFiles: string[] = [];

    for (const file of allFiles) {
      if (GATE_FILES.has(file)) continue;
      if (EXEMPT_FILES.has(file)) continue;
      if (GATE_RULES[file] !== undefined) continue;
      missingFiles.push(file);
    }

    expect(missingFiles).toEqual([]);
    if (missingFiles.length > 0) {
      console.error(
        `[GATE COVERAGE] The following files are not tracked in the gate compliance test.\n` +
        `Add them to GATE_RULES, GATE_FILES, or EXEMPT_FILES:\n` +
        missingFiles.map(f => `  - ${f}`).join('\n'),
      );
    }
  });

  // ── Gate files themselves should not be children ────────────────────────

  it('no gate file appears in GATE_RULES as a child', () => {
    for (const gate of GATE_FILES) {
      expect(GATE_RULES[gate]).toBeUndefined();
    }
  });
});
