---
name: research-bar
description: Establish the bar for a feature or a surface from what the best products do and what research says, read today from primary sources. Use before designing or redesigning anything the owner will look at or operate, so its style and behaviour come from evidence.
---
# Reading the bar

The owner's rule: style is neither his taste nor Claude's. There is research, and there are products that got it right. A surface is designed from what was read, and the reading is on record.

## Steps

1. Name the feature and the two or three questions the design turns on (what it opens on, how a thing is selected, what a session is).
2. Before the web, the app: search `ext/`, `src/built-in/` and `docs/` for what already does this or overlaps it, under other names too. What exists is part of the bar and is never proposed as new.
3. Pick the sources: the three to six products that are best at this, the platform's own guideline if one applies (WCAG, Windows, Material, Apple HIG), and published studies where a question is empirical (session length, spacing, legibility).
4. Read them with the `bar-researcher` agent (or the saved `read-the-bar` workflow when asked to use a workflow): each vendor's own pages, today; every statement with its URL; exact words where wording matters.
5. Keep what could not be read (blocked, 404, too long) as a list. Nothing from memory unless marked so.
6. Write testable statements, not impressions. Where the app can be measured against a statement, measure it with a probe (`run-hidden`), as `tests/probes/sheet-cells-probe.mjs` does against Excel.
7. Record it in the feature's entry in `docs/MASTER_LIST.md`: what was read, what was not, what was taken, the date.

## What the design then owes the bar

Every choice on a mock-up names what it rests on: a product that does it, a guideline, a measurement, or "no evidence found, Claude's judgment". Choices with no evidence are the ones to put in front of the owner.
