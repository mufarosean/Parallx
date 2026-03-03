# Available Tools

## Workspace Skills
- **search_workspace** — Full-text search across all workspace files
- **search_knowledge** — Semantic (RAG) search using embeddings
- **read_file** — Read file contents (supports line ranges)
- **list_files** — List directory contents

## Canvas Skills
- **read_page** — Read a canvas page by ID
- **read_page_by_title** — Find and read a page by title
- **list_pages** — List all canvas pages
- **create_page** — Create a new canvas page (requires approval)
- **get_page_properties** — Get page metadata (icon, cover, dates)
- **read_current_page** — Read the currently open canvas page

## Tool Usage Guidelines
- Always read a file before editing it
- Use search_knowledge for conceptual questions ("how does auth work?")
- Use search_workspace for exact string matches ("where is handleLogin defined?")
- When editing files, make the smallest change necessary
- Explain what you're changing and why before proposing edits
