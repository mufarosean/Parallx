/**
 * Pin: canvasStructuralInvariants — validateCanvasStructuralInvariants
 * walks the document and reports issues with documented codes for the
 * columnList/column, details (+ Summary/Content), toggleHeading, callout,
 * table, pageBlock invariants. Also pins issueFingerprint format.
 */
import { describe, it, expect } from "vitest";
import {
  validateCanvasStructuralInvariants,
  issueFingerprint,
} from "../../src/built-in/canvas/invariants/canvasStructuralInvariants";

/** Minimal ProseMirror Node duck — only the surface validators use. */
type N = {
  type: { name: string };
  attrs?: Record<string, any>;
  children?: N[];
  childCount: number;
  child: (i: number) => N;
  forEach: (cb: (child: N, offset: number, index: number) => void) => void;
};
function n(type: string, attrs: any = {}, children: N[] = []): N {
  return {
    type: { name: type },
    attrs,
    children,
    get childCount() { return children.length; },
    child(i: number) { return children[i]; },
    forEach(cb) { children.forEach((c, i) => cb(c, i, i)); },
  };
}

const para = () => n("paragraph", {}, []);

function codes(doc: any) { return validateCanvasStructuralInvariants(doc).map(i => i.code); }

describe("built-in/canvas/invariants/canvasStructuralInvariants", () => {
  it("valid root with no targeted nodes returns no issues", () => {
    expect(validateCanvasStructuralInvariants(n("doc", {}, [para(), para()]) as any)).toEqual([]);
  });

  it("PX-COL-001 fires when columnList has <2 children", () => {
    const doc = n("doc", {}, [n("columnList", {}, [n("column", {}, [para()])])]);
    expect(codes(doc)).toContain("PX-COL-001");
  });

  it("PX-COL-002 fires for non-column child of columnList", () => {
    const doc = n("doc", {}, [n("columnList", {}, [n("column", {}, [para()]), para()])]);
    expect(codes(doc)).toContain("PX-COL-002");
  });

  it("PX-COL-003 fires for orphan column (parent is not columnList)", () => {
    const doc = n("doc", {}, [n("column", {}, [para()])]);
    expect(codes(doc)).toContain("PX-COL-003");
  });

  it("PX-DET-001 fires when details has != 2 children", () => {
    const doc = n("doc", {}, [n("details", {}, [n("detailsSummary", {}, [para()])])]);
    expect(codes(doc)).toContain("PX-DET-001");
  });

  it("PX-DET-002 + PX-DET-003 fire when details children are wrong types (in order)", () => {
    const doc = n("doc", {}, [n("details", {}, [para(), para()])]);
    const c = codes(doc);
    expect(c).toContain("PX-DET-002");
    expect(c).toContain("PX-DET-003");
  });

  it("PX-DET-004 fires when detailsSummary parent is not details", () => {
    const doc = n("doc", {}, [n("detailsSummary", {}, [para()])]);
    expect(codes(doc)).toContain("PX-DET-004");
  });

  it("PX-DET-005 fires when detailsContent parent is not details/toggleHeading", () => {
    const doc = n("doc", {}, [n("detailsContent", {}, [para()])]);
    expect(codes(doc)).toContain("PX-DET-005");
  });

  it("PX-TGL-001 fires for invalid toggleHeading level (0/4/'h')", () => {
    const docs = [0, 4, "x"].map(l => n("doc", {}, [
      n("toggleHeading", { level: l }, [n("toggleHeadingText", {}, [para()]), n("detailsContent", {}, [para()])]),
    ]));
    for (const d of docs) expect(codes(d)).toContain("PX-TGL-001");
  });

  it("PX-TGL-002 fires when toggleHeading childCount != 2; PX-TGL-003/004 fire when child types are wrong", () => {
    const wrongCount = n("doc", {}, [n("toggleHeading", { level: 1 }, [n("toggleHeadingText", {}, [para()])])]);
    expect(codes(wrongCount)).toContain("PX-TGL-002");
    const wrongTypes = n("doc", {}, [n("toggleHeading", { level: 1 }, [para(), para()])]);
    const c2 = codes(wrongTypes);
    expect(c2).toContain("PX-TGL-003");
    expect(c2).toContain("PX-TGL-004");
  });

  it("PX-CAL-001 fires for empty callout", () => {
    const doc = n("doc", {}, [n("callout", {}, [])]);
    expect(codes(doc)).toContain("PX-CAL-001");
  });

  it("PX-TBL-001 fires for empty table; PX-TBL-002 fires when first cell is tableCell not tableHeader; PX-TBL-003 fires for non-tableRow children", () => {
    expect(codes(n("doc", {}, [n("table", {}, [])]))).toContain("PX-TBL-001");
    const t2 = n("doc", {}, [
      n("table", {}, [n("tableRow", {}, [n("tableCell", {}, [para()])])]),
    ]);
    expect(codes(t2)).toContain("PX-TBL-002");
    const t3 = n("doc", {}, [
      n("table", {}, [n("tableRow", {}, [n("tableHeader", {}, [para()])]), para()]),
    ]);
    expect(codes(t3)).toContain("PX-TBL-003");
  });

  it("PX-PGB-001 fires when pageBlock has no pageId or empty pageId", () => {
    expect(codes(n("doc", {}, [n("pageBlock", {})]))).toContain("PX-PGB-001");
    expect(codes(n("doc", {}, [n("pageBlock", { pageId: "   " })]))).toContain("PX-PGB-001");
  });

  it("PX-PGB-001 does NOT fire when pageBlock has a valid pageId", () => {
    expect(codes(n("doc", {}, [n("pageBlock", { pageId: "page-1" })]))).not.toContain("PX-PGB-001");
  });

  it("issueFingerprint joins '<code>@<path>' sorted by alpha, '|' separator; path 'root' for top-level", () => {
    const issues = [
      { code: "PX-CAL-001", message: "", path: "0", nodeType: "callout", suggestion: "" },
      { code: "PX-COL-001", message: "", path: "1", nodeType: "columnList", suggestion: "" },
    ];
    expect(issueFingerprint(issues)).toBe("PX-CAL-001@0|PX-COL-001@1");
  });
});
