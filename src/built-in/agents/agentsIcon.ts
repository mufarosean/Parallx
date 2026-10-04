// agentsIcon.ts — Agents' own mark, brought by its manifest
// (`contributes.icons`) and registered only while Agents runs.

import { BRAND_PLATE, brandIcon } from '../../ui/brandIcons.js';

/** The plate carrying a bolt. */
export const AGENTS_ICON = {
  id: 'px-automations',
  svg: brandIcon(
    BRAND_PLATE
    + '<path d="M13.4 6.5 L9 13 L11.8 13 L10.4 17.5 L14.8 11 L12 11 Z"/>',
  ),
} as const;
