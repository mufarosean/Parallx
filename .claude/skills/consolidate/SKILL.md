---
name: consolidate
description: Find where parts of Parallx have grown the same thing twice (copied code, or two tools each with their own version of one idea) and bring it to one. Use when systems feel conjoined or drifting, before joining or reworking tools, and as a periodic pass.
---
# Bringing two of a thing to one

A codebase a model writes grows by adding beside, not by folding in. Two measures find it; neither fixes it.

## Find

1. **Copied code.** `DUPLICATION_REPORT=1 npx vitest run tests/unit/duplicationRatchet.test.ts` lists the pairs of files that share the most lines. `tests/unit/duplicationRatchet.test.ts` keeps each file's count from rising.
2. **The same idea twice.** Copied lines are the small part. The large part is two tools that each built their own sessions, their own progress, their own schedule. Read the tools side by side: with a workflow asked for, `understand` with `{ question, areas }` (it returns the nouns that mean the same under different names, where the parts meet, where they overlap); otherwise read them yourself and write the same table.
3. **The look.** `tests/probes/visual-consistency-probe.mjs` shows which front pages do not use the kit's header and which patterns differ between tools (the `visual-bar` skill).

## Decide, with the owner

What is one thing and what is two is his call where it changes what a tool is. Put the overlap in the tool's entry in `docs/MASTER_LIST.md` with the evidence, and what each choice loses. Nothing is merged until he says go on that entry.

## Do

- Shared code goes where both may import it: the kit or a core seam for what every tool needs; a contribution point when one tool offers something another uses. An extension never imports another extension.
- One piece at a time, each through `ship-piece`. The acceptance probe for a consolidation is that everything the two did before still works: write it against both before touching either.
- After the counts fall: `UPDATE_DUPLICATION_BASELINE=1 npx vitest run tests/unit/duplicationRatchet.test.ts`, and `--update` on the visual probe, so the gain is kept. Lowering a baseline is the only edit a baseline gets.
