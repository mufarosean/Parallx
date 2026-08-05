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

// ─── instanceId contract (2026-08-06) ────────────────────────────────────────
//
// Regression pin for the canvas blank-page data-scare: input ids are
// namespaced tool:type:instance for tab uniqueness, and the DOMAIN id the
// tool passed to openEditor rides separately as `instanceId`. Canvas resolved
// pages by parsing input.id; when namespacing landed, every restored page
// opened empty (the row was safe — the pane just looked up the wrong key).

describe('ToolEditorInput instanceId contract', () => {
  it('carries the domain id separately from the namespaced input id', () => {
    const input = new ToolEditorInput('canvas', 'Page', undefined, undefined, provider,
      'parallx.canvas:canvas:page-uuid-1', 'parallx.canvas', 'page-uuid-1');
    expect(input.id).toBe('parallx.canvas:canvas:page-uuid-1');
    expect(input.instanceId).toBe('page-uuid-1');
  });

  it('serialize() persists instanceId so restore does not have to parse ids', () => {
    const input = new ToolEditorInput('media-organizer-grid', 'Grid', undefined, undefined, provider,
      'parallx.mo:media-organizer-grid:grid:all', 'parallx.mo', 'grid:all');
    const data = input.serialize().data as { instanceId?: string };
    // 'grid:all' contains a colon — parsing it back out of the namespaced id
    // is exactly the ambiguity the persisted field exists to avoid.
    expect(data.instanceId).toBe('grid:all');
  });

  it('round-trips through the deserializer reconstruction shape', () => {
    const original = new ToolEditorInput('canvas', 'Page', undefined, undefined, provider,
      'parallx.canvas:canvas:page-uuid-2', 'parallx.canvas', 'page-uuid-2');
    const data = original.serialize().data as {
      inputId: string; instanceId?: string; name: string; icon?: string; iconHtml?: string;
    };
    const restored = new ToolEditorInput('canvas', data.name, data.icon, data.iconHtml, provider,
      data.inputId, 'parallx.canvas', data.instanceId);
    expect(restored.instanceId).toBe('page-uuid-2');
    expect(restored.id).toBe(original.id);
  });
});
