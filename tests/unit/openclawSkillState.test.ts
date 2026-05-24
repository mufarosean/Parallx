import { describe, it, expect } from "vitest";
import { buildOpenclawRuntimeSkillState } from "../../src/openclaw/openclawSkillState";
import type { ISkillCatalogEntry } from "../../src/openclaw/openclawTypes";

function mkSkill(over: Partial<ISkillCatalogEntry> = {}): ISkillCatalogEntry {
  return {
    name: over.name ?? "alpha",
    description: over.description ?? "Does alpha things.",
    kind: over.kind ?? "workflow",
    tags: over.tags ?? [],
    location: over.location ?? ".parallx/skills/alpha/SKILL.md",
    disableModelInvocation: over.disableModelInvocation,
  };
}

describe("buildOpenclawRuntimeSkillState — catalog visibility", () => {
  it("workflows with disableModelInvocation !== true are model-visible", () => {
    const out = buildOpenclawRuntimeSkillState([mkSkill()]);
    expect(out.catalog).toHaveLength(1);
    expect(out.catalog[0].modelVisible).toBe(true);
    expect(out.catalog[0].modelVisibilityReason).toBe("workflow-visible");
    expect(out.visibleCount).toBe(1);
    expect(out.hiddenCount).toBe(0);
  });

  it("non-workflow skills are hidden as 'non-workflow'", () => {
    const out = buildOpenclawRuntimeSkillState([
      mkSkill({ name: "tool-x", kind: "tool" }),
    ]);
    expect(out.catalog[0].modelVisible).toBe(false);
    expect(out.catalog[0].modelVisibilityReason).toBe("non-workflow");
    expect(out.visibleCount).toBe(0);
    expect(out.hiddenCount).toBe(1);
  });

  it("workflows with disableModelInvocation === true are hidden", () => {
    const out = buildOpenclawRuntimeSkillState([
      mkSkill({ name: "hidden", disableModelInvocation: true }),
    ]);
    expect(out.catalog[0].modelVisible).toBe(false);
    expect(out.catalog[0].modelVisibilityReason).toBe("model-invocation-disabled");
    expect(out.visibleCount).toBe(0);
  });

  it("totalCount/visibleCount/hiddenCount partition the input", () => {
    const out = buildOpenclawRuntimeSkillState([
      mkSkill({ name: "a" }),
      mkSkill({ name: "b", kind: "tool" }),
      mkSkill({ name: "c", disableModelInvocation: true }),
    ]);
    expect(out.totalCount).toBe(3);
    expect(out.visibleCount).toBe(1);
    expect(out.hiddenCount).toBe(2);
  });

  it("preserves catalog order and copies location/description into promptEntries", () => {
    const out = buildOpenclawRuntimeSkillState([
      mkSkill({ name: "a", description: "A desc", location: "loc/a" }),
      mkSkill({ name: "b", description: "B desc", location: "loc/b" }),
    ]);
    expect(out.promptEntries.map(e => e.name)).toEqual(["a", "b"]);
    expect(out.promptEntries[0].description).toBe("A desc");
    expect(out.promptEntries[1].location).toBe("loc/b");
  });

  it("missing location resolves to empty string in promptEntries", () => {
    const s: ISkillCatalogEntry = {
      name: "x",
      description: "d",
      kind: "workflow",
      tags: [],
    };
    const out = buildOpenclawRuntimeSkillState([s]);
    expect(out.promptEntries[0].location).toBe("");
  });
});

describe("buildOpenclawRuntimeSkillState — limits", () => {
  it("when below all limits: not truncated, not compact, empty note", () => {
    const out = buildOpenclawRuntimeSkillState([mkSkill()]);
    expect(out.truncated).toBe(false);
    expect(out.compact).toBe(false);
    expect(out.truncationNote).toBe("");
  });

  it("maxSkillsInPrompt count cap drops trailing entries and marks truncated", () => {
    const skills = Array.from({ length: 5 }, (_, i) =>
      mkSkill({ name: `s${i}`, location: `loc/${i}` }),
    );
    const out = buildOpenclawRuntimeSkillState(skills, { maxSkillsInPrompt: 2 });
    expect(out.promptEntries).toHaveLength(2);
    expect(out.promptEntries.map(e => e.name)).toEqual(["s0", "s1"]);
    expect(out.truncated).toBe(true);
    expect(out.compact).toBe(false);
    expect(out.truncationNote).toContain("included 2 of 5");
    expect(out.truncationNote).not.toContain("compact format");
  });

  it("maxSkillsInPrompt = 0 means no skills in prompt and truncated", () => {
    const out = buildOpenclawRuntimeSkillState([mkSkill()], { maxSkillsInPrompt: 0 });
    expect(out.promptEntries).toHaveLength(0);
    expect(out.truncated).toBe(true);
  });

  it("negative maxSkillsInPrompt is clamped to 0 (Math.max guard)", () => {
    const out = buildOpenclawRuntimeSkillState([mkSkill()], {
      maxSkillsInPrompt: -5,
    });
    expect(out.promptEntries).toHaveLength(0);
  });

  it("char overflow with long descriptions falls back to compact format", async () => {
    // First measure the header overhead so the budget is calibrated relative
    // to it: compact (no description) must fit; full (200-char desc) must not.
    const { buildSkillsSection } = await import("../../src/openclaw/openclawSystemPrompt");
    const longDesc = "x".repeat(200);
    const compactLen = buildSkillsSection(
      [{ name: "alpha", description: longDesc, location: ".parallx/skills/alpha/SKILL.md" }],
      { compact: true },
    ).length;
    const fullLen = buildSkillsSection(
      [{ name: "alpha", description: longDesc, location: ".parallx/skills/alpha/SKILL.md" }],
      { compact: false },
    ).length;
    const budget = Math.floor((compactLen + fullLen) / 2);
    expect(compactLen).toBeLessThanOrEqual(budget);
    expect(fullLen).toBeGreaterThan(budget);

    const out = buildOpenclawRuntimeSkillState(
      [mkSkill({ description: longDesc })],
      { maxSkillsPromptChars: budget },
    );
    expect(out.compact).toBe(true);
    expect(out.truncated).toBe(false);
    expect(out.promptEntries).toHaveLength(1);
    expect(out.truncationNote).toBe(
      "⚠️ Skills catalog using compact format (descriptions omitted).",
    );
  });

  it("if even compact exceeds the budget, binary-search keeps the largest prefix", () => {
    // 10 skills with reasonably long descriptions and a tiny char budget.
    const skills = Array.from({ length: 10 }, (_, i) =>
      mkSkill({ name: `skill${i}`, description: "x".repeat(200), location: `l/${i}` }),
    );
    // Budget large enough for the section header + maybe 2-3 compact entries.
    const out = buildOpenclawRuntimeSkillState(skills, { maxSkillsPromptChars: 500 });
    expect(out.compact).toBe(true);
    expect(out.truncated).toBe(true);
    expect(out.promptEntries.length).toBeGreaterThan(0);
    expect(out.promptEntries.length).toBeLessThan(10);
    expect(out.truncationNote).toContain("compact format, descriptions omitted");
    expect(out.truncationNote).toContain(`of ${out.visibleCount}`);
  });

  it("maxSkillsPromptChars = 0 disables the char-limit step entirely", () => {
    // With chars=0, the inner if(maxChars > 0) is skipped → never compact/truncate.
    const skills = Array.from({ length: 5 }, (_, i) =>
      mkSkill({ name: `s${i}`, description: "x".repeat(1000) }),
    );
    const out = buildOpenclawRuntimeSkillState(skills, { maxSkillsPromptChars: 0 });
    expect(out.compact).toBe(false);
    expect(out.truncated).toBe(false);
    expect(out.promptEntries).toHaveLength(5);
  });

  it("promptReportEntries reflect compact-vs-full block length", async () => {
    const out = buildOpenclawRuntimeSkillState([mkSkill({ name: "a", description: "d", location: "L" })]);
    const full = out.promptReportEntries[0].blockChars;
    // Pick a budget that admits the compact form for one 200-char-desc skill
    // but rejects the full form.
    const { buildSkillsSection } = await import("../../src/openclaw/openclawSystemPrompt");
    const longDesc = "x".repeat(200);
    const compactLen = buildSkillsSection(
      [{ name: "a", description: longDesc, location: "L" }],
      { compact: true },
    ).length;
    const fullLen = buildSkillsSection(
      [{ name: "a", description: longDesc, location: "L" }],
      { compact: false },
    ).length;
    const budget = Math.floor((compactLen + fullLen) / 2);
    const outC = buildOpenclawRuntimeSkillState(
      [mkSkill({ name: "a", description: longDesc, location: "L" })],
      { maxSkillsPromptChars: budget },
    );
    expect(outC.compact).toBe(true);
    const compact = outC.promptReportEntries[0].blockChars;
    expect(compact).toBeLessThan(full + 200); // compact omits the description payload
  });
});
