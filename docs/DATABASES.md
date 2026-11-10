# Databases Charter

Started 2026-11-09 on `dev`. Canvas databases brought to the bar Notion set:
the part of Notion that made it fun to keep a database of the books one has
read. Mufaro's words on the version before this program: "very limited",
"can't even resize columns", "the UI is horrible". The verdict is settled;
this document records the bar, what is built, and what is owed.

## The bar (Notion, researched 2026-11-09)

Sources: Notion help center (database views, filters, sorts and groups;
database properties; board view; intro to databases; when to use each view)
and the Notion API reference for view and property types.

| Area | Notion | Before this program |
| --- | --- | --- |
| Views | Table, Board, List, Gallery, Calendar, Timeline, Chart (and Form, Map, Dashboard in the API) | Table, Board |
| Property types | title, text, number, select, multi-select, status, date, person, files and media, checkbox, URL, email, phone, formula, relation, rollup, created time, created by, last edited time, last edited by, unique ID, button, place | text, number, checkbox, date, datetime, tags, select, URL |
| Per view | filter, sort, group and sub-group, show/hide and order properties, wrap cells, freeze column, resize columns, calculations row, card size and preview, open pages in side peek / center peek / full page | filter, sort, hide, board group by |
| Database page | icon, cover, description, lock, templates for new rows, a linked view inside any page | title only (icon drawn, never editable) |
| Row page | property panel with show always / hide when empty / hide always per property | property panel |

## What was wrong, found in the code

- The header icon was a plain span: no path to the icon picker a page has.
- The resize grip was clipped to a 3 px strip by the header's `overflow:
  hidden`, and the table was forced to `min-width: 100%`, so a dragged width
  was redistributed by the browser. Resizing did nothing visible.
- `createDatabase` seeded a Status column even when the caller named its own
  columns, so every AI-made database started with a stray column.
- Dates wrapped onto two lines, URLs ran off the edge, nothing controlled
  wrap or clip, and a row opened only from a hover button.

## The program

Seven steps, each shipped complete with its tests, in this order. A step is
done when the app does it, the suite passes and the accessibility probes
report 0.

1. **Table done right.** Column resize that works (pointer, keyboard), wrap
   or clip per column, freeze up to a column, drag or keyboard reorder of
   columns, a calculations row (count, count values, empty, not empty,
   percent empty, sum, average, median, min, max, range, earliest, latest,
   checked, unchecked), open a row beside the table or as a full page,
   keyboard navigation cell to cell, no stray Status column, dense rows and
   consistent type.
2. **Database identity.** Icon picker and cover on the database header, the
   same picker a page uses; a description line; lock.
3. **Property types, round 2.** Status (grouped options: To-do, In progress,
   Complete), email, phone, files and media, created time, last edited time,
   unique ID. Option colours editable where they are used.
4. **Views, round 2.** List, Gallery (card preview from a files property or
   the page's first image), Calendar on any date property, Timeline on a
   start and end date, Chart (bar, line, donut) over a group and a measure.
5. **Relation and rollup.** Link rows across databases (one way, or synced
   both ways), then aggregate across the link.
6. **Formula.** A typed expression over the row's properties with Notion's
   common functions, errors shown in the cell, never written to disk.
7. **Templates and linked views.** New-row templates with a default, and
   the linked database block choosing any view with its own filter.

## Architecture

- A database is a page; a row is a page; cells live in
  `page_property_values` as JSON, one stored shape per property type
  (`database/cellValues.ts`). Nothing in this program changes that.
- Computed types (formula, rollup, created time, last edited time) are never
  stored. `database/rowCompute.ts` derives them from the row, its page and
  the related rows, and the view model filters and sorts on the derived
  value like any other.
- View state is per view, in `database_views.config`: `widths`, `hidden`,
  `order`, `wrap`, `freeze`, `calc`, `openIn`, `cardSize`, `preview`,
  `dateProperty`, `endDateProperty`, `chart`.
- Database settings that are not a view's (description, templates, the
  default template) live in `databases.config` (migration 019).
- Rendering is split by view: `database/tableView.ts`, `boardView.ts`,
  `listView.ts`, `galleryView.ts`, `calendarView.ts`, `timelineView.ts`,
  `chartView.ts`, each a function of the pane's state and callbacks. The
  pane (`databaseEditorPane.ts`) loads, owns the header and the view tabs,
  and dispatches. Shared pieces: `cellRender.ts` (a value, read-only, for any
  type), `viewSettings.ts` (the view's menu), `calculations.ts` (pure),
  `databaseHeader.ts`.
- New files build their UI with the kit (`createBlock`, `createButton`,
  `createIconButton`, `declareControl`) and `addDisposableListener`; the raw
  DOM, mouse press, hover reveal and file size ratchets hold.
- Every write goes through `DatabaseDataService`; the AI tools, the row
  panel and the views share it.

## Record

All seven steps shipped on 2026-11-09, each checked in a hidden copy of the
app (screenshots of every view, dialog and menu) and by unit tests on a
real SQLite database. Mufaro's verdict on the whole is owed.

| Step | Commit | What changed in the app |
| --- | --- | --- |
| 1 Table done right | `d955ee7a` | Resize that works, wrap/clip, freeze, reorder, calculations row, side peek, arrow keys, no stray Status column |
| 2 Identity | `d50694ec` | Icon picker, cover (change, reposition, remove), description, lock |
| 3 Types round 2 | `e4f61a36` | Status, email, phone, files and media, ID, created and last edited time; pill colour menu |
| 4 Views round 2 | `21a69f21` | List, Gallery, Calendar, Timeline, Chart; board sub-groups, card size and preview |
| 5 Relation and rollup | `68da3d93` | One-way or synced relations with a link picker; rollups shown as what they compute |
| 6 Formula, 7 Templates | see git | The formula language and its dialog; new-row templates with a default; the linked block's view chooser |

Known limits, said plainly:

- A linked database block shows one of the database's own views; a view's
  filter and sort are the view's wherever it is shown (Notion's linked
  views can filter independently). A view made for a page is a view of the
  database.
- Formulas have no map/filter over lists and no person or button types;
  the function list is in `database/formula.ts`.
- A relation's synced setting is chosen when it is made; to change it,
  make the relation again.
- Center peek (a row opened in a modal over the view) is not built; rows
  open beside the view or as a page.
- Template pages show under the database in the sidebar, as pages.

Checks run at the end: `npm run typecheck`, the full `npx vitest run`,
`npm run build`, and the keyboard and touch probes (recorded below when
they ran).
