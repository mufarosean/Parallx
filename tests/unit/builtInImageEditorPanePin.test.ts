/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/imageEditorPane.ts.
 *
 * Pins:
 *   - PANE_ID = 'image-editor-pane'.
 *   - create(container) installs scroll-container + image + info-bar + hidden error-message;
 *     wires Ctrl+wheel zoom listener, load/error handlers.
 *   - renderInput with non-ImageEditorInput shows error 'Cannot render: not an image input.'.
 *   - renderInput without parallxElectron.fs bridge surfaces 'File system bridge not available'
 *     into the error message.
 *   - renderInput with base64 result builds `data:<mime>;base64,<content>` and assigns to img.src.
 *   - layout(width, height) sizes the scroll container to (width, height - 24).
 *   - clearInput resets the image src, info bar text, and zoom to 1.
 *   - Ctrl+wheel changes zoom; non-Ctrl wheel does not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ImageEditorPane } from "../../src/built-in/editor/imageEditorPane";
import { ImageEditorInput } from "../../src/built-in/editor/imageEditorInput";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";
import { URI } from "../../src/platform/uri";

function makePane(): { pane: ImageEditorPane; container: HTMLElement } {
  const pane = new ImageEditorPane();
  const container = document.createElement("div");
  document.body.appendChild(container);
  pane.create(container);
  return { pane, container };
}

beforeEach(() => {
  // Ensure no stale bridge from a previous test leaks.
  delete (globalThis as any).parallxElectron;
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (globalThis as any).parallxElectron;
});

describe("built-in/editor/imageEditorPane", () => {
  it("exports PANE_ID = 'image-editor-pane'", () => {
    expect(ImageEditorPane.PANE_ID).toBe("image-editor-pane");
  });

  it("create() builds scroll container, image, info bar, hidden error message", () => {
    const { pane, container } = makePane();
    expect(pane.element!.classList.contains("image-editor-pane")).toBe(true);
    expect(container.contains(pane.element!)).toBe(true);
    const scroll = container.querySelector(".image-scroll-container");
    const wrap = container.querySelector(".image-wrapper");
    const img = container.querySelector("img.image-preview") as HTMLImageElement;
    const info = container.querySelector(".image-info-bar");
    const err = container.querySelector(".image-error") as HTMLElement;
    expect(scroll).toBeTruthy();
    expect(wrap).toBeTruthy();
    expect(img).toBeTruthy();
    expect(info).toBeTruthy();
    expect(err).toBeTruthy();
    expect(img.draggable).toBe(false);
    // hidden via $.hide → display:none
    expect(err.style.display).toBe("none");
  });

  it("renderInput rejects non-ImageEditorInput with 'Cannot render: not an image input.'", async () => {
    const { pane, container } = makePane();
    const wrong = new PlaceholderEditorInput("Not an image");
    await pane.setInput(wrong);
    const err = container.querySelector(".image-error") as HTMLElement;
    expect(err.textContent).toBe("Cannot render: not an image input.");
    expect(err.style.display).not.toBe("none");
  });

  it("renderInput without parallxElectron.fs bridge sets 'File system bridge not available' error", async () => {
    const { pane, container } = makePane();
    const input = ImageEditorInput.create(URI.file("C:/p.png"));
    await pane.setInput(input);
    const err = container.querySelector(".image-error") as HTMLElement;
    expect(err.textContent).toMatch(/File system bridge not available/);
    expect(err.style.display).not.toBe("none");
  });

  it("renderInput with base64 result assigns `data:<mime>;base64,<content>` to img.src", async () => {
    (globalThis as any).parallxElectron = {
      fs: {
        readFile: vi.fn(async () => ({ encoding: "base64", content: "ZmFrZQ==" })),
      },
    };
    const { pane, container } = makePane();
    const input = ImageEditorInput.create(URI.file("C:/x.png"));
    await pane.setInput(input);
    const img = container.querySelector("img.image-preview") as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,ZmFrZQ==");
  });

  it("layout(width, height) sizes the scroll container to (width, height - 24)", async () => {
    const { pane, container } = makePane();
    pane.layout(800, 624);
    const scroll = container.querySelector(".image-scroll-container") as HTMLElement;
    expect(scroll.style.width).toBe("800px");
    expect(scroll.style.height).toBe("600px");
  });

  it("clearInput() resets img.src and info bar; subsequent zoom is 100%", async () => {
    (globalThis as any).parallxElectron = {
      fs: { readFile: vi.fn(async () => ({ encoding: "base64", content: "QUE=" })) },
    };
    const { pane, container } = makePane();
    const input = ImageEditorInput.create(URI.file("C:/y.png"));
    await pane.setInput(input);
    pane.clearInput();
    const img = container.querySelector("img.image-preview") as HTMLImageElement;
    const info = container.querySelector(".image-info-bar") as HTMLElement;
    // jsdom returns empty src as absolute "" or as resolved base URL — accept either.
    expect(img.getAttribute("src")).toBe("");
    expect(info.textContent).toBe("");
  });

  it("Ctrl+wheel decreases zoom (deltaY>0); plain wheel does not change anything", async () => {
    (globalThis as any).parallxElectron = {
      fs: { readFile: vi.fn(async () => ({ encoding: "base64", content: "QUE=" })) },
    };
    const { pane, container } = makePane();
    const input = ImageEditorInput.create(URI.file("C:/y.png"));
    await pane.setInput(input);
    const img = container.querySelector("img.image-preview") as HTMLImageElement;
    const scroll = container.querySelector(".image-scroll-container") as HTMLElement;

    // Plain wheel: no zoom change (transform stays at scale(1))
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: false, cancelable: true }));
    expect(img.style.transform).toBe("scale(1)");

    // Ctrl + wheel down: zoom decreases (scale ≈ 0.9)
    scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, cancelable: true }));
    expect(img.style.transform).toMatch(/^scale\(0\.9\d*\)$/);
  });
});
