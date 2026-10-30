// referenceDocs.test.ts — docs/reference/{commands,settings,views}.md are
// written from the registries (the command descriptors, the built-in and
// extension manifests) and cannot drift: this test renders them again and
// compares. `npm run build` runs scripts/build-reference.mjs, which runs
// this file with UPDATE_REFERENCE=1 to write them.
// docs/SELF_DESCRIBING_UI_DESIGN.md section 8.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as manifests from '../../src/workbench/builtinManifests.js';
import type { IToolManifest } from '../../src/tools/toolManifest.js';
import type { CommandDescriptor } from '../../src/commands/commandTypes.js';
import * as diagnosticsCommands from '../../src/commands/diagnosticsCommands.js';
import * as doclingCommands from '../../src/commands/doclingCommands.js';
import * as editorCommands from '../../src/commands/editorCommands.js';
import * as fileCommands from '../../src/commands/fileCommands.js';
import * as focusCommands from '../../src/commands/focusCommands.js';
import * as modelCallsCommands from '../../src/commands/modelCallsCommands.js';
import * as layoutCommands from '../../src/commands/layoutCommands.js';
import * as questionCommands from '../../src/commands/questionCommands.js';
import * as startCommands from '../../src/commands/startCommands.js';
import * as structuralCommands from '../../src/commands/structuralCommands.js';
import * as textSizeCommands from '../../src/commands/textSizeCommands.js';
import * as viewCommands from '../../src/commands/viewCommands.js';
import * as workspaceCommands from '../../src/commands/workspaceCommands.js';

const ROOT = resolve(__dirname, '../..');
const OUT = resolve(ROOT, 'docs/reference');

/** The core command modules, by file name; the test below keeps this list complete. */
const COMMAND_MODULES: Record<string, Record<string, unknown>> = {
  'diagnosticsCommands.ts': diagnosticsCommands,
  'doclingCommands.ts': doclingCommands,
  'editorCommands.ts': editorCommands,
  'fileCommands.ts': fileCommands,
  'focusCommands.ts': focusCommands,
  'layoutCommands.ts': layoutCommands,
  'modelCallsCommands.ts': modelCallsCommands,
  'questionCommands.ts': questionCommands,
  'startCommands.ts': startCommands,
  'structuralCommands.ts': structuralCommands,
  'textSizeCommands.ts': textSizeCommands,
  'viewCommands.ts': viewCommands,
  'workspaceCommands.ts': workspaceCommands,
};

function isDescriptor(v: unknown): v is CommandDescriptor {
  return !!v && typeof v === 'object' && typeof (v as CommandDescriptor).id === 'string'
    && typeof (v as CommandDescriptor).title === 'string' && typeof (v as CommandDescriptor).handler === 'function';
}

function allBuiltinManifests(): IToolManifest[] {
  return Object.entries(manifests).filter(([n]) => n.endsWith('_MANIFEST')).map(([, m]) => m as IToolManifest);
}

function extensionManifests(): IToolManifest[] {
  const dir = resolve(ROOT, 'ext');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(dir, d.name, 'parallx-manifest.json')))
    .map((d) => JSON.parse(readFileSync(resolve(dir, d.name, 'parallx-manifest.json'), 'utf8')) as IToolManifest)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const ownerOf = (manifestId: string): string => manifestId.split('.').pop() ?? manifestId;
const cell = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v)).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const byOwnerThenId = <T extends { owner: string; id: string }>(a: T, b: T): number => a.owner.localeCompare(b.owner) || a.id.localeCompare(b.id);

const HEADER = (what: string) => `<!-- Written by scripts/build-reference.mjs from ${what}. Do not edit: run npm run build. -->\n\n`;

function renderCommands(): string {
  const rows: { id: string; title: string; owner: string; category?: string; keybinding?: string; when?: string }[] = [];
  const seen = new Set<string>();
  const add = (r: typeof rows[number]): void => { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } };
  for (const mod of Object.values(COMMAND_MODULES)) {
    for (const value of Object.values(mod)) {
      for (const d of Array.isArray(value) ? value : [value]) {
        if (isDescriptor(d)) add({ id: d.id, title: d.title, owner: 'core', category: d.category, keybinding: d.keybinding, when: d.when });
      }
    }
  }
  for (const m of [...allBuiltinManifests(), ...extensionManifests()]) {
    for (const c of m.contributes?.commands ?? []) add({ id: c.id, title: c.title, owner: ownerOf(m.id), category: c.category, keybinding: c.keybinding });
  }
  rows.sort(byOwnerThenId);
  const lines = ['# Commands', '', HEADER('the command descriptors and the manifests').trim(), '',
    'Every command the app and its tools register, with the tool that owns it (`core` is the workbench). A when-clause says when the command is available.', '',
    '| Id | Title | Owner | Category | Keybinding | When |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| \`${r.id}\` | ${cell(r.title)} | ${r.owner} | ${cell(r.category)} | ${cell(r.keybinding)} | ${cell(r.when)} |`);
  return lines.join('\n') + '\n';
}

function renderSettings(): string {
  const rows: { id: string; owner: string; group: string; type: string; def: string; description: string }[] = [];
  for (const m of [...allBuiltinManifests(), ...extensionManifests()]) {
    for (const group of m.contributes?.configuration ?? []) {
      for (const [key, p] of Object.entries(group.properties)) {
        rows.push({ id: key, owner: ownerOf(m.id), group: group.title, type: p.enum ? p.enum.join(' \\| ') : p.type, def: p.default === undefined ? '' : JSON.stringify(p.default), description: p.description ?? '' });
      }
    }
  }
  rows.sort(byOwnerThenId);
  const lines = ['# Settings', '', HEADER('the manifests\' configuration').trim(), '',
    'The settings tools declare in their manifests, with the tool that owns each. Settings the workbench and its services register at run time (for the AI, the canvas, Python) are in the settings editor under their own groups and are not listed here.', '',
    '| Key | Type | Default | Owner | Group | Description |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| \`${r.id}\` | ${cell(r.type)} | ${cell(r.def)} | ${r.owner} | ${cell(r.group)} | ${cell(r.description)} |`);
  return lines.join('\n') + '\n';
}

function renderViews(): string {
  const containers: { id: string; owner: string; title: string; location: string; hidden: boolean }[] = [];
  const views: { id: string; owner: string; name: string; container: string; when?: string }[] = [];
  for (const m of [...allBuiltinManifests(), ...extensionManifests()]) {
    for (const c of m.contributes?.viewContainers ?? []) containers.push({ id: c.id, owner: ownerOf(m.id), title: c.title, location: c.location, hidden: !!c.hidden });
    for (const v of m.contributes?.views ?? []) views.push({ id: v.id, owner: ownerOf(m.id), name: v.name, container: v.defaultContainerId ?? '', when: v.when });
  }
  containers.sort(byOwnerThenId);
  views.sort(byOwnerThenId);
  const lines = ['# Views', '', HEADER('the manifests\' view containers and views').trim(), '',
    'The view containers (an activity bar icon, a panel tab) and the views tools contribute, with the tool that owns each.', '',
    '## View containers', '', '| Id | Title | Owner | Location | Hidden |', '|---|---|---|---|---|'];
  for (const c of containers) lines.push(`| \`${c.id}\` | ${cell(c.title)} | ${c.owner} | ${c.location} | ${c.hidden ? 'yes' : ''} |`);
  lines.push('', '## Views', '', '| Id | Name | Owner | Container | When |', '|---|---|---|---|---|');
  for (const v of views) lines.push(`| \`${v.id}\` | ${cell(v.name)} | ${v.owner} | ${cell(v.container)} | ${cell(v.when)} |`);
  return lines.join('\n') + '\n';
}

const FILES: Record<string, () => string> = { 'commands.md': renderCommands, 'settings.md': renderSettings, 'views.md': renderViews };

describe('reference docs', () => {
  it('lists every command module that holds descriptors', () => {
    const dir = resolve(ROOT, 'src/commands');
    const holders = readdirSync(dir).filter((f) => f.endsWith('.ts') && /CommandDescriptor(\[\])? = [{[]/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(holders.sort()).toEqual(Object.keys(COMMAND_MODULES).sort());
  });

  for (const [name, render] of Object.entries(FILES)) {
    it(`docs/reference/${name} matches the registries`, () => {
      const path = resolve(OUT, name);
      const text = render();
      // A Windows checkout has CRLF line ends (core.autocrlf); the content is what counts.
      const onDisk = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
      if (process.env.UPDATE_REFERENCE) {
        mkdirSync(OUT, { recursive: true });
        if (onDisk !== text) writeFileSync(path, text);
        return;
      }
      expect(onDisk, `${name} is stale: run npm run build (or UPDATE_REFERENCE=1 npx vitest run tests/unit/referenceDocs.test.ts)`).toBe(text);
    });
  }
});
