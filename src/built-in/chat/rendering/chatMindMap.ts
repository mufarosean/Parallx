// chatMindMap.ts — the M102 inline concept map, PROMOTED to
// ui/conceptMap.ts (2026-08-31) so chat and the canvas conceptMap block
// share one parser, one layout, one renderer. This shim keeps chat's
// import paths and the original test suite pointing at the same
// behaviour; new consumers import ui/conceptMap directly.

export {
  parseMindMap,
  parseMindMapInfo,
  layoutMindMap,
  splitLabel,
  renderMindMapSvg,
  renderMindMapFallback,
  type MindMapNode,
  type MindMapDirection,
  type MindMapLayout,
  type LaidOutNode,
} from '../../../ui/conceptMap.js';
