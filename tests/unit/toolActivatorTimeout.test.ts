/** @vitest-environment jsdom */
/**
 * M83-W4 — Tool activation timeout.
 *
 * Pins:
 *   - When activate() returns a never-resolving promise, the activator
 *     gives up after _activationTimeoutMs, marks the tool Deactivated,
 *     disposes the API, and records an 'activation' error.
 *   - When activate() resolves before the timeout, success path runs
 *     normally and no timeout error fires.
 *   - timeoutMs <= 0 disables the gate (test escape hatch).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const disposeApiSpy = vi.fn();
vi.mock("../../src/api/apiFactory", () => ({
  createToolApi: vi.fn(() => ({ api: { __fake: true }, dispose: disposeApiSpy })),
}));

import { ToolActivator, ToolActivationTimeoutError, DEFAULT_ACTIVATION_TIMEOUT_MS } from "../../src/tools/toolActivator";
import { ToolRegistry, ToolState } from "../../src/tools/toolRegistry";
import { ToolErrorService } from "../../src/tools/toolErrorIsolation";
import { ActivationEventService } from "../../src/tools/activationEventService";
import type { IToolDescription } from "../../src/tools/toolManifest";

function makeDescription(id: string): IToolDescription {
  return {
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: "0.0.1",
      publisher: "test",
      main: "./main.js",
      activationEvents: ["*"],
      engines: { parallx: "*" } as any,
    } as any,
    toolPath: `C:/fake/${id}`,
    isBuiltin: true,
  };
}

function makeActivator(timeoutMs: number) {
  const registry = new ToolRegistry();
  const errorService = new ToolErrorService();
  const events = new ActivationEventService();
  const apiDeps: any = {
    services: {} as any,
    viewManager: {} as any,
    toolRegistry: registry,
    notificationService: {} as any,
    workbenchContainer: undefined,
  };
  const activator = new ToolActivator(registry, errorService, events, apiDeps, undefined, timeoutMs);
  return { activator, registry, errorService, events };
}

beforeEach(() => {
  disposeApiSpy.mockClear();
});

describe("ToolActivator — activation timeout (M83-W4)", () => {
  it("exports a sane default timeout constant", () => {
    expect(DEFAULT_ACTIVATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("aborts activation when activate() never resolves", async () => {
    const { activator, registry, errorService } = makeActivator(30);
    registry.register(makeDescription("hung"));

    const recordSpy = vi.spyOn(errorService, "recordError");
    const evt = vi.fn();
    activator.onDidActivate(evt);

    // activate returns a promise that never resolves
    const res = await activator.activateBuiltin("hung", {
      activate: () => new Promise(() => { /* hang */ }),
    });

    expect(res).toBe(false);
    expect(activator.isActivated("hung")).toBe(false);
    expect(registry.getById("hung")?.state).toBe(ToolState.Deactivated);
    // API must have been disposed so any late register* calls fail closed
    expect(disposeApiSpy).toHaveBeenCalled();
    // Error service recorded the timeout as an activation-phase failure
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const [, err, phase] = recordSpy.mock.calls[0];
    expect(phase).toBe("activation");
    expect(err).toBeInstanceOf(ToolActivationTimeoutError);
    // onDidActivate fired with success=false and the timeout error message
    expect(evt).toHaveBeenCalled();
    const lastCall = evt.mock.calls[evt.mock.calls.length - 1][0];
    expect(lastCall.success).toBe(false);
    expect(lastCall.error).toContain("did not resolve");
  });

  it("does not trip the timeout when activate() resolves quickly", async () => {
    const { activator, registry, errorService } = makeActivator(1000);
    registry.register(makeDescription("fast"));
    const recordSpy = vi.spyOn(errorService, "recordError");
    const activate = vi.fn(() => Promise.resolve());

    const res = await activator.activateBuiltin("fast", { activate });

    expect(res).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activator.isActivated("fast")).toBe(true);
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("respects timeoutMs <= 0 as a disable flag", async () => {
    // The test escape hatch — useful for harness code that does not want
    // a wall-clock dependency in unrelated activator tests.
    const { activator, registry } = makeActivator(0);
    registry.register(makeDescription("nogate"));
    let resolveActivate: (() => void) | undefined;
    const activate = vi.fn(() => new Promise<void>((r) => { resolveActivate = r; }));

    const resPromise = activator.activateBuiltin("nogate", { activate });
    // Without a gate, activation hangs until we resolve.
    await new Promise((r) => setTimeout(r, 40));
    expect(activator.isActivated("nogate")).toBe(false);
    resolveActivate!();
    const res = await resPromise;
    expect(res).toBe(true);
    expect(activator.isActivated("nogate")).toBe(true);
  });
});
