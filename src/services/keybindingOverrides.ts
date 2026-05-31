// keybindingOverrides.ts — persistence for user keyboard-shortcut rebinds.
//
// The Keyboard Shortcuts panel writes overrides here; the workbench re-applies
// them once after tool activation so rebinds survive a relaunch. Stored in
// localStorage (synchronous, available before the registry is queried).

const KEY = 'px-keybindings';

export interface KbOverride {
  /** The user-chosen key, normalized-ish (as captured). */
  key: string;
  /** The key the command had before the first override, for Reset. */
  default?: string;
}

export function readKbOverrides(): Record<string, KbOverride> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, KbOverride>;
    }
  } catch { /* ignore */ }
  return {};
}

export function writeKbOverrides(map: Record<string, KbOverride>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function setKbOverride(commandId: string, key: string, defaultKey?: string): void {
  const map = readKbOverrides();
  // Preserve the originally-captured default across repeated rebinds.
  const existingDefault = map[commandId]?.default ?? defaultKey;
  map[commandId] = { key, default: existingDefault };
  writeKbOverrides(map);
}

export function clearKbOverride(commandId: string): KbOverride | undefined {
  const map = readKbOverrides();
  const prev = map[commandId];
  delete map[commandId];
  writeKbOverrides(map);
  return prev;
}

/** Minimal slice of the keybinding service this module needs. */
interface KbApplyTarget {
  setUserKeybinding(commandId: string, key: string): void;
}

/** Re-apply all persisted overrides. Call after tool activation at boot. */
export function applyKbOverrides(kb: KbApplyTarget): void {
  const map = readKbOverrides();
  for (const [commandId, ov] of Object.entries(map)) {
    if (ov?.key) {
      try { kb.setUserKeybinding(commandId, ov.key); } catch { /* ignore */ }
    }
  }
}
