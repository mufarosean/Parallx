/**
 * Built-in activation dependency guard (§22 regression — class caught by
 * chat/main.ts:310 defensive throw, 2026-05-23).
 *
 * A built-in `main.ts` may consume DI services in three shapes:
 *
 *     api.services.get(IXxx)              ← HARD dependency at activate time
 *     api.services.has(IXxx) ? get(IXxx)  ← SOFT dependency, may be absent
 *     services.registerInstance(IXxx, …)  ← contributes a new service
 *
 * If a hard dependency is not registered in `src/workbench/workbenchServices.ts`
 * before the consuming built-in activates, the built-in throws at startup —
 * the user sees a toast and a degraded workbench. M58-real's
 * `[chat] IAutonomyLogService not registered — workbench bootstrap order broken`
 * defensive throw is the in-source expression of this bug class.
 *
 * This guard runs at unit-test time and asserts: for every built-in
 * `src/built-in/<name>/main.ts`, every service id read via a
 * `api.services.get(IXxx)` that is NOT wrapped by a sibling `has(IXxx)` check
 * must appear in `workbenchServices.ts` as `services.registerInstance(IXxx, …)`.
 *
 * Brittle facts the guard relies on:
 *  - Service identifiers follow the convention `IXxxService` (PascalCase, `I`-prefixed).
 *  - `workbenchServices.ts` is the composition root for every service a
 *    built-in expects to find at activation time.
 *
 * If either convention changes the regex below must be widened, not the
 * production behaviour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUILT_IN_DIR = path.join(REPO_ROOT, 'src', 'built-in');
// All workbench composition sites — `workbenchServices.ts` is the bulk of
// them, but `workbench.ts` itself registers a handful of services it owns
// directly (IThemeService, IGlobalStorageService, IWorkspaceStorageService,
// ICanvasBlockTypeRegistryService, …).
const REGISTRATION_FILES = [
  path.join(REPO_ROOT, 'src', 'workbench', 'workbenchServices.ts'),
  path.join(REPO_ROOT, 'src', 'workbench', 'workbench.ts'),
];

// Match `api.services.get(IXxxService)` or `services.get(IXxxService)`,
// optionally preceded by a type-cast generic parameter. The captured id is
// the service identifier reference.
const GET_RE = /\b(?:api\.)?services\.get(?:<[^>]+>)?\(\s*(I[A-Z][A-Za-z0-9]*Service)\b/g;
// Match `api.services.has(IXxxService)` or `services.has(IXxxService)`.
const HAS_RE = /\b(?:api\.)?services\.has\(\s*(I[A-Z][A-Za-z0-9]*Service)\b/g;

function listBuiltInMains(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(BUILT_IN_DIR)) {
    const dir = path.join(BUILT_IN_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const main = path.join(dir, 'main.ts');
    try {
      if (statSync(main).isFile()) out.push(main);
    } catch {
      // no main.ts — skip
    }
  }
  return out;
}

function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

function stripComments(src: string): string {
  // Remove block comments first, then line comments. Conservative — does not
  // try to parse string literals, but the regexes we feed it are anchored to
  // `services.get(IXxxService)` shapes which do not appear in string content
  // anywhere in src/built-in.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

function collectMatches(re: RegExp, src: string): string[] {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex because the regex is /g and we are reusing it across files.
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) ids.push(m[1]);
  return ids;
}

describe('built-in activation DI dependencies', () => {
  // Lines like `services.registerInstance(IFooService, …)` or
  // `this._services.registerInstance(IFooService, …)` — capture each id.
  const REG_RE = /\.registerInstance\(\s*(I[A-Z][A-Za-z0-9]*Service)\b/g;
  const registered = new Set<string>();
  for (const file of REGISTRATION_FILES) {
    for (const id of collectMatches(REG_RE, readFileSync(file, 'utf8'))) {
      registered.add(id);
    }
  }

  // Sanity canary so a future regex regression cannot silently pass on an
  // empty registration set.
  it('discovers a non-trivial set of service registrations in workbench composition roots', () => {
    expect(registered.size).toBeGreaterThan(10);
  });

  const mains = listBuiltInMains();

  it('discovers built-in main.ts files', () => {
    expect(mains.length).toBeGreaterThan(0);
  });

  for (const mainPath of mains) {
    const builtInName = path.basename(path.dirname(mainPath));
    it(`built-in '${builtInName}' has every hard service dep registered in workbenchServices.ts`, () => {
      const src = stripComments(readFileSync(mainPath, 'utf8'));
      const gets = uniq(collectMatches(GET_RE, src));
      const hases = new Set(collectMatches(HAS_RE, src));
      // Local self-registrations: a built-in may construct and register a
      // service inside its own activate before consuming it (e.g. chat's
      // ICronService). Those are NOT workbench-bootstrap dependencies.
      const SELF_REG_RE = /\bservices\.registerInstance\(\s*(I[A-Z][A-Za-z0-9]*Service)\b/g;
      const selfRegs = new Set(collectMatches(SELF_REG_RE, src));
      // A hard dependency = used in .get() AND NEVER guarded by .has() in the
      // same file. Soft dependencies (always guarded) are ignored.
      const hardDeps = gets.filter((id) => !hases.has(id) && !selfRegs.has(id));
      const missing = hardDeps.filter((id) => !registered.has(id));
      expect(missing, `Built-in '${builtInName}' calls api.services.get() on these unregistered ids — startup will throw: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
