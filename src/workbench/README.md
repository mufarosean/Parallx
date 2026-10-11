# workbench

The composition root. `workbench.ts` boots the app in named phases:
services (`workbenchServices.ts`), parts and layout (`layout.ts`,
`partDrag.ts`, `savedLayouts.ts`), editors (`workbenchFileEditorSetup.ts`),
tool activation, state restore. `workbenchFacadeFactory.ts` builds the
service bag the `parallx.*` API draws from; `statusBarController.ts` and
`surfaces/` are the shell's own status and notification surfaces.

May import: anything.
