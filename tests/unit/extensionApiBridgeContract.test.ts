/**
 * Extension API bridge contract (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 listed `extensionApiBridgeContract.test.ts` as a required
 * gate before Slice B merge. This file is that gate.
 *
 * The `ParallxApiObject` interface in `src/api/apiFactory.ts` IS the public
 * extension API surface. Every external extension is written against the
 * names of its top-level namespaces (`api.commands`, `api.workspace`,
 * `api.canvas`, …) and the method names on them. Silent renames break
 * every shipped extension at runtime with no compile-time signal in the
 * extension repo.
 *
 * This guard snapshots the public surface by scanning `apiFactory.ts`'s
 * `ParallxApiObject` interface and asserting:
 *
 *   1. Every namespace currently shipped is still declared.
 *   2. No new namespaces have been added without a deliberate update here.
 *   3. A representative method on each "stable" namespace is still present.
 *
 * Adding a new namespace or method? Update the expected list below in the
 * same commit. The test failing IS the M81 §22 mechanism working as
 * intended.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const API_FACTORY = path.resolve(__dirname, '..', '..', 'src', 'api', 'apiFactory.ts');

/**
 * Top-level `readonly <name>:` keys declared inside the `ParallxApiObject`
 * interface block. Order-independent.
 */
const EXPECTED_NAMESPACES = new Set([
  'views',
  'commands',
  'window',
  'context',
  'workspace',
  'editors',
  'links',
  'workspaceGraph',
  'tools',
  'env',
  'services',
  'icons',
  'lm',
  'chat',
  'canvas',
  'database',
  'mcp',
  'cron',
]);

/**
 * Method-name canaries per namespace. Each entry is a representative
 * method that has been part of the public contract for ≥1 milestone.
 * Removing or renaming any of these is a breaking change for every
 * shipped extension; this list IS the renamer's checklist.
 */
const EXPECTED_METHODS: Record<string, readonly string[]> = {
  commands: ['registerCommand', 'executeCommand'],
  views: ['registerViewProvider'],
  window: ['showInformationMessage', 'showQuickPick', 'createStatusBarItem'],
  context: ['createContextKey'],
  workspace: ['getConfiguration', 'getWorkspaceFolder'],
  editors: ['registerEditorProvider', 'openEditor', 'openFileEditor'],
  links: ['register', 'open', 'mint', 'parse'],
  tools: ['getAll', 'getById', 'isEnabled', 'setEnabled'],
  services: ['get', 'has', 'registerInstance'],
  icons: ['getIcon', 'hasIcon'],
  canvas: ['registerBlockType'],
  chat: ['createChatParticipant', 'registerTool'],
  mcp: ['invokeTool', 'listTools'],
  cron: ['upsertJob', 'removeJob'],
};

function readInterfaceBlock(): string {
  const src = readFileSync(API_FACTORY, 'utf8');
  const startMarker = 'export interface ParallxApiObject {';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('Could not locate ParallxApiObject interface in apiFactory.ts');
  // Walk braces to find matching `}` at top level.
  let depth = 0;
  let i = start + startMarker.length - 1; // points at '{'
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced braces in ParallxApiObject interface');
}

function topLevelNamespaceNames(block: string): Set<string> {
  // We want lines whose START-of-line depth is 1 (i.e. directly inside the
  // interface body, not inside a nested type).
  const lines = block.split('\n');
  const names = new Set<string>();
  let depth = 0;
  for (const line of lines) {
    const depthAtLineStart = depth;
    for (const c of line) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depthAtLineStart !== 1) continue;
    // Match `readonly <name>:` shape. Namespaces are `readonly`. Free
    // functions (e.g. `requestCapability(`) are not namespaces.
    const m = line.match(/^\s*readonly\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (m) names.add(m[1]);
  }
  return names;
}

describe('ParallxApiObject public surface contract', () => {
  const block = readInterfaceBlock();
  const actualNamespaces = topLevelNamespaceNames(block);

  it('exposes every expected namespace', () => {
    const missing = [...EXPECTED_NAMESPACES].filter((n) => !actualNamespaces.has(n));
    expect(missing, `ParallxApiObject is missing namespace(s): ${missing.join(', ')}. If intentional, update EXPECTED_NAMESPACES in this test.`).toEqual([]);
  });

  it('does not silently add a new top-level namespace without updating this contract', () => {
    const unexpected = [...actualNamespaces].filter((n) => !EXPECTED_NAMESPACES.has(n));
    expect(unexpected, `ParallxApiObject grew new namespace(s): ${unexpected.join(', ')}. Add them to EXPECTED_NAMESPACES (and EXPECTED_METHODS) in this test to acknowledge the new public surface.`).toEqual([]);
  });

  for (const [ns, methods] of Object.entries(EXPECTED_METHODS)) {
    for (const m of methods) {
      it(`namespace '${ns}' still declares method '${m}'`, () => {
        // Conservative: require the method name to appear inside the
        // interface block. Method signatures within nested types are all
        // declared by name; renames will not match.
        const pattern = new RegExp(`\\b${m}\\s*[<(]`);
        expect(pattern.test(block), `Method '${ns}.${m}' missing from ParallxApiObject. Renames break every shipped extension — bump expected list deliberately.`).toBe(true);
      });
    }
  }
});
