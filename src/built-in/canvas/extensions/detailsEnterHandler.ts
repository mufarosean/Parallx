// detailsEnterHandler.ts — Enter on collapsed toggle → new toggle
//
// TipTap's built-in Details Enter handler creates a plain paragraph when the
// toggle is collapsed.  This extension intercepts Enter FIRST (priority 200)
// and inserts a new details block below instead, matching Notion behaviour.

import { Extension } from '@tiptap/core';

export const DetailsEnterHandler = Extension.create({
  name: 'detailsEnterHandler',
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection, schema } = state;
        const { $head, empty } = selection;

        // Only act when cursor is inside a detailsSummary
        if (!empty || $head.parent.type !== schema.nodes.detailsSummary) {
          return false;
        }

        // Check if the detailsContent is hidden (collapsed)
        const detailsContentPos = $head.after() + 1;
        const domNode = editor.view.domAtPos(detailsContentPos).node as HTMLElement;
        const isVisible = domNode.offsetParent !== null;

        if (isVisible) {
          // Open toggle → let the built-in handler deal with it
          return false;
        }

        // Collapsed → insert a new details block below the current one
        const detailsDepth = $head.depth - 1;  // detailsSummary is 1 level inside details
        const afterDetails = $head.after(detailsDepth);

        editor.chain()
          .insertContentAt(afterDetails, {
            type: 'details',
            content: [
              { type: 'detailsSummary' },
              { type: 'detailsContent', content: [{ type: 'paragraph' }] },
            ],
          })
          .focus(afterDetails + 2)  // inside the new detailsSummary
          .run();

        return true;
      },
    };
  },
});
