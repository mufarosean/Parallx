// pdfIcons.ts — the icons the PDF pane draws, from the central Lucide registry.

import { getIcon } from '../../../ui/iconRegistry.js';

export const ICON = {
  chevronLeft:  getIcon('chevron-left')!,
  chevronRight: getIcon('chevron-right')!,
  chevronUp:    getIcon('chevron-up')!,
  chevronDown:  getIcon('chevron-down')!,
  zoomOut:      getIcon('zoom-out')!,
  zoomIn:       getIcon('zoom-in')!,
  fitWidth:     getIcon('fit-width')!,
  fitPage:      getIcon('fit-page')!,
  search:       getIcon('search')!,
  listTree:     getIcon('list-tree')!,
  panelLeft:    getIcon('panel-left')!,
  trash:        getIcon('trash-2')!,
  copy:         getIcon('copy')!,
  send:         getIcon('send')!,
  canvasNote:   getIcon('file-plus')!,
  messages:     getIcon('message-square')!,
  grid:         getIcon('grid')!,
  more:         getIcon('ellipsis')!,
  check:        getIcon('check')!,
  close:        getIcon('close')!,
  chevronDownSm:getIcon('chevron-down')!,
  highlighter:  getIcon('highlighter')!,
  note:         getIcon('sticky-note')!,
  moon:         getIcon('moon')!,
  sun:          getIcon('sun')!,
  chat:         getIcon('px-ai-mark')!,
  sparkles:     getIcon('px-ai-mark')!,
  openExtSm:    getIcon('external-link')!,
} as const;
