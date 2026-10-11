// extUndefinedNames.test.ts — every name an extension uses exists.
//
// Extensions are plain JavaScript, which `tsc --noEmit` never sees, so a
// typo or a leftover rename (`_db` for `db`) only shows when a user clicks
// the button that runs it. This runs the TypeScript checker over each
// extension's files and fails on "Cannot find name".

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const EXT_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../ext');

/** Names a file tests with `typeof x !== 'undefined'` before using (Firefox's `dump`). */
const GUARDED_GLOBALS = new Set(['dump']);

const CANNOT_FIND_NAME = 2304;
const CANNOT_FIND_NAME_DID_YOU_MEAN = 2552;

function extensionFolders(): string[] {
  return readdirSync(EXT_ROOT).filter((d) => existsSync(path.join(EXT_ROOT, d, 'parallx-manifest.json'))).sort();
}

function undefinedNames(folder: string): string[] {
  const dir = path.join(EXT_ROOT, folder);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
  const program = ts.createProgram(files, {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    skipLibCheck: true,
    types: [],
  });
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.code === CANNOT_FIND_NAME || d.code === CANNOT_FIND_NAME_DID_YOU_MEAN)
    .map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      const name = /Cannot find name '([^']+)'/.exec(text)?.[1] ?? '';
      const where = d.file && d.start !== undefined
        ? `${path.relative(EXT_ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
        : '?';
      return { name, line: `${where} ${text}` };
    })
    .filter((d) => !GUARDED_GLOBALS.has(d.name))
    .map((d) => d.line);
}

describe('extensions use only names that exist', () => {
  for (const folder of extensionFolders()) {
    it(`ext/${folder}`, () => {
      expect(undefinedNames(folder)).toEqual([]);
    }, 60_000);
  }
});
