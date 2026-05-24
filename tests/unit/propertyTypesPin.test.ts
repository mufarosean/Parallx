/**
 * Pin: propertyTypes — SYSTEM_PROPERTY_NAMES contents and isSystemPropertyName behavior.
 */
import { describe, it, expect } from "vitest";
import { SYSTEM_PROPERTY_NAMES, isSystemPropertyName } from "../../src/built-in/canvas/properties/propertyTypes";

describe("built-in/canvas/properties/propertyTypes", () => {
  it("SYSTEM_PROPERTY_NAMES contains exactly tags, created, modified", () => {
    expect([...SYSTEM_PROPERTY_NAMES].sort()).toEqual(["created", "modified", "tags"]);
  });

  it("isSystemPropertyName returns true for each system name", () => {
    expect(isSystemPropertyName("tags")).toBe(true);
    expect(isSystemPropertyName("created")).toBe(true);
    expect(isSystemPropertyName("modified")).toBe(true);
  });

  it("isSystemPropertyName is case-sensitive and returns false for unknown / variants", () => {
    expect(isSystemPropertyName("Tags")).toBe(false);
    expect(isSystemPropertyName("TAGS")).toBe(false);
    expect(isSystemPropertyName("status")).toBe(false);
    expect(isSystemPropertyName("")).toBe(false);
  });

  it("SYSTEM_PROPERTY_NAMES is a ReadonlySet (size === 3)", () => {
    expect(SYSTEM_PROPERTY_NAMES.size).toBe(3);
  });
});
