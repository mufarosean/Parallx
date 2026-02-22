// blockStateRegistry.ts — Two-way gate for all block state operations
//
// Outward: re-exports all children to blockRegistry and other consumers.
// Inward:  provides children with external dependencies (PAGE_CONTAINERS,
//          isContainerBlockType) so they never import from blockRegistry
//          directly.  Children only talk to this facade.
//
// ⚠️  CYCLE: This file and blockRegistry.ts form a permitted circular
// dependency.  It is safe ONLY because both directions use
// `export { X } from '...'` syntax — ES module live bindings with no
// evaluation-time reads.  NEVER convert these to `import X; export Y = X`
// or add top-level code that reads a blockRegistry symbol.  The cycle
// safety is enforced by gateCompliance.test.ts.

// ── Inward gate: dependencies children need from blockRegistry ──────────
// Uses `export { } from` (live re-export) — safe across the cycle.
/** @see {@link import('../blockRegistry.js').PAGE_CONTAINERS} — original source */
export { PAGE_CONTAINERS, isContainerBlockType } from '../blockRegistry.js';

// ── Outward gate: public APIs from children ─────────────────────────────
export * from './columnInvariants.js';
export * from './columnCreation.js';
export * from './dragSession.js';
export * from './blockLifecycle.js';
export * from './blockTransforms.js';
export * from './blockMovement.js';
export * from './crossPageMovement.js';

// ── Column plugins (block-state concerns: resize, drop, auto-dissolve) ──
export { columnResizePlugin } from '../../plugins/columnResizePlugin.js';
export { columnDropPlugin } from '../../plugins/columnDropPlugin.js';
export { columnAutoDissolvePlugin } from '../../plugins/columnAutoDissolve.js';
