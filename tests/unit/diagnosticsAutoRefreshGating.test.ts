// M83-W5: The diagnostics auto-refresh timer used to run for the entire
// workbench session, firing an Ollama HTTP probe and a getFileCount DB
// query every 30s even when the panel was hidden. The timer now lives
// inside the view's lifetime — these tests pin that contract.

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate, deactivate } from "../../src/built-in/diagnostics/main.js";
import { IDiagnosticsService } from "../../src/services/serviceTypes.js";
import type { IDisposable } from "../../src/platform/lifecycle.js";

interface RegisteredProvider {
  viewId: string;
  provider: { createView(container: HTMLElement): IDisposable };
}

function buildHarness() {
  const runChecks = vi.fn().mockResolvedValue([]);
  const onDidChange = vi.fn().mockReturnValue({ dispose: () => {} });
  const diagSvc = { runChecks, onDidChange };

  const services = new Map<unknown, unknown>([[IDiagnosticsService, diagSvc]]);
  const registered: RegisteredProvider[] = [];
  const commands: string[] = [];

  const api = {
    views: {
      registerViewProvider(
        viewId: string,
        provider: { createView(container: HTMLElement): IDisposable },
      ): IDisposable {
        registered.push({ viewId, provider });
        return { dispose: () => {} };
      },
    },
    commands: {
      registerCommand(commandId: string): IDisposable {
        commands.push(commandId);
        return { dispose: () => {} };
      },
    },
    services: {
      has: (id: unknown) => services.has(id),
      get: <T>(id: unknown) => services.get(id) as T,
    },
  };

  const subscriptions: IDisposable[] = [];
  const context = { subscriptions } as any;

  return { api, context, diagSvc, runChecks, registered };
}

describe("Diagnostics — auto-refresh gating (M83-W5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    deactivate();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("does not poll while no view is mounted", async () => {
    const { api, context, runChecks, registered } = buildHarness();
    activate(api as any, context);

    // Drain the startup runChecks().then(...) microtask without advancing time
    await Promise.resolve();
    await Promise.resolve();
    const baseline = runChecks.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1); // startup invocation
    expect(registered.length).toBe(1);

    // Advance well past the 30s mark without mounting a view
    await vi.advanceTimersByTimeAsync(120_000);

    expect(runChecks.mock.calls.length).toBe(baseline);
  });

  it("starts polling when the view is mounted and stops on dispose", async () => {
    const { api, context, runChecks, registered } = buildHarness();
    activate(api as any, context);
    await Promise.resolve();
    await Promise.resolve();
    const baseline = runChecks.mock.calls.length;

    const container = document.createElement("div");
    const viewDisposable = registered[0]!.provider.createView(container);

    // First 30s tick fires the refresh
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runChecks.mock.calls.length).toBe(baseline + 1);

    // Second 30s tick fires again
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runChecks.mock.calls.length).toBe(baseline + 2);

    // Dispose the view — interval must stop
    viewDisposable.dispose();
    const afterDispose = runChecks.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runChecks.mock.calls.length).toBe(afterDispose);
  });
});
