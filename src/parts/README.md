# parts

The fixed regions of the window: title bar, activity bar, side bar, editor
area, panel, auxiliary bar, status bar. `part.ts` is the base class;
`partRegistry.ts` finds them by id. Parts host view containers and the
editor groups; they own no feature logic.

May import: `platform`, `ui`, `layout`, `editor`, service interfaces.
