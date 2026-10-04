// plannerIcon.ts — Planner's own mark, brought by its manifest
// (`contributes.icons`) and registered only while Planner runs.

import { BRAND_PLATE, brandIcon } from '../../ui/brandIcons.js';

/** Binding ticks piercing the plate + a done-check (no divider, which is
 *  what separates it from Lucide's calendar-check). */
export const PLANNER_ICON = {
  id: 'px-planner',
  svg: brandIcon(
    BRAND_PLATE
    + '<path d="M9.5 2.2 L9.5 6"/>'
    + '<path d="M14.5 2.2 L14.5 6"/>'
    + '<path d="M8.3 13.6 L10.4 15.7 L15.7 10.4"/>',
  ),
} as const;
