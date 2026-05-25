/**
 * Pin: slashMenuItems.buildSlashMenuItems — pure data mapping from canvas
 * block definitions to slash-menu items.  Locks the field projection,
 * label override priority, and that the function has no orchestration
 * side effects.
 */
import { describe, it, expect } from "vitest";
import {
  buildSlashMenuItems,
  type SlashBlockDef,
} from "../../src/built-in/canvas/menus/slashMenuItems";

const headingDef: SlashBlockDef = {
  id: "heading",
  label: "Heading",
  icon: "type-heading",
  slashMenu: { description: "Section heading" },
};

const calloutDef: SlashBlockDef = {
  id: "callout",
  label: "Callout",
  icon: "info",
  slashMenu: { label: "Callout block", description: "Highlighted note" },
};

describe("buildSlashMenuItems", () => {
  it("returns an empty array for empty defs", () => {
    expect(buildSlashMenuItems([])).toEqual([]);
  });

  it("maps a single def to {blockId, label, icon, description}", () => {
    expect(buildSlashMenuItems([headingDef])).toEqual([
      {
        blockId: "heading",
        label: "Heading",
        icon: "type-heading",
        description: "Section heading",
      },
    ]);
  });

  it("uses slashMenu.label when provided (overrides def.label)", () => {
    const items = buildSlashMenuItems([calloutDef]);
    expect(items[0]!.label).toBe("Callout block");
  });

  it("falls back to def.label when slashMenu.label is undefined", () => {
    const items = buildSlashMenuItems([headingDef]);
    expect(items[0]!.label).toBe("Heading");
  });

  it("preserves input order across multiple defs", () => {
    const items = buildSlashMenuItems([headingDef, calloutDef]);
    expect(items.map((i) => i.blockId)).toEqual(["heading", "callout"]);
  });

  it("does not mutate the input defs", () => {
    const def: SlashBlockDef = {
      id: "list",
      label: "List",
      icon: "bullet",
      slashMenu: { description: "A list" },
    };
    const frozen = Object.freeze({ ...def });
    expect(() => buildSlashMenuItems([frozen as SlashBlockDef])).not.toThrow();
  });

  it("returns a new array (not the input)", () => {
    const defs: SlashBlockDef[] = [headingDef];
    expect(buildSlashMenuItems(defs)).not.toBe(defs as any);
  });
});
