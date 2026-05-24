/**
 * @vitest-environment jsdom
 */
// countBadgePin.test.ts — pin CountBadge DOM render contract.

import { describe, it, expect } from "vitest";
import { CountBadge } from "../../src/ui/countBadge";

describe("CountBadge", () => {
  it("constructor with no options creates a hidden zero badge appended to container", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root);
    expect(root.children.length).toBe(1);
    expect(b.element.classList.contains("ui-count-badge")).toBe(true);
    expect(b.element.classList.contains("ui-count-badge--hidden")).toBe(true);
    expect(b.element.textContent).toBe("");
    expect(b.element.title).toBe("0");
    expect(b.count).toBe(0);
  });

  it("non-zero count renders the number and removes the hidden class", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root, { count: 5 });
    expect(b.element.textContent).toBe("5");
    expect(b.element.classList.contains("ui-count-badge--hidden")).toBe(false);
    expect(b.count).toBe(5);
  });

  it("titleFormat substitutes {0} with the current count", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root, { count: 3, titleFormat: "{0} unread" });
    expect(b.element.title).toBe("3 unread");
    b.setCount(7);
    expect(b.element.title).toBe("7 unread");
  });

  it("setCount: changing from 0 → N removes hidden + renders text", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root);
    b.setCount(2);
    expect(b.element.textContent).toBe("2");
    expect(b.element.classList.contains("ui-count-badge--hidden")).toBe(false);
  });

  it("setCount: changing from N → 0 hides + clears text", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root, { count: 2 });
    b.setCount(0);
    expect(b.element.textContent).toBe("");
    expect(b.element.classList.contains("ui-count-badge--hidden")).toBe(true);
  });

  it("setCount is a no-op when value is unchanged", () => {
    const root = document.createElement("div");
    const b = new CountBadge(root, { count: 4 });
    const original = b.element.textContent;
    b.setCount(4);
    expect(b.element.textContent).toBe(original);
    expect(b.count).toBe(4);
  });
});
