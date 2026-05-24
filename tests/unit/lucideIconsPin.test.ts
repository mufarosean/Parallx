// lucideIconsPin.test.ts — pin generated Lucide icon registry shape.

import { describe, it, expect } from "vitest";
import { LUCIDE_ICONS } from "../../src/ui/iconRegistry.generated";

describe("LUCIDE_ICONS generated registry", () => {
  it("is a non-empty object", () => {
    expect(typeof LUCIDE_ICONS).toBe("object");
    expect(Object.keys(LUCIDE_ICONS).length).toBeGreaterThan(100);
  });

  it("every value is a valid <svg> string with the Lucide spec viewBox", () => {
    for (const [k, v] of Object.entries(LUCIDE_ICONS)) {
      expect(typeof v, k).toBe("string");
      expect(v.startsWith("<svg "), k).toBe(true);
      expect(v.endsWith("</svg>"), k).toBe(true);
      expect(v.includes('viewBox="0 0 24 24"'), k).toBe(true);
    }
  });

  it("every icon uses stroke=currentColor and the Lucide stroke attributes", () => {
    // Sample a handful of well-known icons to keep runtime small but pin the spec.
    for (const k of ["activity", "album", "alert-circle", "a-arrow-down"]) {
      const v = LUCIDE_ICONS[k];
      expect(v).toBeTruthy();
      expect(v.includes('stroke="currentColor"')).toBe(true);
      expect(v.includes('stroke-width="2"')).toBe(true);
      expect(v.includes('stroke-linecap="round"')).toBe(true);
      expect(v.includes('stroke-linejoin="round"')).toBe(true);
    }
  });

  it("keys are kebab-case lowercase identifiers", () => {
    for (const k of Object.keys(LUCIDE_ICONS)) {
      expect(/^[a-z0-9][a-z0-9-]*$/.test(k), k).toBe(true);
    }
  });
});
