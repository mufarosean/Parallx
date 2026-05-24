import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatabaseService, type TransactionOp } from "../../src/services/databaseService.js";

type Call = { method: string; args: unknown[] };

function makeBridge(overrides: Record<string, any> = {}) {
  const calls: Call[] = [];
  const bridge = {
    open: vi.fn(async (workspacePath: string, migrationsDir?: string) => {
      calls.push({ method: "open", args: [workspacePath, migrationsDir] });
      return { error: null, dbPath: `${workspacePath}/.parallx/data.db` };
    }),
    migrate: vi.fn(async (dir: string) => {
      calls.push({ method: "migrate", args: [dir] });
      return { error: null };
    }),
    close: vi.fn(async () => {
      calls.push({ method: "close", args: [] });
      return { error: null };
    }),
    run: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ method: "run", args: [sql, params] });
      return { error: null, changes: 1, lastInsertRowid: 42 };
    }),
    get: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ method: "get", args: [sql, params] });
      return { error: null, row: { id: 1, sql } };
    }),
    all: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ method: "all", args: [sql, params] });
      return { error: null, rows: [{ a: 1 }, { a: 2 }] };
    }),
    isOpen: vi.fn(async () => ({ isOpen: true })),
    runTransaction: vi.fn(async (ops: TransactionOp[]) => {
      calls.push({ method: "runTransaction", args: [ops] });
      return { error: null, results: ops.map((_, i) => ({ idx: i })) };
    }),
    ...overrides,
  };
  return { bridge, calls };
}

function installBridge(bridge: any) {
  (globalThis as any).window = { parallxElectron: { database: bridge } };
}

function uninstallBridge() {
  delete (globalThis as any).window;
}

describe("DatabaseService", () => {
  let svc: DatabaseService;

  beforeEach(() => {
    svc = new DatabaseService();
  });

  afterEach(() => {
    svc.dispose();
    uninstallBridge();
  });

  it("throws when bridge missing", async () => {
    (globalThis as any).window = {};
    await expect(svc.openForWorkspace("/ws")).rejects.toThrow(/parallxElectron\.database not available/);
  });

  it("opens a workspace and fires onDidOpen with dbPath", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    const fired: string[] = [];
    svc.onDidOpen(p => fired.push(p));

    await svc.openForWorkspace("/ws", "/migrations");

    expect(svc.isOpen).toBe(true);
    expect(svc.currentPath).toBe("/ws/.parallx/data.db");
    expect(fired).toEqual(["/ws/.parallx/data.db"]);
    expect(bridge.open).toHaveBeenCalledWith("/ws", "/migrations");
  });

  it("throws when open returns an error", async () => {
    const { bridge } = makeBridge({
      open: vi.fn(async () => ({ error: { code: "EIO", message: "disk full" } })),
    });
    installBridge(bridge);
    await expect(svc.openForWorkspace("/ws")).rejects.toThrow(/Failed to open database: disk full/);
    expect(svc.isOpen).toBe(false);
  });

  it("reuses the in-flight open promise (mutex)", async () => {
    let resolveOpen: (v: any) => void = () => {};
    const openImpl = vi.fn(() => new Promise<any>(res => { resolveOpen = res; }));
    const { bridge } = makeBridge({ open: openImpl });
    installBridge(bridge);

    const p1 = svc.openForWorkspace("/ws");
    const p2 = svc.openForWorkspace("/ws");
    resolveOpen({ error: null, dbPath: "/ws/.parallx/data.db" });
    await Promise.all([p1, p2]);

    expect(openImpl).toHaveBeenCalledTimes(1);
  });

  it("closes the previous DB when opening another workspace", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/a");
    await svc.openForWorkspace("/b");
    expect(bridge.close).toHaveBeenCalledTimes(1);
    expect(bridge.open).toHaveBeenCalledTimes(2);
  });

  it("close fires onDidClose and resets state", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    let closeCount = 0;
    svc.onDidClose(() => closeCount++);

    await svc.close();
    expect(svc.isOpen).toBe(false);
    expect(svc.currentPath).toBeNull();
    expect(closeCount).toBe(1);
  });

  it("close is a no-op when not open", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.close();
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it("close logs but does not throw on bridge error", async () => {
    const { bridge } = makeBridge({
      close: vi.fn(async () => ({ error: { code: "X", message: "boom" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await svc.close();
    expect(errSpy).toHaveBeenCalled();
    expect(svc.isOpen).toBe(false);
    errSpy.mockRestore();
  });

  it("migrate throws when db not open", async () => {
    installBridge(makeBridge().bridge);
    await expect(svc.migrate("/m")).rejects.toThrow(/No database is open/);
  });

  it("migrate forwards to bridge and throws on error", async () => {
    const { bridge } = makeBridge({
      migrate: vi.fn(async () => ({ error: { code: "X", message: "bad sql" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await expect(svc.migrate("/m")).rejects.toThrow(/Migration failed: bad sql/);
  });

  it("migrate succeeds and calls bridge with dir", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await svc.migrate("/migrations");
    expect(bridge.migrate).toHaveBeenCalledWith("/migrations");
  });

  it("run throws when not open", async () => {
    installBridge(makeBridge().bridge);
    await expect(svc.run("INSERT ...")).rejects.toThrow(/No database is open/);
  });

  it("run returns changes + lastInsertRowid", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    const r = await svc.run("INSERT INTO t VALUES (?)", [1]);
    expect(r).toEqual({ changes: 1, lastInsertRowid: 42 });
    expect(bridge.run).toHaveBeenCalledWith("INSERT INTO t VALUES (?)", [1]);
  });

  it("run throws on bridge error", async () => {
    const { bridge } = makeBridge({
      run: vi.fn(async () => ({ error: { code: "SQL", message: "syntax" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await expect(svc.run("oops")).rejects.toThrow(/SQL error: syntax/);
  });

  it("get returns row or null", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    const row = await svc.get<{ id: number }>("SELECT * FROM t WHERE id = ?", [1]);
    expect(row).toEqual({ id: 1, sql: "SELECT * FROM t WHERE id = ?" });

    (bridge.get as any).mockResolvedValueOnce({ error: null, row: null });
    const row2 = await svc.get("SELECT * FROM t");
    expect(row2).toBeNull();
  });

  it("get throws on bridge error", async () => {
    const { bridge } = makeBridge({
      get: vi.fn(async () => ({ error: { code: "X", message: "fail" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await expect(svc.get("x")).rejects.toThrow(/SQL error: fail/);
  });

  it("all returns rows, defaults to empty array", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    const rows = await svc.all("SELECT * FROM t");
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);

    (bridge.all as any).mockResolvedValueOnce({ error: null });
    const rows2 = await svc.all("SELECT * FROM t");
    expect(rows2).toEqual([]);
  });

  it("all throws on bridge error", async () => {
    const { bridge } = makeBridge({
      all: vi.fn(async () => ({ error: { code: "X", message: "boom" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await expect(svc.all("x")).rejects.toThrow(/SQL error: boom/);
  });

  it("runTransaction forwards ops and returns results", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    const ops: TransactionOp[] = [
      { type: "run", sql: "INSERT INTO t VALUES (?)", params: [1] },
      { type: "all", sql: "SELECT * FROM t" },
    ];
    const results = await svc.runTransaction(ops);
    expect(results).toEqual([{ idx: 0 }, { idx: 1 }]);
    expect(bridge.runTransaction).toHaveBeenCalledWith(ops);
  });

  it("runTransaction throws on bridge error", async () => {
    const { bridge } = makeBridge({
      runTransaction: vi.fn(async () => ({ error: { code: "X", message: "rolled back" } })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    await expect(svc.runTransaction([])).rejects.toThrow(/Transaction error: rolled back/);
  });

  it("runTransaction returns [] when bridge omits results", async () => {
    const { bridge } = makeBridge({
      runTransaction: vi.fn(async () => ({ error: null })),
    });
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    expect(await svc.runTransaction([])).toEqual([]);
  });

  it("dispose closes the bridge and clears state", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    await svc.openForWorkspace("/ws");
    svc.dispose();
    expect(svc.isOpen).toBe(false);
    expect(svc.currentPath).toBeNull();
    // microtask: bridge.close fire-and-forget
    await Promise.resolve();
    expect(bridge.close).toHaveBeenCalled();
  });

  it("dispose does not call bridge.close if never opened", async () => {
    const { bridge } = makeBridge();
    installBridge(bridge);
    svc.dispose();
    expect(bridge.close).not.toHaveBeenCalled();
  });
});
