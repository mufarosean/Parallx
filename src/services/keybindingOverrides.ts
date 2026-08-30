// keybindingOverrides.ts — persistence for user keyboard-shortcut rebinds.
//
// The Keyboard Shortcuts panel writes overrides here; the workbench re-applies
// them once after tool activation so rebinds survive a relaunch. Stored in
// durable global storage (the Retirement phase moved this off localStorage —
// the apply point runs long after boot, so nothing here needs a sync read).

import type { IStorage } from '../platform/storage.js';

const KEY = 'px-keybindings';

export interface KbOverride {
  /** The user-chosen key, normalized-ish (as captured). */
  key: string;
  /** The key the command had before the first override, for Reset. */
  default?: string;
}

async function readKbOverrides(storage: IStorage): Promise<Record<string, KbOverride>> {
  // Legacy adoption, self-terminating: pre-Retirement builds kept overrides in
  // localStorage. Adopt them into durable storage once, then remove the key so
  // this branch never runs again on this machine.
  try {
    const legacy = window.localStorage.getItem(KEY);
    if (legacy !== null) {
      if (!(await storage.has(KEY))) {
        await storage.set(KEY, legacy);
      }
      window.localStorage.removeItem(KEY);
    }
  } catch { /* ignore */ }

  try {
    const raw = await storage.get(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, KbOverride>;
    }
  } catch { /* ignore */ }
  return {};
}

async function writeKbOverrides(storage: IStorage, map: Record<string, KbOverride>): Promise<void> {
  try { await storage.set(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export async function setKbOverride(storage: IStorage, commandId: string, key: string, defaultKey?: string): Promise<void> {
  const map = await readKbOverrides(storage);
  // Preserve the originally-captured default across repeated rebinds.
  const existingDefault = map[commandId]?.default ?? defaultKey;
  map[commandId] = { key, default: existingDefault };
  await writeKbOverrides(storage, map);
}

export async function clearKbOverride(storage: IStorage, commandId: string): Promise<KbOverride | undefined> {
  const map = await readKbOverrides(storage);
  const prev = map[commandId];
  delete map[commandId];
  await writeKbOverrides(storage, map);
  return prev;
}

/** Minimal slice of the keybinding service this module needs. */
interface KbApplyTarget {
  setUserKeybinding(commandId: string, key: string): void;
}

/** Re-apply all persisted overrides. Call after tool activation at boot. */
export async function applyKbOverrides(storage: IStorage, kb: KbApplyTarget): Promise<void> {
  const map = await readKbOverrides(storage);
  for (const [commandId, ov] of Object.entries(map)) {
    if (ov?.key) {
      try { kb.setUserKeybinding(commandId, ov.key); } catch { /* ignore */ }
    }
  }
}
