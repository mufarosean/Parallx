// dashboardCommandTarget.ts — which dashboard a command means.
//
// The dashboard commands (Add Widget, Refresh All) fire DOM events the panes
// react to. A pane stays mounted, hidden, after its tab is left, so "the pane
// in the DOM" is no longer "the pane on screen": with two dashboards open,
// Add Widget put the new widget on the hidden one. The command names the
// active dashboard editor, and each pane answers only for itself.

/** The active editor's id when it is a dashboard; undefined otherwise, and then every mounted dashboard answers. */
export function activeDashboardEditorId(openEditors: readonly { readonly id: string; readonly isActive: boolean }[]): string | undefined {
  const active = openEditors.find((e) => e.isActive);
  return active && active.id.includes(':dashboard:') ? active.id : undefined;
}

/** Whether a command event is for the pane showing `inputId`: it names that editor, or none. */
export function isForPane(event: Event, inputId: string | undefined): boolean {
  const target = (event as CustomEvent<{ editorId?: string } | undefined>).detail?.editorId;
  return !target || target === inputId;
}
