// coreThemeNamesNoTool.test.ts — the core's design vocabulary names no
// optional tool (audit #31). A tool's tokens, icons and empty-state lines
// live with the tool and arrive while it runs.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { BRAND_ICONS } from '../../src/ui/brandIcons';
import { EMPTY_STATES } from '../../src/ui/emptyStates';
import { IconContributionProcessor } from '../../src/contributions/iconContribution';
import { getIcon, hasIcon } from '../../src/ui/iconRegistry';
import * as builtins from '../../src/tools/builtinManifests';
import type { IToolDescription, IToolManifest } from '../../src/tools/toolManifest';
import { validateManifest } from '../../src/tools/toolValidator';

const ROOT = resolve(__dirname, '../..');
const read = (f: string): string => readFileSync(resolve(ROOT, f), 'utf8');

/** Words that name a tool the user can turn off. */
const OPTIONAL_TOOL = /planner|worksheet|flashcard|budget|atelier|media-organizer|web-research|workspace-graph|automations|agents/i;

describe('core theme and UI vocabulary name no optional tool', () => {
  it('px-tokens.css and px-base.css define nothing for Planner or Worksheets', () => {
    for (const f of ['src/theme/px-tokens.css', 'src/theme/px-base.css']) {
      expect(read(f)).not.toMatch(/planner|worksheet/i);
    }
  });

  it('the planner and worksheet tokens are defined by their own stylesheets', () => {
    expect(read('src/built-in/planner/planner.css')).toMatch(/--px-planner-event-tint:/);
    expect(read('src/built-in/planner/planner.css')).toMatch(/--px-planner-now:/);
    expect(read('src/built-in/worksheet/worksheet.css')).toMatch(/--px-worksheet-sheet-font:/);
  });

  it('brand icons are the core nouns only', () => {
    expect(Object.keys(BRAND_ICONS).sort()).toEqual(
      ['px-ai-mark', 'px-canvas', 'px-dashboard', 'px-mark', 'px-tools'],
    );
  });

  it('core empty states belong to core surfaces', () => {
    for (const id of Object.keys(EMPTY_STATES)) {
      expect(id).toMatch(/^(canvas|chat|toolGallery)\./);
      const { headline, hint } = EMPTY_STATES[id as keyof typeof EMPTY_STATES];
      expect(`${headline} ${hint}`).not.toMatch(OPTIONAL_TOOL);
    }
  });

  it('every px-* icon a manifest names is a core icon or one it brings', () => {
    const manifests: IToolManifest[] = [
      ...Object.values(builtins).filter((m): m is IToolManifest => typeof m === 'object' && m !== null && 'contributes' in m),
      ...globSync('ext/*/parallx-manifest.json', { cwd: ROOT }).map((f) => JSON.parse(read(f)) as IToolManifest),
    ];
    const missing: string[] = [];
    for (const m of manifests) {
      const c = m.contributes ?? {};
      const own = new Set((c.icons ?? []).map((i) => i.id));
      const named = [...(c.viewContainers ?? []), ...(c.views ?? []), ...(c.commands ?? [])].map((x) => x.icon);
      for (const id of named) {
        if (id?.startsWith('px-') && !(id in BRAND_ICONS) && !own.has(id)) missing.push(`${m.id}: ${id}`);
      }
      if (c.icons) expect(validateManifest(m).errors).toEqual([]);
    }
    expect(missing).toEqual([]);
  });
});

describe('contributes.icons', () => {
  const desc = (id: string, icons: { id: string; svg: string }[]): IToolDescription =>
    ({ manifest: { id, contributes: { icons } } } as unknown as IToolDescription);

  it('registers a tool\'s icons while it runs and removes them when it stops', () => {
    const p = new IconContributionProcessor();
    const svg = '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>';
    p.processContributions(desc('t.one', [{ id: 'px-test-one', svg }]));
    expect(getIcon('px-test-one')).toBe(svg);
    p.removeContributions('t.one');
    expect(hasIcon('px-test-one')).toBe(false);
  });

  it('cannot replace an icon the app already has', () => {
    const p = new IconContributionProcessor();
    const before = getIcon('px-mark');
    p.processContributions(desc('t.two', [{ id: 'px-mark', svg: '<svg></svg>' }]));
    expect(getIcon('px-mark')).toBe(before);
    p.removeContributions('t.two');
    expect(getIcon('px-mark')).toBe(before);
  });
});
