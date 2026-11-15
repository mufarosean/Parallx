---
name: visual-bar
description: Hold a Parallx surface's look to measured criteria and to what the best sources say, instead of to anyone's taste. Use after UI work, when a surface is said to look wrong, or when judging whether tools look alike.
---
# The look, measured

The owner's rule: style is neither his taste nor Claude's; there is research. [criteria.md](criteria.md) lists what a surface is held to, each with its source.

## Steps

1. **Measure.** `xvfb-run -a node tests/probes/visual-consistency-probe.mjs <outDir> [--only=<screen>]` opens each tool's main screens hidden, takes a screenshot of each and counts what is off the criteria (targets, type scale, fonts, radii, control heights, capitals, cut-off text, primary buttons, page headers, title sizes). It compares with `tests/probes/visual-consistency-baseline.json` and prints what rose. After a real improvement, `--update` keeps the gain. Add a screen to its `SCREENS` list when a tool gains one.
2. **Contrast, keyboard, names, touch** come from `tests/probes/keyboard-audit-probe.mjs`.
3. **What a number cannot say** (spacing rhythm, alignment, hierarchy, sameness across tools) is judged from the screenshots by the `visual-evaluator` agent, one criterion at a time, each finding pointing at a place. A `skeptic` checks each before it is acted on: models judging interfaces from pictures are wrong often.
4. **Fix at the source.** A finding that repeats across tools is a kit or token change, not twenty edits. A front page without the kit's header gets the kit's header.
5. **Record** what was measured and what changed in the feature's entry in `docs/MASTER_LIST.md`.

## What this does not decide

Which of two layouts is better when both meet the criteria. That is drawn as mock-ups (the `mockups` skill), each option naming what it rests on, and the owner picks.
