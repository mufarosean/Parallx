# editor

Editor groups, tabs and the panes. `editorGroupModel.ts` holds a group's
tabs and active editor; `editorGroupView.ts` draws it; `editorInput.ts`
and `editorPane.ts` are the base classes an editor implements;
`editorInputDeserializer.ts` restores tabs after a relaunch. `panes/` has
one pane per file kind: code, Markdown, PDF, EPUB, Word, Excel, image,
notebook.

May import: `platform`, `ui`, `layout`, `views`, service interfaces.
