/** @vitest-environment jsdom */
/**
 * Pin tests for src/aiSettings/ui/sections/mcpSection.ts (display surface).
 *
 * Pins:
 *   - sectionId='mcp', title='MCP Servers'; constructor builds the base section.
 *   - build() appends a `.ai-settings-mcp-summary` to the section header,
 *     mounts an `.ai-settings-mcp-list` container, and an `+ Add Server` button.
 *   - Summary text: "" when no servers, otherwise "<connected>/<total> connected".
 *   - Empty list shows a single `.ai-settings-mcp-empty` element with guidance text.
 *   - Each server row has dataset.serverId, dataset.status, a status dot, a name,
 *     a transport·command detail line, a status badge, and a primary action button.
 *   - When status is 'connected' the primary action is "Disconnect"; when
 *     'disconnected' it is "Connect" (or "Authorize" if requiresOAuth=true);
 *     when 'connecting' or 'reconnecting' it is "Cancel".
 *   - Clicking "Connect" calls connectServer with the server config; clicking
 *     "Disconnect" calls disconnectServer with the id; clicking "Remove" is wired
 *     to a danger-styled button.
 *   - onDidChangeStatus subscription re-renders both list and summary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpSection } from "../../src/aiSettings/ui/sections/mcpSection";

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

function makeMcpClient(initialServers: any[] = [], statuses: Record<string, string> = {}) {
  const listeners: Array<() => void> = [];
  return {
    _servers: [...initialServers],
    _statuses: { ...statuses },
    getConfiguredServers() { return this._servers; },
    getServerStatus(id: string) { return this._statuses[id] ?? "disconnected"; },
    getHealthInfo(_id: string) { return undefined; },
    connectServer: vi.fn(async () => {}),
    disconnectServer: vi.fn(() => {}),
    removeServer: vi.fn(async () => {}),
    addServer: vi.fn(async () => {}),
    onDidChangeStatus: (cb: () => void) => {
      listeners.push(cb);
      return { dispose() {} };
    },
    _fire() { for (const l of listeners) l(); },
  } as any;
}

const makeService = () => ({ resetSection: vi.fn() }) as any;

describe("aiSettings/sections/mcpSection — construction", () => {
  it("uses sectionId='mcp' and title='MCP Servers'", () => {
    const s = new McpSection(makeService(), makeMcpClient());
    expect(s.sectionId).toBe("mcp");
    expect(s.title).toBe("MCP Servers");
  });
});

describe("aiSettings/sections/mcpSection — build()", () => {
  it("mounts a summary badge in the section header, an .ai-settings-mcp-list container, and a + Add Server button", () => {
    const s = new McpSection(makeService(), makeMcpClient());
    s.build();
    expect(s.headerElement.querySelector(".ai-settings-mcp-summary")).toBeTruthy();
    expect(s.element.querySelector(".ai-settings-mcp-list")).toBeTruthy();
    const addBtn = Array.from(
      s.element.querySelectorAll<HTMLButtonElement>(".ai-settings-mcp-add-btn"),
    ).find(b => b.textContent?.includes("Add Server"));
    expect(addBtn).toBeTruthy();
  });

  it("summary is empty string when no servers configured", () => {
    const s = new McpSection(makeService(), makeMcpClient([]));
    s.build();
    expect(s.headerElement.querySelector(".ai-settings-mcp-summary")!.textContent).toBe("");
  });

  it("summary reads '<connected>/<total> connected' when servers configured", () => {
    const cli = makeMcpClient(
      [
        { id: "a", name: "A", transport: "stdio", command: "x", enabled: true },
        { id: "b", name: "B", transport: "stdio", command: "y", enabled: true },
      ],
      { a: "connected", b: "disconnected" },
    );
    const s = new McpSection(makeService(), cli);
    s.build();
    expect(s.headerElement.querySelector(".ai-settings-mcp-summary")!.textContent).toBe("1/2 connected");
  });

  it("shows .ai-settings-mcp-empty placeholder when zero servers", () => {
    const s = new McpSection(makeService(), makeMcpClient());
    s.build();
    const empty = s.element.querySelector(".ai-settings-mcp-empty");
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain("No MCP servers configured");
  });
});

describe("aiSettings/sections/mcpSection — server rows", () => {
  it("renders one .ai-settings-mcp-row per server with dataset metadata and detail line", () => {
    const cli = makeMcpClient(
      [{ id: "srv1", name: "Srv One", transport: "stdio", command: "npx", args: ["foo"], enabled: true }],
      { srv1: "connected" },
    );
    const s = new McpSection(makeService(), cli);
    s.build();
    const row = s.element.querySelector<HTMLElement>(".ai-settings-mcp-row")!;
    expect(row.dataset.serverId).toBe("srv1");
    expect(row.dataset.status).toBe("connected");
    expect(row.querySelector(".ai-settings-mcp-name")!.textContent).toBe("Srv One");
    expect(row.querySelector(".ai-settings-mcp-detail")!.textContent).toBe("stdio · npx foo");
    expect(row.querySelector(".ai-settings-mcp-dot")).toBeTruthy();
    expect(row.querySelector(".ai-settings-mcp-badge")!.textContent).toBe("Connected");
  });

  it("primary action is 'Disconnect' when connected", () => {
    const cli = makeMcpClient([{ id: "x", name: "X", transport: "stdio", command: "c", enabled: true }], { x: "connected" });
    const s = new McpSection(makeService(), cli);
    s.build();
    const labels = Array.from(s.element.querySelectorAll(".ai-settings-mcp-btn")).map(b => b.textContent);
    expect(labels).toContain("Disconnect");
    const disconnect = Array.from(s.element.querySelectorAll<HTMLButtonElement>(".ai-settings-mcp-btn"))
      .find(b => b.textContent === "Disconnect")!;
    disconnect.click();
    expect(cli.disconnectServer).toHaveBeenCalledWith("x");
  });

  it("primary action is 'Connect' when disconnected; clicking invokes connectServer", () => {
    const cfg = { id: "x", name: "X", transport: "stdio", command: "c", enabled: true } as any;
    const cli = makeMcpClient([cfg], { x: "disconnected" });
    const s = new McpSection(makeService(), cli);
    s.build();
    const connect = Array.from(s.element.querySelectorAll<HTMLButtonElement>(".ai-settings-mcp-btn"))
      .find(b => b.textContent === "Connect")!;
    expect(connect).toBeTruthy();
    connect.click();
    expect(cli.connectServer).toHaveBeenCalledWith(cfg);
  });

  it("primary action is 'Authorize' when disconnected + requiresOAuth=true", () => {
    const cli = makeMcpClient(
      [{ id: "o", name: "O", transport: "stdio", command: "c", enabled: true, requiresOAuth: true }],
      { o: "disconnected" },
    );
    const s = new McpSection(makeService(), cli);
    s.build();
    const labels = Array.from(s.element.querySelectorAll(".ai-settings-mcp-btn")).map(b => b.textContent);
    expect(labels).toContain("Authorize");
  });

  it("primary action is 'Cancel' when reconnecting or connecting", () => {
    const cli = makeMcpClient(
      [{ id: "r", name: "R", transport: "stdio", command: "c", enabled: true }],
      { r: "reconnecting" },
    );
    const s = new McpSection(makeService(), cli);
    s.build();
    const labels = Array.from(s.element.querySelectorAll(".ai-settings-mcp-btn")).map(b => b.textContent);
    expect(labels).toContain("Cancel");
  });

  it("always renders a danger-styled Remove button", () => {
    const cli = makeMcpClient([{ id: "x", name: "X", transport: "stdio", command: "c", enabled: true }], { x: "disconnected" });
    const s = new McpSection(makeService(), cli);
    s.build();
    const remove = Array.from(s.element.querySelectorAll<HTMLButtonElement>(".ai-settings-mcp-btn"))
      .find(b => b.textContent === "Remove")!;
    expect(remove).toBeTruthy();
    expect(remove.classList.contains("ai-settings-mcp-btn--danger")).toBe(true);
  });
});

describe("aiSettings/sections/mcpSection — live updates", () => {
  it("onDidChangeStatus re-renders list and updates summary", () => {
    const cli = makeMcpClient(
      [{ id: "x", name: "X", transport: "stdio", command: "c", enabled: true }],
      { x: "disconnected" },
    );
    const s = new McpSection(makeService(), cli);
    s.build();
    expect(s.headerElement.querySelector(".ai-settings-mcp-summary")!.textContent).toBe("0/1 connected");
    cli._statuses.x = "connected";
    cli._fire();
    expect(s.headerElement.querySelector(".ai-settings-mcp-summary")!.textContent).toBe("1/1 connected");
    const row = s.element.querySelector<HTMLElement>(".ai-settings-mcp-row")!;
    expect(row.dataset.status).toBe("connected");
  });
});

describe("aiSettings/sections/mcpSection — no client service", () => {
  it("constructs and builds without throwing when mcp client is omitted", () => {
    const s = new McpSection(makeService());
    expect(() => s.build()).not.toThrow();
    expect(s.element.querySelector(".ai-settings-mcp-empty")).toBeTruthy();
  });
});
