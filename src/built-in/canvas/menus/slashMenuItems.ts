// slashMenuItems.ts — Pure data mapping from block definitions to slash menu items
//
// This file is a leaf of the menu system.  It contains ZERO orchestration
// logic — no editor mutations, no data-service calls, no popup launches.
// All block insertion semantics live on BlockDefinition.insertAction in
// the block registry; the menu registry's executeBlockInsert() delegates
// to those callbacks at execution time.
//
// Block metadata (label, icon, description, order) is provided by the
// canvasMenuRegistry — this file never imports blockRegistry directly.

// ── Local narrow types ──────────────────────────────────────────────────────
// slashMenuItems is a leaf of the menu system and receives dependencies
// through slashMenu → canvasMenuRegistry.  It defines its own narrow shapes
// rather than importing shared types from canvasTypes.ts or blockRegistry.ts.

/** Narrow block definition shape — only the fields slash-menu building needs. */
export interface SlashBlockDef {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly iconIsText?: boolean;
  readonly defaultContent?: Record<string, any>;
  readonly slashMenu?: { readonly label?: string; readonly description: string };
}

export interface SlashMenuItem {
  /** Block registry ID — used by the registry to look up the insertAction. */
  blockId: string;
  label: string;
  icon: string;
  description: string;
}

// ── Build slash menu items from block definitions ───────────────────────────

/**
 * Build the final SlashMenuItem array from block definitions.
 *
 * Called by slashMenu.ts with data sourced from canvasMenuRegistry
 * (which reads from blockRegistry).  This file never imports
 * blockRegistry directly.
 *
 * Items carry only display data + blockId.  Execution is delegated to
 * canvasMenuRegistry.executeBlockInsert() by the caller.
 */
export function buildSlashMenuItems(defs: readonly SlashBlockDef[]): SlashMenuItem[] {
  return defs.map((def) => ({
    blockId: def.id,
    label: def.slashMenu!.label ?? def.label,
    icon: def.icon,
    description: def.slashMenu!.description,
  }));
}
