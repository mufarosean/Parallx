/**
 * Pin: virtual editor inputs (Settings, Keybindings) + ImageEditorInput.
 * Covers the singleton lifecycle for the two virtual inputs and the
 * URI-keyed deduplication / read-only invariant for image inputs.
 */
import { describe, it, expect } from "vitest";
import { SettingsEditorInput } from "../../src/built-in/editor/settingsEditorInput";
import { KeybindingsEditorInput } from "../../src/built-in/editor/keybindingsEditorInput";
import { ImageEditorInput } from "../../src/built-in/editor/imageEditorInput";
import { URI } from "../../src/platform/uri";

describe("SettingsEditorInput", () => {
  it("TYPE_ID is 'parallx.editor.settings'", () => {
    expect(SettingsEditorInput.TYPE_ID).toBe("parallx.editor.settings");
  });

  it("getInstance() returns a singleton; second call returns same instance", () => {
    const a = SettingsEditorInput.getInstance();
    const b = SettingsEditorInput.getInstance();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(SettingsEditorInput);
  });

  it("instance fields: id, typeId, name='Settings', description='', isDirty=false", () => {
    const input = SettingsEditorInput.getInstance();
    expect(input.id).toBe("settings-editor");
    expect(input.typeId).toBe(SettingsEditorInput.TYPE_ID);
    expect(input.name).toBe("Settings");
    expect(input.description).toBe("");
    expect(input.isDirty).toBe(false);
  });

  it("matches() returns true for any other SettingsEditorInput, false otherwise", () => {
    const a = SettingsEditorInput.getInstance();
    expect(a.matches(a)).toBe(true);
    expect(a.matches({ id: "x", typeId: "other" } as any)).toBe(false);
  });

  it("re-creates a new instance after disposal", () => {
    const a = SettingsEditorInput.getInstance();
    a.dispose();
    const b = SettingsEditorInput.getInstance();
    expect(b).not.toBe(a);
    expect(b).toBeInstanceOf(SettingsEditorInput);
  });

  it("serialize() returns pinned/sticky=false virtual-doc shape (no data field)", () => {
    const input = SettingsEditorInput.getInstance();
    const s = input.serialize();
    expect(s).toEqual({
      inputId: input.id,
      typeId: SettingsEditorInput.TYPE_ID,
      name: "Settings",
      description: "",
      pinned: false,
      sticky: false,
    });
    expect((s as any).data).toBeUndefined();
  });
});

describe("KeybindingsEditorInput", () => {
  it("TYPE_ID is 'parallx.editor.keybindings'", () => {
    expect(KeybindingsEditorInput.TYPE_ID).toBe("parallx.editor.keybindings");
  });

  it("getInstance() returns a singleton", () => {
    expect(KeybindingsEditorInput.getInstance()).toBe(KeybindingsEditorInput.getInstance());
  });

  it("instance fields: id='keybindings-editor', name='Keyboard Shortcuts', isDirty=false", () => {
    const input = KeybindingsEditorInput.getInstance();
    expect(input.id).toBe("keybindings-editor");
    expect(input.typeId).toBe(KeybindingsEditorInput.TYPE_ID);
    expect(input.name).toBe("Keyboard Shortcuts");
    expect(input.description).toBe("");
    expect(input.isDirty).toBe(false);
  });

  it("matches() returns true only for other KeybindingsEditorInput", () => {
    const a = KeybindingsEditorInput.getInstance();
    expect(a.matches(a)).toBe(true);
    expect(a.matches(SettingsEditorInput.getInstance() as any)).toBe(false);
  });

  it("re-creates after disposal", () => {
    const a = KeybindingsEditorInput.getInstance();
    a.dispose();
    const b = KeybindingsEditorInput.getInstance();
    expect(b).not.toBe(a);
  });

  it("serialize() shape", () => {
    const input = KeybindingsEditorInput.getInstance();
    expect(input.serialize()).toEqual({
      inputId: input.id,
      typeId: KeybindingsEditorInput.TYPE_ID,
      name: "Keyboard Shortcuts",
      description: "",
      pinned: false,
      sticky: false,
    });
  });
});

describe("ImageEditorInput", () => {
  it("TYPE_ID is 'parallx.editor.image'", () => {
    expect(ImageEditorInput.TYPE_ID).toBe("parallx.editor.image");
  });

  it("id is URI key — same URI dedupes", () => {
    const u = URI.parse("file:///pics/a.png");
    const a = ImageEditorInput.create(u);
    const b = ImageEditorInput.create(u);
    expect(a.id).toBe(u.toKey());
    expect(b.id).toBe(a.id);
  });

  it("name is URI basename, description is URI fsPath", () => {
    const input = ImageEditorInput.create(URI.parse("file:///pics/a.png"));
    expect(input.name).toBe("a.png");
    expect(input.description).toContain("a.png");
  });

  it("uri returns the URI instance, isDirty=false (read-only)", () => {
    const u = URI.parse("file:///pics/a.png");
    const input = ImageEditorInput.create(u);
    expect(input.uri).toBe(u);
    expect(input.isDirty).toBe(false);
  });

  it("matches() compares URI equality across ImageEditorInput instances", () => {
    const a = ImageEditorInput.create(URI.parse("file:///pics/a.png"));
    const b = ImageEditorInput.create(URI.parse("file:///pics/a.png"));
    const c = ImageEditorInput.create(URI.parse("file:///pics/b.png"));
    expect(a.matches(b)).toBe(true);
    expect(a.matches(c)).toBe(false);
    expect(a.matches({ uri: a.uri } as any)).toBe(false); // type guard
  });

  it("serialize() returns shape with pinned/sticky=false + data.uri", () => {
    const u = URI.parse("file:///pics/a.png");
    const input = ImageEditorInput.create(u);
    expect(input.serialize()).toEqual({
      inputId: input.id,
      typeId: ImageEditorInput.TYPE_ID,
      name: "a.png",
      description: input.description,
      pinned: false,
      sticky: false,
      data: { uri: u.toString() },
    });
  });
});
