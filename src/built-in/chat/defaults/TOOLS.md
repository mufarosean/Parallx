# Available Tools

Parallx has two distinct workspace surfaces, and tools are namespaced
accordingly so they never collide in the model's attention:

- **Filesystem tools** (unprefixed) operate on real files on disk —
  `.md`, `.pdf`, code files, anything in the workspace folder tree.
- **Canvas tools** (`canvas_*` prefix) operate on the canvas page DB —
  rich-text pages with properties, hierarchy, and metadata, stored in
  SQLite. Canvas pages are NOT files on disk.

Use the prefix to pick the right family before reading any description.

## Filesystem Skills
- **grep_search** — Exact-string / regex search across workspace files
- **search_files** — Find files by name pattern
- **search_knowledge** — Semantic (RAG) search using embeddings. Covers
  all indexed content including PDFs, DOCX, EPUB, XLSX, and other rich
  documents. Best tool for searching large documents.
- **read_file** — Read a workspace file on disk (text + PDF/DOCX/EPUB/XLSX).
  For canvas pages, use `canvas_read_page` instead.
- **list_files** — List directory contents on disk
- **write_file** — Create or overwrite a workspace file. For canvas pages,
  use `canvas_create_page` or `canvas_compose_page` instead.
- **edit_file** — Edit a workspace file by find-and-replace. For canvas
  pages, use `canvas_edit_block` or `canvas_compose_page` instead.
- **delete_file** — Delete a workspace file.

## Canvas Skills
- **canvas_find_pages** — Find or list canvas pages by text query (matches
  title AND content), property filters, sort, group
- **canvas_read_page** — Read a canvas page by UUID, title, or the literal
  `"current"` for the active editor page
- **canvas_get_page** — Get a page's metadata, properties, and applicable
  property definitions
- **canvas_create_page** — Create a new canvas page (requires approval)
- **canvas_compose_page** — Author or update a page from markdown
  (replace / append / prepend; requires approval)
- **canvas_set_page_property** — Set a page property (tags, status, etc.)
- **canvas_set_page_style** — Update a page's icon, cover image, font
  family, full-width, or small-text settings (requires approval)
- **canvas_list_property_definitions** — List workspace property
  definitions (the schema for canvas page properties)
- **canvas_read_block** — Read a single block inside a canvas page
- **canvas_edit_block** — Replace a block's text (requires approval)
- **canvas_insert_block_after** — Insert a block after an anchor block
- **canvas_link_block** — Cross-link two canvas blocks

## Tool Usage Guidelines

### Picking the right family
- The user said "file" or named a path like `Notes/foo.md`, `src/x.ts`,
  `README.md`, or referenced anything outside the canvas → **filesystem
  tools**.
- The user said "page", "canvas page", "my journal", "this page" without
  a path, or referenced something they're viewing in the canvas
  editor → **canvas tools**.
- If ambiguous (e.g. "open my notes"), prefer `canvas_find_pages` first
  — it searches title and content and will surface the right candidate.

### Canvas page resolution
- **Never ask the user for a page UUID.** Users refer to pages by what
  they contain or by title, not by id. To resolve a page:
  1. If the user says "this page", "the current page", "the page I'm
     on" → call `canvas_read_page` with `pageId: "current"`.
  2. If the user describes content ("the page about X", "my notes
     on Y") → call `canvas_find_pages` with `query: "X"`. The query
     matches both titles and body text.
  3. If the user names a page → call `canvas_read_page` with the title;
     it falls back through exact UUID → exact title → partial title
     match.
  4. Only after you have a single matching UUID should you call write
     tools (`canvas_compose_page`, `canvas_set_page_property`,
     `canvas_set_page_style`).
- If `canvas_find_pages` returns multiple candidates, surface the top
  results to the user and ask which one — do not guess.

### Filesystem
- When context from files is already in the message (via automatic
  retrieval), use it directly — do not re-read the file.
- Use `search_knowledge` for conceptual questions ("how does auth
  work?") and for large documents (books, reports).
- Use `grep_search` for exact string matches across workspace files
  ("where is handleLogin defined?").
- Use `read_file` for small files or when you need the full content of
  a specific file.
- File paths are always relative to the workspace root. Use forward
  slashes. No `./`, no `..`.
- When editing files, make the smallest change necessary.
- Explain what you're changing and why before proposing edits.
