# Milestone 82 — Dashboard Widget Catalog & Image Widget

> **Status:** Image widget shipped 2026-05-28. Remaining widgets in this doc
> are a backlog of vetted ideas, not commitments — each is scoped against
> data sources Parallx already owns so we never invent a new backend just to
> fill a tile.
>
> Builds on the M71 dashboard (standalone `parallx.dashboard` editor, 12-column
> grid, widget contribution API with `chromeStyle` presets) and the recent
> dashboard polish pass (smooth drag, per-widget appearance, centered config
> modal, custom dropdowns, flush header-hidden layout).

## Why

The dashboard ships with three widgets — Clock & quick links, Recent files,
News brief. That's enough to prove the contribution model but not enough to
make the dashboard a daily destination. This milestone captures a prioritized
catalog of widget ideas and ships the first net-new one (Image), which also
validates a pattern the catalog leans on: **per-instance state persisted
through `ctx.setCachedOutput` / `ctx.cachedOutput`, no new storage columns.**

## Shipped — Image widget

`parallx.dashboard.image` ([imageWidget.ts](../src/built-in/dashboard/widgets/imageWidget.ts)).

- Drag-and-drop or click-to-upload an image onto a dashboard tile.
- The file is downscaled client-side (canvas, max 1280px longest edge) and
  encoded to a data URL, dropping JPEG quality until it fits the cache budget
  (`MAX_CACHED_OUTPUT_BYTES` = 256 KB) so the cache layer never truncates and
  corrupts it. PNG is tried first to preserve transparency for small images.
- Persisted via `ctx.setCachedOutput(dataUrl)`; restored on reload from
  `ctx.cachedOutput` and `refreshFromCache`. No schema/migration change.
- Config: `fit` (cover / contain) and `rounded` corners. Uses `bare` chrome so
  the picture sits edge-to-edge; a "Replace" affordance appears on hover.

### Pattern established
Self-contained, user-authored widget state belongs in the per-instance cache,
not in a bespoke column. Any future "scratchpad / sticky note / single value"
widget can follow the same `setCachedOutput` ⇄ `cachedOutput` round-trip.

## Backlog — widget ideas

Grouped by the data source they'd draw on. Effort is relative to the existing
widget pattern.

### High value — data already in Parallx
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Budget snapshot | budget extension SQLite | M | MTD spend, top categories, remaining vs. budget; tap to open finance view. |
| Media library stats | media-organizer DB | M | Photo/video counts, storage used, latest-4 thumbnail strip. |
| Autonomy activity feed | `data/autonomy-events.*.ndjson` | S–M | Compact timeline of recent agent/automation events. |
| Workspace graph mini-map | workspace-graph | M | Node/edge counts, most-connected notes; links into the graph view. |
| Recent conversations | chat store | S | Jump back into recent AI threads. |

### Productivity / glanceable
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Tasks / TODO | widget config (cache) | S | Client-side checklist; reuses the cache-state pattern. |
| Sticky note / scratchpad | widget config (cache) | S | Freeform markdown saved per instance. |
| Countdown / focus timer | client-side | S | Pomodoro or countdown-to-date. |
| Calendar / agenda | local config or future MCP calendar | M | Today's events. |
| Weather | web fetch (egress bridge) | M | Must route through the web-research/egress chokepoint. |
| Quick capture | workspace | S–M | One input that drops a note/file into the workspace. |

### AI-native (Parallx's differentiator)
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Daily brief | files + chats + autonomy events (AI) | L | "Here's what changed since yesterday." |
| Ask Parallx | chat | S–M | Inline prompt box that opens a seeded chat. |
| Suggested actions | recent activity (AI) | L | AI-surfaced next steps. |
| Research feed | web-research extension | M | Saved/queued web-research results. |

### System / utility
| Widget | Source | Effort | Notes |
| --- | --- | --- | --- |
| Storage & health | DB / workspace | S | DB size, file count, last migration/backup. |
| MCP servers status | MCP bridge | S–M | Connected servers, quick reconnect. |
| Bookmarks grid | widget config | S | Visual favicon tiles vs. the current text quick-links. |

## Security notes

- Any widget that fetches the network (Weather, Research feed) **must** route
  through the existing web-research egress chokepoint; no direct `fetch` from a
  widget.
- The image widget stores user content as a data URL in the local workspace DB
  only — no upload, no network. Downscaling caps the stored size.

## Out of scope

- Third-party / extension-contributed widgets (the API already supports it;
  this doc is about built-ins).
- Drag/resize, appearance, and layout behavior (covered by M71 + the polish pass).
