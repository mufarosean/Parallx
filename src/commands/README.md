# commands

The command registry (`commandRegistry.ts`), Quick Open and the command
palette (`quickAccess.ts`), and the built-in structural commands, one
file per area: editor, file, focus, layout, view, workspace, text size.
`structuralCommands.ts` registers them all.

May import: `platform`, `context`, service interfaces.
