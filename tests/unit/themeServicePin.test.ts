/** @vitest-environment jsdom */
/**
 * Pin tests for src/services/themeService.ts.
 *
 * Pins:
 *   - activeTheme returns the initial theme; applyTheme replaces it + fires onDidChangeTheme.
 *   - getColor: theme value wins over registry default; registry default wins over "inherit".
 *   - applyTheme injects a <style id="parallx-theme-colors"> with CSS custom properties
 *     for every registered color, formatted as `--vscode-<id>: <value>;` inside `body { ... }`.
 *   - applyTheme sets `data-vscode-theme-type` on <body>.
 *   - dispose() removes the injected <style> element.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ColorRegistry } from "../../src/theme/colorRegistry";
import { ColorThemeData } from "../../src/theme/themeData";
import { ThemeType } from "../../src/theme/themeTypes";
import { ThemeService } from "../../src/services/themeService";

function makeRegistry(): ColorRegistry {
  const r = new ColorRegistry();
  r.registerColor("test.background", "Test bg", { dark: "#000000", light: "#ffffff" });
  r.registerColor("test.foreground", "Test fg", { dark: "#ffffff", light: "#000000" });
  return r;
}

function makeTheme(reg: ColorRegistry, overrides: Record<string, string> = {}): ColorThemeData {
  return ColorThemeData.fromSource(
    {
      id: "test.theme",
      label: "Test",
      uiTheme: "vs-dark",
      colors: overrides,
    } as any,
    reg,
  );
}

describe("services/ThemeService", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.body.removeAttribute("data-vscode-theme-type");
  });

  it("activeTheme returns the initial theme and fires onDidChangeTheme on applyTheme", () => {
    const reg = makeRegistry();
    const initial = makeTheme(reg);
    const svc = new ThemeService(reg, initial);
    expect(svc.activeTheme).toBe(initial);

    const seen: any[] = [];
    svc.onDidChangeTheme(t => seen.push(t));
    const next = makeTheme(reg, { "test.background": "#111111" });
    svc.applyTheme(next);
    expect(svc.activeTheme).toBe(next);
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(next);
    svc.dispose();
  });

  it("getColor returns theme override; falls back to registry default; falls back to 'inherit'", () => {
    const reg = makeRegistry();
    const theme = makeTheme(reg, { "test.background": "#abcdef" });
    const svc = new ThemeService(reg, theme);
    expect(svc.getColor("test.background")).toBe("#abcdef"); // theme override wins
    expect(svc.getColor("test.foreground")).toBe("#ffffff"); // registry default (dark)
    expect(svc.getColor("does.not.exist")).toBe("inherit"); // ultimate fallback
    svc.dispose();
  });

  it("applyTheme injects a <style id=parallx-theme-colors> with --vscode-* vars inside body { ... }", () => {
    const reg = makeRegistry();
    const theme = makeTheme(reg, { "test.background": "#abcdef" });
    const svc = new ThemeService(reg, theme);
    svc.applyTheme(theme);

    const style = document.getElementById("parallx-theme-colors") as HTMLStyleElement | null;
    expect(style).toBeTruthy();
    expect(style!.tagName).toBe("STYLE");
    expect(style!.getAttribute("type")).toBe("text/css");
    const css = style!.textContent ?? "";
    expect(css.startsWith("body {")).toBe(true);
    expect(css.trim().endsWith("}")).toBe(true);
    expect(css).toContain("--vscode-test-background: #abcdef;");
    expect(css).toContain("--vscode-test-foreground: #ffffff;");
    svc.dispose();
  });

  it("applyTheme sets data-vscode-theme-type on <body>", () => {
    const reg = makeRegistry();
    const theme = makeTheme(reg);
    const svc = new ThemeService(reg, theme);
    svc.applyTheme(theme);
    expect(document.body.getAttribute("data-vscode-theme-type")).toBe(ThemeType.DARK);
    svc.dispose();
  });

  it("dispose() removes the injected <style> element from <head>", () => {
    const reg = makeRegistry();
    const theme = makeTheme(reg);
    const svc = new ThemeService(reg, theme);
    svc.applyTheme(theme);
    expect(document.getElementById("parallx-theme-colors")).toBeTruthy();
    svc.dispose();
    expect(document.getElementById("parallx-theme-colors")).toBeNull();
  });
});
