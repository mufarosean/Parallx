/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { IconPicker } from "../../src/ui/iconPicker.js";

const renderIcon = (id: string, size: number): string =>
  `<svg data-id="${id}" width="${size}" height="${size}"></svg>`;

function makeAnchor(): HTMLElement {
  const a = document.createElement("button");
  document.body.appendChild(a);
  return a;
}

describe("IconPicker pin", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts overlay at document.body with .ui-icon-picker", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
    });
    expect(p.element.parentNode).toBe(document.body);
    expect(p.element.classList.contains("ui-icon-picker")).toBe(true);
    p.dispose();
  });

  it("renders one button per icon with title and svg sized correctly", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["alpha", "beta"],
      renderIcon,
      iconSize: 30,
    });
    const btns = p.element.querySelectorAll(".ui-icon-picker-btn");
    expect(btns.length).toBe(2);
    expect((btns[0] as HTMLElement).title).toBe("alpha");
    const svg = btns[0].querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("30");
    expect(svg.getAttribute("height")).toBe("30");
    p.dispose();
  });

  it("shows search input by default; hides it when showSearch:false", () => {
    const p1 = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
    });
    expect(p1.element.querySelector(".ui-icon-picker-search")).not.toBeNull();
    p1.dispose();

    const p2 = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
      showSearch: false,
    });
    expect(p2.element.querySelector(".ui-icon-picker-search")).toBeNull();
    p2.dispose();
  });

  it("shows remove button only when showRemove:true; firing it emits onDidRemoveIcon then dismisses", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
      showRemove: true,
    });
    const btn = p.element.querySelector(".ui-icon-picker-remove") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    let removed = 0;
    let dismissed = 0;
    p.onDidRemoveIcon(() => { removed++; });
    p.onDidDismiss(() => { dismissed++; });
    btn.click();
    expect(removed).toBe(1);
    expect(dismissed).toBe(1);
    expect(p.element.parentNode).toBeNull();
  });

  it("clicking a grid button fires onDidSelectIcon with id then dismisses", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["alpha", "beta"],
      renderIcon,
    });
    let picked: string | undefined;
    let dismissed = 0;
    p.onDidSelectIcon((id) => { picked = id; });
    p.onDidDismiss(() => { dismissed++; });
    (p.element.querySelectorAll(".ui-icon-picker-btn")[1] as HTMLElement).click();
    expect(picked).toBe("beta");
    expect(dismissed).toBe(1);
  });

  it("typing in search filters from searchPool when provided", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["alpha"],
      searchPool: ["alpha", "beta", "betalain", "gamma"],
      renderIcon,
    });
    const input = p.element.querySelector(".ui-icon-picker-search") as HTMLInputElement;
    input.value = "bet";
    input.dispatchEvent(new Event("input"));
    const btns = p.element.querySelectorAll(".ui-icon-picker-btn");
    const ids = Array.from(btns).map((b) => (b as HTMLElement).title);
    expect(ids).toEqual(["beta", "betalain"]);
    p.dispose();
  });

  it("renders empty-state label when filter matches nothing", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["alpha"],
      renderIcon,
    });
    const input = p.element.querySelector(".ui-icon-picker-search") as HTMLInputElement;
    input.value = "zzzzz";
    input.dispatchEvent(new Event("input"));
    expect(p.element.querySelector(".ui-icon-picker-empty")?.textContent).toBe("No matching icons");
    p.dispose();
  });

  it("Escape key dismisses the picker", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
    });
    let dismissed = 0;
    p.onDidDismiss(() => { dismissed++; });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dismissed).toBe(1);
    expect(p.element.parentNode).toBeNull();
  });

  it("dismiss() is idempotent — second call does not re-fire onDidDismiss", () => {
    const p = new IconPicker(document.body, {
      anchor: makeAnchor(),
      icons: ["a"],
      renderIcon,
    });
    let count = 0;
    p.onDidDismiss(() => { count++; });
    p.dismiss();
    p.dismiss();
    expect(count).toBe(1);
  });
});
