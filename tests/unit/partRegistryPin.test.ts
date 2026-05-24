import { describe, it, expect } from "vitest";
import { PartRegistry, DuplicatePartError, PartNotFoundError } from "../../src/parts/partRegistry.js";
import { PartId, PartPosition, type PartDescriptor, type IPart } from "../../src/parts/partTypes.js";
import { Emitter } from "../../src/platform/events.js";

function makePartStub(id: string): IPart {
  const vis = new Emitter<boolean>();
  const size = new Emitter<{ width: number; height: number }>();
  const cons = new Emitter<void>();
  let disposed = false;
  return {
    id,
    name: id,
    position: PartPosition.Top,
    constraints: {
      minimumWidth: 0,
      maximumWidth: Number.POSITIVE_INFINITY,
      minimumHeight: 0,
      maximumHeight: Number.POSITIVE_INFINITY,
    },
    isVisible: true,
    setVisible: () => {},
    create: () => {},
    layout: () => {},
    get element() { return null as unknown as HTMLElement; },
    onDidChangeVisibility: vis.event,
    onDidChangeSize: size.event,
    onDidChangeConstraints: cons.event,
    saveState: () => ({ visible: true }),
    restoreState: () => {},
    toJSON: () => ({ id }),
    dispose: () => { disposed = true; vis.dispose(); size.dispose(); cons.dispose(); },
    get disposed() { return disposed; },
  } as unknown as IPart;
}

function makeDescriptor(id: string): PartDescriptor {
  return {
    id,
    name: id,
    position: PartPosition.Top,
    defaultVisible: true,
    constraints: {
      minimumWidth: 0,
      maximumWidth: Number.POSITIVE_INFINITY,
      minimumHeight: 0,
      maximumHeight: Number.POSITIVE_INFINITY,
    },
    factory: () => makePartStub(id),
  };
}

describe("PartRegistry pin", () => {
  it("register stores the descriptor and fires onDidRegister", () => {
    const r = new PartRegistry();
    const d = makeDescriptor(PartId.Titlebar);
    let fired: PartDescriptor | null = null;
    r.onDidRegister(desc => { fired = desc; });
    r.register(d);
    expect(r.has(PartId.Titlebar)).toBe(true);
    expect(fired).toBe(d);
    r.dispose();
  });

  it("duplicate register throws DuplicatePartError", () => {
    const r = new PartRegistry();
    r.register(makeDescriptor(PartId.Titlebar));
    expect(() => r.register(makeDescriptor(PartId.Titlebar))).toThrow(DuplicatePartError);
    r.dispose();
  });

  it("registerMany registers a batch in order", () => {
    const r = new PartRegistry();
    r.registerMany([
      makeDescriptor(PartId.Titlebar),
      makeDescriptor(PartId.Sidebar),
      makeDescriptor(PartId.Editor),
    ]);
    expect(r.getDescriptors().length).toBe(3);
    r.dispose();
  });

  it("getDescriptor throws PartNotFoundError when not registered", () => {
    const r = new PartRegistry();
    expect(() => r.getDescriptor("nope")).toThrow(PartNotFoundError);
    r.dispose();
  });

  it("createPart creates from factory once (singleton) and fires onDidCreate", () => {
    const r = new PartRegistry();
    r.register(makeDescriptor(PartId.Titlebar));
    let fired = 0;
    r.onDidCreate(() => fired++);
    const a = r.createPart(PartId.Titlebar);
    const b = r.createPart(PartId.Titlebar);
    expect(a).toBe(b);
    expect(fired).toBe(1);
    r.dispose();
  });

  it("createPart throws PartNotFoundError when descriptor missing", () => {
    const r = new PartRegistry();
    expect(() => r.createPart("absent")).toThrow(PartNotFoundError);
    r.dispose();
  });

  it("getPart returns undefined before createPart, instance after", () => {
    const r = new PartRegistry();
    r.register(makeDescriptor(PartId.Titlebar));
    expect(r.getPart(PartId.Titlebar)).toBeUndefined();
    const p = r.createPart(PartId.Titlebar);
    expect(r.getPart(PartId.Titlebar)).toBe(p);
    r.dispose();
  });

  it("requirePart throws PartNotFoundError until createPart is called", () => {
    const r = new PartRegistry();
    r.register(makeDescriptor(PartId.Titlebar));
    expect(() => r.requirePart(PartId.Titlebar)).toThrow(PartNotFoundError);
    r.createPart(PartId.Titlebar);
    expect(r.requirePart(PartId.Titlebar)).toBeDefined();
    r.dispose();
  });

  it("createAll instantiates every registered descriptor", () => {
    const r = new PartRegistry();
    r.registerMany([
      makeDescriptor(PartId.Titlebar),
      makeDescriptor(PartId.Sidebar),
    ]);
    const created = r.createAll();
    expect(created.length).toBe(2);
    r.dispose();
  });

  it("dispose() disposes all instances and clears descriptors+instances", () => {
    const r = new PartRegistry();
    r.register(makeDescriptor(PartId.Titlebar));
    const p = r.createPart(PartId.Titlebar) as IPart & { disposed: boolean };
    r.dispose();
    expect(p.disposed).toBe(true);
    expect(r.has(PartId.Titlebar)).toBe(false);
    expect(r.getPart(PartId.Titlebar)).toBeUndefined();
  });
});
