/**
 * Pin tests for src/api/bridges/languageModelBridge.ts.
 *
 * Pins:
 *   - Delegates getModels / getActiveModel / sendChatRequest / registerProvider to the service.
 *   - sendChatRequest forwards modelId + messages + options to sendChatRequestForModel.
 *   - registerProvider records the disposable in BOTH the bridge's internal list
 *     AND the shared subscriptions array.
 *   - onDidChangeModels exposes the underlying service event.
 *   - dispose() disposes all registered providers and marks the bridge unusable;
 *     subsequent API calls throw with a message that includes the tool id.
 */
import { describe, it, expect, vi } from "vitest";
import { LanguageModelBridge } from "../../src/api/bridges/languageModelBridge";

function makeService() {
  const onDidChangeModels = vi.fn();
  return {
    getModels: vi.fn(async () => [{ id: "m1" }, { id: "m2" }]),
    getActiveModel: vi.fn(() => "m1"),
    sendChatRequestForModel: vi.fn((modelId: string, messages: any, options: any) => {
      async function* gen() { yield { modelId, messages, options }; }
      return gen();
    }),
    registerProvider: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModels,
  } as any;
}

describe("api/bridges/LanguageModelBridge", () => {
  it("delegates getModels and getActiveModel to the service", async () => {
    const svc = makeService();
    const subs: any[] = [];
    const b = new LanguageModelBridge("tool.a", svc, subs);
    expect(await b.getModels()).toEqual([{ id: "m1" }, { id: "m2" }]);
    expect(b.getActiveModel()).toBe("m1");
    expect(svc.getModels).toHaveBeenCalledTimes(1);
    expect(svc.getActiveModel).toHaveBeenCalledTimes(1);
  });

  it("sendChatRequest forwards (modelId, messages, options) to sendChatRequestForModel", async () => {
    const svc = makeService();
    const b = new LanguageModelBridge("tool.a", svc, []);
    const msgs = [{ role: "user", content: "hi" }] as any;
    const opts = { temperature: 0.4 } as any;
    const iter = b.sendChatRequest("m2", msgs, opts);
    const chunks: any[] = [];
    for await (const c of iter) chunks.push(c);
    expect(svc.sendChatRequestForModel).toHaveBeenCalledWith("m2", msgs, opts);
    expect(chunks).toEqual([{ modelId: "m2", messages: msgs, options: opts }]);
  });

  it("registerProvider records disposable in internal list AND subscriptions array", () => {
    const svc = makeService();
    const subs: any[] = [];
    const b = new LanguageModelBridge("tool.a", svc, subs);
    const d = b.registerProvider({} as any);
    expect(svc.registerProvider).toHaveBeenCalledTimes(1);
    expect(subs.length).toBe(1);
    expect(subs[0]).toBe(d);
  });

  it("onDidChangeModels exposes the underlying service event", () => {
    const svc = makeService();
    const b = new LanguageModelBridge("tool.a", svc, []);
    expect(b.onDidChangeModels).toBe(svc.onDidChangeModels);
  });

  it("dispose() disposes all registered providers and throws on subsequent use with tool id", async () => {
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    let i = 0;
    const svc = makeService();
    svc.registerProvider = vi.fn(() => ({ dispose: [dispose1, dispose2][i++] }));
    const b = new LanguageModelBridge("tool.X", svc, []);
    b.registerProvider({} as any);
    b.registerProvider({} as any);
    b.dispose();
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
    await expect(b.getModels()).rejects.toThrow(/tool "tool.X" is disposed/);
    expect(() => b.getActiveModel()).toThrow(/tool "tool.X" is disposed/);
    expect(() => b.registerProvider({} as any)).toThrow(/tool "tool.X" is disposed/);
  });
});
