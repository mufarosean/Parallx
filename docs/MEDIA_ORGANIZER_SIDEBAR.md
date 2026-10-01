# Media Organizer sidebar

Media Organizer is called **Atelier** since 2026-10-01 (Mufaro). Only the
name shown changed; ids, settings keys and the database are still
`media-organizer` / `mediaOrganizer`.

Status: built 2026-10-01, option B of `docs/mockups/media-organizer-sidebar.html`
with a Studio section, as Mufaro chose ("I think I like B", then "lets do studio").

## Why it changed

Section headers looked like rows (same size, same kind of icon, nothing
between sections), the Library header and All Media shared an icon, an empty
Clip Projects section offered New twice, Albums had a blank icon (it asked for
`folder-library`, which the icon registry does not have), smart albums were
only reachable from a command's quick pick, and Folders, Tags and Albums each
scrolled in a small box and squeezed one another when opened. No row showed
which view was open.

## What it is now

From the top:

- **The places to look**, with no header: All Media, Favorites, Recent, each
  with its count.
- **To sort**: Untagged and Duplicates with their counts, Tag Review with its
  badge. A job with nothing left in it goes quiet (muted label).
- **Collections**: albums (the tree as before, drag and drop as before) and
  smart albums, told apart by icon and a "Smart" caption. + offers New Album…
  and Save Current Search as Smart Album…. A smart album opens as a grid of the
  whole library with its saved search applied and its name as the title
  (`grid:smart:<id>`); right-click renames or deletes it (only the saved search
  is deleted).
- **Studio**: what is being made. Its + offers New Clip Project… and Record
  Screen… (a recording opens as a temporary project; closing it erases the
  recording, and what is exported from it stays). Before that, Clip projects (as before: + makes one,
  right-click renames or deletes), and Daily Study, Practice Session and
  Painting Plans while Drawing and Painting Tools is on. This replaces the
  Drawing and Painting section.
- **Browse**: a Folders | Tags switch, then the chosen list's filter (always
  shown) and its actions (Add Folder…; sort and New Tag…), then the list,
  which takes the rest of the height. `/` switches to Tags and focuses the
  filter. The choice is kept in `sidebar_browse`.
- **Trash**, at the foot, with its count.

Headers are a quiet label on a hairline with room above; their buttons show
while the sidebar is pointed at or has focus. Sections fold (kept in
`sidebar_layout`); the old sashes and section weights are gone, since only
Browse grows. The row whose view is in front is marked (`data-view` on the row,
matched against the active editor's id). Counts refresh after a scan and on
grid refreshes.

Keyboard Shortcuts stays in the library's ⋯ menu and on `?`; the mockup's
keyboard icon at the foot was not added.

## Checks

- `node tests/probes/ui-screenshot-probe.mjs <out> sidebar`: dark, a view open
  (its row marked), Tags chosen, light.
- `tests/unit/moGridView.test.ts`: a smart album's instance id.
