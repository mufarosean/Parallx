// blockStateRegistry.ts — Two-way gate for all block state operations
//
// Outward: re-exports all children to blockRegistry and other consumers.
// Inward:  provides children with external dependencies (PAGE_CONTAINERS,
//          isContainerBlockType) so they never import from blockRegistry
//          directly.  Children only talk to this facade.
//
// This mirrors blockRegistry's own pattern — registries are two-way gates.

// ── Inward gate: dependencies children need from blockRegistry ──────────
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
