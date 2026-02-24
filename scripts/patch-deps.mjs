// scripts/patch-deps.mjs — Patch third-party dependencies after install
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── tiptap-extension-global-drag-handle patches removed ──
// GlobalDragHandle is no longer used for handle positioning.
// BlockHandlesController (handles/blockHandles.ts) owns handle creation,
// positioning, and block resolution natively.  No library patches needed.
//
// This file is kept as a placeholder for future dependency patches.
console.log('patch-deps: no patches to apply');
