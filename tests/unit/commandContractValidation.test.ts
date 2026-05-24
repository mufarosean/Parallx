/**
 * Command contract validation (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 lists `commandContractValidation.test.ts` as a required
 * gate before Slice B merge. The test was never authored. This file is
 * that gate, retroactively closing the verification debt.
 *
 * Validates that every `contributes.commands[*]` entry across every
 * `parallx-manifest.json` in the repo (`src/built-in/`, `ext/`,
 * `tools/samples/`) satisfies the `IManifestCommandDescriptor` contract:
 *
 *   - `id` is a non-empty string in `<namespace>.<command>` shape
 *     (one or more lowercase-dotted segments).
 *   - `title` is a non-empty string.
 *   - `aiInvocable === true` ⇒ `aiDescription` is a non-empty string
 *     (M70 invariant from `toolManifest.ts`).
 *   - `id` values are unique within a single manifest.
 *
 * If `keybindings`/`menus` reference a `command`, the referenced id must
 * exist in the same manifest's `contributes.commands` (no dangling
 * keybindings pointing at nothing).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'src', 'built-in'),
  path.join(REPO_ROOT, 'ext'),
  path.join(REPO_ROOT, 'tools', 'samples'),
];

interface ManifestCommand {
  id?: unknown;
  title?: unknown;
  aiInvocable?: unknown;
  aiDescription?: unknown;
}
interface ManifestKeybinding { command?: unknown }
interface ManifestMenuItem { command?: unknown }
interface ParallxManifest {
  contributes?: {
    commands?: ManifestCommand[];
    keybindings?: ManifestKeybinding[];
    menus?: Record<string, ManifestMenuItem[]>;
  };
}

function discoverManifests(): { name: string; file: string; manifest: ParallxManifest }[] {
  const out: { name: string; file: string; manifest: ParallxManifest }[] = [];
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const dir = path.join(root, entry);
      if (!statSync(dir).isDirectory()) continue;
      const manifestPath = path.join(dir, 'parallx-manifest.json');
      if (!existsSync(manifestPath)) continue;
      const text = readFileSync(manifestPath, 'utf8');
      let parsed: ParallxManifest;
      try {
        parsed = JSON.parse(text) as ParallxManifest;
      } catch (err) {
        throw new Error(`Failed to parse ${manifestPath}: ${(err as Error).message}`);
      }
      out.push({ name: `${path.basename(root)}/${entry}`, file: manifestPath, manifest: parsed });
    }
  }
  return out;
}

const ID_RE = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/;

describe('command contract validation (manifest contributes.commands)', () => {
  const manifests = discoverManifests();

  it('discovers manifests', () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  for (const { name, manifest } of manifests) {
    const commands = manifest.contributes?.commands;
    if (!commands || commands.length === 0) continue;

    describe(name, () => {
      const ids = new Set<string>();

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const label = typeof cmd.id === 'string' && cmd.id ? cmd.id : `[index ${i}]`;

        it(`'${label}' has a valid id`, () => {
          expect(typeof cmd.id, `command[${i}].id must be a string`).toBe('string');
          expect(cmd.id as string, `command[${i}].id must be non-empty`).not.toBe('');
          expect(cmd.id as string).toMatch(ID_RE);
        });

        it(`'${label}' has a non-empty title`, () => {
          expect(typeof cmd.title, `command '${label}'.title must be a string`).toBe('string');
          expect((cmd.title as string).trim(), `command '${label}'.title must be non-empty`).not.toBe('');
        });

        if (cmd.aiInvocable === true) {
          it(`'${label}' has aiDescription when aiInvocable`, () => {
            expect(typeof cmd.aiDescription, `command '${label}'.aiDescription required when aiInvocable=true`).toBe('string');
            expect((cmd.aiDescription as string).trim()).not.toBe('');
          });
        }

        if (typeof cmd.id === 'string' && cmd.id) {
          if (ids.has(cmd.id)) {
            it(`'${label}' id is unique within manifest`, () => {
              throw new Error(`Duplicate command id '${cmd.id}' in ${name}`);
            });
          } else {
            ids.add(cmd.id);
          }
        }
      }

      const keybindings = manifest.contributes?.keybindings ?? [];
      for (const kb of keybindings) {
        if (typeof kb.command === 'string' && kb.command) {
          it(`keybinding for '${kb.command}' references a declared command`, () => {
            expect(ids.has(kb.command as string), `Keybinding references undeclared command '${kb.command}' in ${name}`).toBe(true);
          });
        }
      }

      const menus = manifest.contributes?.menus ?? {};
      for (const [menuId, items] of Object.entries(menus)) {
        for (const item of items) {
          if (typeof item.command === 'string' && item.command) {
            it(`menu '${menuId}' item for '${item.command}' references a declared command`, () => {
              expect(ids.has(item.command as string), `Menu '${menuId}' references undeclared command '${item.command}' in ${name}`).toBe(true);
            });
          }
        }
      }
    });
  }
});
