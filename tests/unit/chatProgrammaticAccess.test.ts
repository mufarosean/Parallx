/**
 * Pin-the-invariant: built-in/chat/chatProgrammaticAccess.ts — wrapper safety.
 * All methods are no-ops when getter returns undefined; reveal executes "chat.show".
 */
import { describe, it, expect, vi } from "vitest";
import { ChatProgrammaticAccess } from "../../src/built-in/chat/chatProgrammaticAccess";

function makeWidget() {
  return {
    addSelectionAttachment: vi.fn(),
    setInputValue: vi.fn(),
    focus: vi.fn(),
    acceptInput: vi.fn(),
  };
}

describe("ChatProgrammaticAccess", () => {
  it("no-ops cleanly when no widget", async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const c = new ChatProgrammaticAccess(() => undefined, exec);
    expect(() => c.addSelectionAttachment({ text: "x" } as any)).not.toThrow();
    expect(() => c.setInputValue("hi")).not.toThrow();
    expect(() => c.focus()).not.toThrow();
    expect(() => c.submit()).not.toThrow();
  });

  it("delegates to the widget when present", () => {
    const w = makeWidget();
    const c = new ChatProgrammaticAccess(() => w as any, vi.fn());
    const attachment = { text: "selection" } as any;
    c.addSelectionAttachment(attachment);
    c.setInputValue("hello");
    c.focus();
    c.submit();
    expect(w.addSelectionAttachment).toHaveBeenCalledWith(attachment);
    expect(w.setInputValue).toHaveBeenCalledWith("hello");
    expect(w.focus).toHaveBeenCalledOnce();
    expect(w.acceptInput).toHaveBeenCalledOnce();
  });

  it('reveal executes the "chat.show" command', async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const c = new ChatProgrammaticAccess(() => undefined, exec);
    await c.reveal();
    expect(exec).toHaveBeenCalledWith("chat.show");
  });
});
