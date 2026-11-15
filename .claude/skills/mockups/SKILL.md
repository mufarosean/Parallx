---
name: mockups
description: Draw mock-ups of a Parallx surface in the app's own colours, type and icons, as a page of choices the owner picks from. Use when a new or redesigned surface needs his pick before it is built.
---
# Mock-ups in the app's own look

A surface is drawn before it is built, as a page of choices. Each choice shows its options as app windows in Parallx's tokens, dark and light, with what the person gets, what it costs, and what the option rests on.

## Before drawing

1. The bar is read (the `research-bar` skill) and what the app does today is measured, so each option rests on something.
2. The app is searched for what already exists (`ext/`, `src/built-in/`, `docs/`). Nothing is drawn as new that the app already has. The first draft of the Worksheets page drew Study as a new tool; it had existed for a month.

## Drawing

- Start from [mockup-kit.html](mockup-kit.html): the tokens from `src/theme/px-tokens.css` for both modes, the window frame (title bar, activity bar, sidebar, tabs, pane), kit-like controls (`.btn`, `.ib`, `.chip`, `.seg`, `.pill`), a spreadsheet grid, a page, lists, and the builders `win()`, `grid()`, `row()`, `opt()`, `put()`.
- Icons come from the app's registry: `node .claude/skills/mockups/icons.mjs <names…>` prints the object to paste in place of `__ICONS__`.
- Real content: his kind of data, real numbers that add up, today's date. No lorem ipsum.
- Copy follows the house rules: Title Case for actions and titles, sentence case for labels and hints, no uppercase micro-labels, no em dashes in labels, `…` when an action opens a dialog.
- Two to three options per choice, each a letter (1A, 1B). Mark one "Claude's pick" and say in one line what the pick rests on: a product, a guideline, a measurement, or judgment where no evidence was found.
- End with what is needed from him (a letter per choice), what was considered and set aside, and what was not read.

## Publishing

Publish the page with the Artifact tool and give him the link. Look at it once before publishing (a screenshot at desktop and phone width, dark and light). Record the link, the choices and his picks in the feature's entry in `docs/MASTER_LIST.md`.

## After his picks

His letters go in the master list in his words. "I trust your picks" makes the picks his; it does not remove the need for the reviewers to check the built piece against the picked drawing.
