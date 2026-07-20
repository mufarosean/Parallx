// toolEditorIconPersistence.test.ts — Open Editors icon fix (2026-07-20).
//
// Regression pin: tool editors (planner, dashboards) pass a pre-rendered
// iconHtml at open time, but workspace restore dropped it ("view artefact"
// contract that only canvas honored) — after ANY restart every tool editor
// showed the generic file icon in Open Editors and the tab bar. iconHtml
// now round-trips through serialize().

import { describe, expect, it } from 'vitest';
import { ToolEditorInput } from '../../src/api/bridges/editorsBridge';

const SVG = '<svg data-test="planner"></svg>';
const provider = { createEditorPane: () => ({ dispose() {} }) } as never;

describe('ToolEditorInput icon persistence', () => {
  it('serialize() carries iconHtml', () => {
    const input = new ToolEditorInput('planner', 'Planner', 'calendar', SVG, provider, 'planner:main', 'planner');
    const entry = input.serialize();
    expect((entry.data as { iconHtml?: string }).iconHtml).toBe(SVG);
    expect((entry.data as { icon?: string }).icon).toBe('calendar');
  });

  it('a restored input exposes the persisted iconHtml (what Open Editors renders)', () => {
    const original = new ToolEditorInput('dashboard', 'Home', undefined, SVG, provider, 'dash:home', 'dashboard');
    const data = original.serialize().data as { inputId: string; name: string; icon?: string; iconHtml?: string };
    // Mirror the deserializer's reconstruction.
    const restored = new ToolEditorInput('dashboard', data.name, data.icon, data.iconHtml, provider, data.inputId, 'dashboard');
    expect(restored.iconHtml).toBe(SVG);
  });

  it('setIconHtml still lets providers re-resolve after restore (canvas contract)', () => {
    const input = new ToolEditorInput('canvas', 'Page', undefined, '<svg data-old/>', provider, 'p1', 'canvas');
    let fired = 0;
    input.onDidChangeLabel(() => fired++);
    input.setIconHtml('<svg data-new/>');
    expect(input.iconHtml).toBe('<svg data-new/>');
    expect(fired).toBe(1);
  });
});
