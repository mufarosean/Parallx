/**
 * @vitest-environment jsdom
 *
 * Pin: built-in/chat/widgets/chatView (createChatView) — DOM scaffolding,
 * title-actions slot discovery (view-section preferred, auxiliary-bar
 * fallback, none → undefined), setActiveWidget set/clear, dispose teardown.
 *
 * ChatWidget is mocked: we pin the chatView contract, not the widget itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as any).ResizeObserver ??= class {
  observe() {} disconnect() {} unobserve() {}
};

vi.mock("../../src/built-in/chat/widgets/chatWidget.js", () => {
  const instances: any[] = [];
  class MockChatWidget {
    layout = vi.fn();
    dispose = vi.fn();
    constructor(public root: HTMLElement, public provider: any, public services: any, public titleSlot: HTMLElement | undefined) {
      instances.push(this);
    }
  }
  (MockChatWidget as any).__instances = instances;
  return { ChatWidget: MockChatWidget };
});

import { createChatView } from "../../src/built-in/chat/widgets/chatView";
import { ChatWidget as MockedWidget } from "../../src/built-in/chat/widgets/chatWidget.js";
const widgetInstances = (MockedWidget as any).__instances as any[];

describe("built-in/chat/widgets/chatView — createChatView", () => {
  let provider: any;
  let services: any;
  let setActive: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    widgetInstances.length = 0;
    provider = { __mock: "provider" };
    services = { __mock: "services" };
    setActive = vi.fn();
  });

  it("appends a `.parallx-chat-view` root into the container and constructs a ChatWidget", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    createChatView(container, provider, services, setActive);

    const root = container.querySelector(".parallx-chat-view") as HTMLElement;
    expect(root).toBeTruthy();
    expect(widgetInstances).toHaveLength(1);
    expect(widgetInstances[0].root).toBe(root);
    expect(widgetInstances[0].provider).toBe(provider);
    expect(widgetInstances[0].services).toBe(services);
  });

  it("setActiveWidget is called with the widget on create and undefined on dispose", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const d = createChatView(container, provider, services, setActive);
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive.mock.calls[0][0]).toBe(widgetInstances[0]);

    d.dispose();
    expect(setActive).toHaveBeenCalledTimes(2);
    expect(setActive.mock.calls[1][0]).toBeUndefined();
  });

  it("prefers the closest `.view-section` actions slot (stacked-mode containers)", () => {
    const section = document.createElement("div");
    section.className = "view-section";
    const actions = document.createElement("div");
    actions.className = "view-section-actions";
    actions.style.opacity = "0.5";
    const container = document.createElement("div");
    section.appendChild(actions);
    section.appendChild(container);
    document.body.appendChild(section);

    createChatView(container, provider, services, setActive);
    expect(widgetInstances[0].titleSlot).toBe(actions);
    expect(actions.style.opacity).toBe("1");
  });

  it("falls back to creating a `.parallx-chat-title-actions` inside `.auxiliary-bar-header`", () => {
    const part = document.createElement("div");
    part.className = "part";
    const header = document.createElement("div");
    header.className = "auxiliary-bar-header";
    const container = document.createElement("div");
    part.appendChild(header);
    part.appendChild(container);
    document.body.appendChild(part);

    createChatView(container, provider, services, setActive);
    const slot = header.querySelector(".parallx-chat-title-actions") as HTMLElement;
    expect(slot).toBeTruthy();
    expect(widgetInstances[0].titleSlot).toBe(slot);
  });

  it("reuses an existing `.parallx-chat-title-actions` slot rather than duplicating it", () => {
    const part = document.createElement("div");
    part.className = "part";
    const header = document.createElement("div");
    header.className = "auxiliary-bar-header";
    const existing = document.createElement("div");
    existing.className = "parallx-chat-title-actions";
    header.appendChild(existing);
    const container = document.createElement("div");
    part.appendChild(header);
    part.appendChild(container);
    document.body.appendChild(part);

    createChatView(container, provider, services, setActive);
    expect(header.querySelectorAll(".parallx-chat-title-actions")).toHaveLength(1);
    expect(widgetInstances[0].titleSlot).toBe(existing);
  });

  it("passes undefined titleSlot when neither view-section nor auxiliary-bar-header is present", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    createChatView(container, provider, services, setActive);
    expect(widgetInstances[0].titleSlot).toBeUndefined();
  });

  it("dispose removes the root from the container and disposes the widget", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const d = createChatView(container, provider, services, setActive);
    const root = container.querySelector(".parallx-chat-view");
    expect(root).toBeTruthy();

    d.dispose();
    expect(widgetInstances[0].dispose).toHaveBeenCalled();
    expect(container.querySelector(".parallx-chat-view")).toBeNull();
  });
});
