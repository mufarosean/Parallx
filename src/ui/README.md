# ui

Reusable DOM widgets and the kit. `kit.ts` is the vocabulary every surface
draws from (buttons, page headers, section labels, empty states);
`contextMenu.ts`, `dropdown.ts`, `tooltip.ts`, `inputBox.ts`,
`segmentedControl.ts`, `slider.ts`, `toggle.ts` are the controls;
`undoToast.ts` is the Undo toast (`showUndoToast`);
`iconRegistry.ts` serves every icon (`iconRegistry.generated.ts` is built
from lucide by `scripts/build-icon-registry.mjs`); `renderMarkdown.ts`
renders Markdown; `codeEditor.ts` hosts CodeMirror.

Each widget extends `Disposable`, takes `(container, options?)` and has
co-located CSS on `--px-*` tokens.
May import: `platform`.
May not import: services, parts, built-ins.
