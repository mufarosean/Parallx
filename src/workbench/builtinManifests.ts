// builtinManifests.ts — the 18 built-in tools' manifests, in one list.
//
// Each manifest lives with its tool (src/built-in/<tool>/manifest.ts); this
// file gathers them for the workbench, which pairs each with its module at
// registration, and for the tests that check every built-in at once. It sits
// in the workbench because only the composition root may import a built-in.

export { EXPLORER_MANIFEST } from '../built-in/explorer/manifest.js';
export { SEARCH_MANIFEST } from '../built-in/search/manifest.js';
export { WELCOME_MANIFEST } from '../built-in/welcome/manifest.js';
export { TERMINAL_MANIFEST } from '../built-in/terminal/manifest.js';
export { OUTPUT_MANIFEST } from '../built-in/output/manifest.js';
export { INDEXING_LOG_MANIFEST } from '../built-in/indexing-log/manifest.js';
export { ACTIVITY_LOG_MANIFEST } from '../built-in/activity-log/manifest.js';
export { DIAGNOSTICS_MANIFEST } from '../built-in/diagnostics/manifest.js';
export { AGENTS_MANIFEST } from '../built-in/agents/manifest.js';
export { TOOL_GALLERY_MANIFEST } from '../built-in/tool-gallery/manifest.js';
export { CHAT_MANIFEST } from '../built-in/chat/manifest.js';
export { AI_SETTINGS_MANIFEST } from '../built-in/ai-settings/manifest.js';
export { CANVAS_MANIFEST } from '../built-in/canvas/manifest.js';
export { THEME_EDITOR_MANIFEST } from '../built-in/theme-editor/manifest.js';
export { PLANNER_MANIFEST } from '../built-in/planner/manifest.js';
export { WORKSHEET_MANIFEST } from '../built-in/worksheet/manifest.js';
export { DASHBOARD_MANIFEST } from '../built-in/dashboard/manifest.js';
export { SETTINGS_MANIFEST } from '../built-in/settings/manifest.js';
