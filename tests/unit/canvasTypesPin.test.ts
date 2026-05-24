/**
 * Pin: canvasTypes — PageChangeKind enum values, SaveStateKind enum
 * values, and the `doesPageChangeAffectSidebar` filter that the sidebar
 * uses to decide whether a Page Updated event matters to it.
 */
import { describe, it, expect } from "vitest";
import {
  PageChangeKind,
  SaveStateKind,
  doesPageChangeAffectSidebar,
  type PageChangeEvent,
} from "../../src/built-in/canvas/canvasTypes";

describe("canvasTypes — PageChangeKind", () => {
  it("has 5 stable string values: Created, Updated, Deleted, Moved, Reordered", () => {
    expect(PageChangeKind.Created).toBe("Created");
    expect(PageChangeKind.Updated).toBe("Updated");
    expect(PageChangeKind.Deleted).toBe("Deleted");
    expect(PageChangeKind.Moved).toBe("Moved");
    expect(PageChangeKind.Reordered).toBe("Reordered");
  });
});

describe("canvasTypes — SaveStateKind", () => {
  it("has 5 stable string values: Pending, Flushing, Saved, Failed, Retrying", () => {
    expect(SaveStateKind.Pending).toBe("Pending");
    expect(SaveStateKind.Flushing).toBe("Flushing");
    expect(SaveStateKind.Saved).toBe("Saved");
    expect(SaveStateKind.Failed).toBe("Failed");
    expect(SaveStateKind.Retrying).toBe("Retrying");
  });
});

describe("canvasTypes — doesPageChangeAffectSidebar", () => {
  const baseId = "page-1";

  it("non-Updated events always affect the sidebar (Created/Deleted/Moved/Reordered)", () => {
    for (const kind of [
      PageChangeKind.Created,
      PageChangeKind.Deleted,
      PageChangeKind.Moved,
      PageChangeKind.Reordered,
    ]) {
      const ev: PageChangeEvent = { kind, pageId: baseId };
      expect(doesPageChangeAffectSidebar(ev), kind).toBe(true);
    }
  });

  it("Updated with no changedFields conservatively affects sidebar", () => {
    expect(doesPageChangeAffectSidebar({ kind: PageChangeKind.Updated, pageId: baseId })).toBe(true);
  });

  it("Updated with empty changedFields conservatively affects sidebar", () => {
    expect(
      doesPageChangeAffectSidebar({
        kind: PageChangeKind.Updated,
        pageId: baseId,
        changedFields: [],
      }),
    ).toBe(true);
  });

  it("Updated affects sidebar when changedFields includes title/icon/isFavorited/isArchived", () => {
    for (const field of ["title", "icon", "isFavorited", "isArchived"] as const) {
      expect(
        doesPageChangeAffectSidebar({
          kind: PageChangeKind.Updated,
          pageId: baseId,
          changedFields: [field],
        }),
        field,
      ).toBe(true);
    }
  });

  it("Updated does NOT affect sidebar when only non-sidebar fields changed (content/coverUrl/fontFamily/etc.)", () => {
    for (const field of [
      "content",
      "coverUrl",
      "coverYOffset",
      "fontFamily",
      "fullWidth",
      "smallText",
      "isLocked",
      "contentSchemaVersion",
    ] as const) {
      expect(
        doesPageChangeAffectSidebar({
          kind: PageChangeKind.Updated,
          pageId: baseId,
          changedFields: [field],
        }),
        field,
      ).toBe(false);
    }
  });

  it("Updated affects sidebar if any one sidebar-relevant field is included alongside others", () => {
    expect(
      doesPageChangeAffectSidebar({
        kind: PageChangeKind.Updated,
        pageId: baseId,
        changedFields: ["content", "title"],
      }),
    ).toBe(true);
  });
});
