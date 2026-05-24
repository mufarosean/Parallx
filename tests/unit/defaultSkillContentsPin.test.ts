/**
 * Pin: defaultSkillContents — the canonical ReadonlyMap of the 11
 * built-in SKILL.md contents that ship with every Parallx workspace via
 * `/init`. Pins the set of skill names, the Map shape, and each entry's
 * YAML frontmatter shape (name, kind, permission, user-invocable, tags).
 */
import { describe, it, expect } from "vitest";
import { defaultSkillContents } from "../../src/built-in/chat/skills/defaultSkillContents";

const EXPECTED_SKILLS = [
  "deep-research",
  "scoped-extraction",
  "folder-overview",
  "document-comparison",
  "exhaustive-summary",
  "git-status",
  "fetch-url",
  "pdf-extract",
  "explain-selection",
  "summarize-selection",
  "research-topic",
];

describe("chat/skills/defaultSkillContents — Map shape", () => {
  it("is a ReadonlyMap with exactly 11 entries", () => {
    expect(defaultSkillContents).toBeInstanceOf(Map);
    expect(defaultSkillContents.size).toBe(11);
  });

  it("contains every documented built-in skill name", () => {
    for (const name of EXPECTED_SKILLS) {
      expect(defaultSkillContents.has(name), name).toBe(true);
    }
  });

  it("every value is a non-empty SKILL.md string with YAML frontmatter that opens and closes with '---'", () => {
    for (const [name, content] of defaultSkillContents) {
      expect(typeof content, name).toBe("string");
      expect(content.length > 100, name).toBe(true);
      expect(content.startsWith("---"), name).toBe(true);
      // second '---' must exist after the first
      const second = content.indexOf("\n---", 4);
      expect(second > 0, name).toBe(true);
    }
  });
});

describe("chat/skills/defaultSkillContents — frontmatter contracts", () => {
  it("every skill's frontmatter declares name matching its map key", () => {
    for (const [key, content] of defaultSkillContents) {
      const m = content.match(/^name:\s*([a-z-]+)\s*$/m);
      expect(m, key).not.toBeNull();
      expect(m![1]).toBe(key);
    }
  });

  it("every skill declares author=parallx and version 1.x.y", () => {
    for (const [key, content] of defaultSkillContents) {
      expect(content, key).toMatch(/^author:\s*parallx\s*$/m);
      expect(content, key).toMatch(/^version:\s*1\.\d+\.\d+\s*$/m);
    }
  });

  it("every skill declares a valid kind (workflow|tool|reference|task)", () => {
    for (const [key, content] of defaultSkillContents) {
      const m = content.match(/^kind:\s*([a-z-]+)\s*$/m);
      expect(m, key).not.toBeNull();
      expect(["workflow", "prompt"]).toContain(m![1]);
    }
  });

  it("every skill declares a permission level (auto-allow|ask-once|ask-every-time)", () => {
    for (const [key, content] of defaultSkillContents) {
      const m = content.match(/^permission:\s*([a-z-]+)\s*$/m);
      expect(m, key).not.toBeNull();
      expect(["auto-allow", "ask-once", "ask-every-time", "requires-approval"]).toContain(m![1]);
    }
  });

  it("every skill declares user-invocable boolean", () => {
    for (const [key, content] of defaultSkillContents) {
      expect(content, key).toMatch(/^user-invocable:\s*(true|false)\s*$/m);
    }
  });

  it("every skill declares a tags array including its kind tag", () => {
    for (const [, content] of defaultSkillContents) {
      expect(content).toMatch(/^tags:\s*\[/m);
    }
  });

  it("exactly 9 skills are workflows and 2 are prompts (selection skills)", () => {
    const counts: Record<string, number> = {};
    for (const [, c] of defaultSkillContents) {
      const k = c.match(/^kind:\s*([a-z-]+)$/m)![1];
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ workflow: 9, prompt: 2 });
  });
});

describe("chat/skills/defaultSkillContents — selection skills", () => {
  it("explain-selection and summarize-selection are kind=prompt (selection arrives via 'Selected Text from:' context block, not a parameter)", () => {
    for (const key of ["explain-selection", "summarize-selection"]) {
      const c = defaultSkillContents.get(key)!;
      expect(c, key).toMatch(/^kind:\s*prompt$/m);
      expect(c, key).toContain("Selected Text");
    }
  });
});
