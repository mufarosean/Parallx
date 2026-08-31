# Mindmap — RETIRED 2026-08-31

The mindmap program (its own editor; nodeCanvas cards; then the embedded
Excalidraw board; AI draft doors) is RETIRED and removed from the tree.
Mufaro's verdict after using it: the AI output was unusable (an
ungrounded draft mapped "Meyers" reserving notes to Myers-Briggs — the
grounding rail's unsourced path was an escape hatch), the layout
overlapped, and outsourcing a core Parallx surface to an external engine
was the wrong product call.

What the retirement kept:
- `src/ui/nodeCanvas.ts` — the pan/zoom node surface; it belongs to the
  WORKFLOW editor (docs/WORKFLOWS_BRIEF.md), which stands unaffected.
- The chat inline concept maps (M102) and the dashboard mind-map widget
  — earlier, separate features; untouched.
- Migration 014 (`mindmaps` table) — append-only history; dormant.

The replacement direction, in Mufaro's words: take the dashboard surface
we already own, make it an infinite canvas, add connectors. In-house,
on our own primitives. Design it WITH him before building.

Do not re-propose embedding an external whiteboard engine.
