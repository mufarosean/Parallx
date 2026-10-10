// The concept-map skill: a workflow the chat model reads before drawing a
// map. It must load like any workspace skill, keep its \n box breaks and TeX
// backslashes as typed, and its worked example must be a map the renderer
// draws whole (within 40 boxes and 5 levels), with real multi-line boxes.

import { describe, expect, it } from 'vitest';
import { defaultSkillContents } from '../../src/built-in/chat/skills/defaultSkillContents';
import { parseSkillFrontmatter, validateSkillManifest } from '../../src/services/skillLoaderService';
import { measureLabel, parseMindMap, type MindMapNode } from '../../src/ui/conceptMap';

const content = defaultSkillContents.get('concept-map')!;
// Fences open and close at a line start; the text also mentions ```mindmap inline.
const fences = [...content.matchAll(/^```mindmap[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);

const count = (nodes: readonly MindMapNode[]): number => nodes.reduce((n, c) => n + 1 + count(c.children), 0);
const depth = (nodes: readonly MindMapNode[]): number => nodes.reduce((d, c) => Math.max(d, 1 + depth(c.children)), 0);
const all = (nodes: readonly MindMapNode[]): MindMapNode[] => nodes.flatMap((c) => [c, ...all(c.children)]);

describe('concept-map skill', () => {
  it('loads as a model-invocable workflow skill', () => {
    const parsed = parseSkillFrontmatter(content);
    expect(parsed).not.toBeNull();
    const manifest = validateSkillManifest(parsed!, '.parallx/skills/concept-map/SKILL.md');
    expect(manifest?.name).toBe('concept-map');
    expect(manifest?.kind).toBe('workflow');
    expect(manifest?.description).toMatch(/mind map/);
  });

  it('keeps backticks, \\n breaks and TeX as written', () => {
    expect(content).not.toContain('´');
    expect(content).toContain('```mindmap tree');
    expect(content).toContain(String.raw`**Residual checks**\n- No curve`);
    expect(content).toContain(String.raw`\hat\beta_1 = \frac{`);
  });

  it('its worked example is a full map the renderer draws whole', () => {
    const [good, weak] = fences;
    const roots = parseMindMap(good);
    expect(roots).toHaveLength(1);
    expect(count(roots)).toBeGreaterThanOrEqual(12);
    expect(count(roots)).toBeLessThanOrEqual(40);
    expect(depth(roots)).toBeLessThanOrEqual(5);
    // No box with exactly one child, the rule the skill teaches.
    expect(all(roots).filter((n) => n.children.length === 1)).toEqual([]);
    // Several boxes hold lists or display math as rows.
    const rowBoxes = all(roots).filter((n) => measureLabel(n.label, undefined, 1).rows);
    expect(rowBoxes.length).toBeGreaterThanOrEqual(4);
    // The weak example parses too: it is shown, not broken.
    expect(count(parseMindMap(weak))).toBeGreaterThan(5);
  });
});
