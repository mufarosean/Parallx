/**
 * Pin: pageTools — names, summaries, and permission posture of all 8
 * built-in canvas page tools. These names are wire-protocol with the
 * model; permission posture is the user-trust contract (read tools
 * always-allowed / no confirmation, write tools requires-approval +
 * confirmation).
 */
import { describe, it, expect } from "vitest";
import {
  createFindPagesTool,
  createReadPageTool,
  createGetPageTool,
  createListPropertyDefinitionsTool,
  createSetPagePropertyTool,
  createCreatePageTool,
  createComposePageTool,
  createSetPageStyleTool,
} from "../../src/built-in/chat/tools/pageTools";

// Each factory takes a db arg (and a couple take extra deps). Pass undefined —
// the schemas are static so the factory builds the IChatTool successfully and
// only the handler() path uses the db (which we don't invoke in these pins).
const findPages = createFindPagesTool(undefined);
const readPage = createReadPageTool(undefined as any, undefined as any);
const getPage = createGetPageTool(undefined);
const listPropertyDefs = createListPropertyDefinitionsTool(undefined);
const setPageProperty = createSetPagePropertyTool(undefined);
const createPage = createCreatePageTool(undefined as any, undefined as any);
const composePage = createComposePageTool(undefined as any, undefined as any);
const setPageStyle = createSetPageStyleTool(undefined as any, undefined as any);

const ALL = [findPages, readPage, getPage, listPropertyDefs, setPageProperty, createPage, composePage, setPageStyle];

describe("pageTools — wire-protocol tool names", () => {
  it("pins all 8 tool names in canvas_* namespace", () => {
    expect(ALL.map((t) => t.name)).toEqual([
      "canvas_find_pages",
      "canvas_read_page",
      "canvas_get_page",
      "canvas_list_property_definitions",
      "canvas_set_page_property",
      "canvas_create_page",
      "canvas_compose_page",
      "canvas_set_page_style",
    ]);
  });

  it("every tool name is prefixed canvas_ and is unique", () => {
    const names = ALL.map((t) => t.name);
    for (const n of names) expect(n.startsWith("canvas_")).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("pageTools — display summaries", () => {
  it("pins exact display summaries", () => {
    expect(findPages.displaySummary).toBe("Find or list canvas pages.");
    expect(readPage.displaySummary).toBe('Read a canvas page by id, title, or "current".');
    expect(getPage.displaySummary).toBe("Get canvas page metadata, properties, and definitions.");
    expect(listPropertyDefs.displaySummary).toBe("List canvas property definitions.");
    expect(setPageProperty.displaySummary).toBe("Set a property on a canvas page.");
    expect(createPage.displaySummary).toBe("Create a new canvas page.");
    expect(composePage.displaySummary).toBe("Write or update a canvas page from markdown.");
    expect(setPageStyle.displaySummary).toBe("Update a canvas page's style (icon, cover, font, width).");
  });
});

describe("pageTools — permission posture (user-trust contract)", () => {
  it("READ tools are always-allowed with no confirmation: find/read/get/list-property-definitions", () => {
    for (const t of [findPages, readPage, getPage, listPropertyDefs]) {
      expect(t.requiresConfirmation, t.name).toBe(false);
      expect(t.permissionLevel, t.name).toBe("always-allowed");
    }
  });

  it("WRITE tools require approval AND confirmation: set-property/create/compose/set-style", () => {
    for (const t of [setPageProperty, createPage, composePage, setPageStyle]) {
      expect(t.requiresConfirmation, t.name).toBe(true);
      expect(t.permissionLevel, t.name).toBe("requires-approval");
    }
  });
});

describe("pageTools — JSON-schema parameters surface", () => {
  it("every tool exposes a JSON-schema-shaped parameters object", () => {
    for (const t of ALL) {
      expect(t.parameters, t.name).toBeDefined();
      expect((t.parameters as { type: string }).type, t.name).toBe("object");
      expect(typeof (t.parameters as { properties: unknown }).properties, t.name).toBe("object");
    }
  });

  it("every tool has a non-empty description string", () => {
    for (const t of ALL) {
      expect(typeof t.description, t.name).toBe("string");
      expect((t.description as string).length, t.name).toBeGreaterThan(20);
    }
  });

  it("every tool exposes an async handler function", () => {
    for (const t of ALL) {
      expect(typeof t.handler, t.name).toBe("function");
    }
  });
});

describe("pageTools — canvas_find_pages parameter contract", () => {
  it("pins filter ops enum: equals/not_equals/contains/is_empty/is_not_empty/greater_than/less_than", () => {
    const params = findPages.parameters as any;
    const opEnum = params.properties.filter.items.properties.op.enum as string[];
    expect(opEnum).toEqual([
      "equals", "not_equals", "contains", "is_empty", "is_not_empty", "greater_than", "less_than",
    ]);
  });

  it("pins sort direction enum: asc/desc", () => {
    const params = findPages.parameters as any;
    expect(params.properties.sort.properties.dir.enum).toEqual(["asc", "desc"]);
  });

  it("exposes optional query/filter/sort/group/limit (no required fields)", () => {
    const params = findPages.parameters as any;
    expect(params.required).toBeUndefined();
    expect(Object.keys(params.properties).sort()).toEqual(
      ["filter", "group", "limit", "query", "sort"],
    );
  });
});
