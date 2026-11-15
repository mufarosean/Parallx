# What a Parallx surface is held to

Each line is something that can be checked on a screenshot or measured in the page. The source is beside it. Where sources differ, the app's choice is stated. Read 2026-11-15; pages that could not be read are listed at the end.

## Measured by `tests/probes/visual-consistency-probe.mjs`

| Criterion | Number | Source |
|---|---|---|
| A control is at least 24 by 24 CSS px, or no other control lies within the 24 px circle centred on it | 24 px | WCAG 2.2, 2.5.8 Target Size (Minimum), AA: https://www.w3.org/TR/WCAG22/ |
| Text is on the type scale | 10, 11, 12, 13, 15, 18, 22 px | The app's tokens, `src/theme/px-tokens.css` |
| Text is in the UI font or the mono font | two families | The app's tokens |
| A corner is one of the app's radii, or a full pill | 1, 4, 6, 10, 14 px | The app's tokens |
| A button or field is a control height | 22, 24, 28, 32 px | The app's tokens |
| No label is set in capitals | none | The app's copy rule (CLAUDE.md); Anthropic's frontend-design skill lists "all caps for labels" among the marks of generic output |
| Text that is cut off shows an ellipsis, and the whole text is available (a title or a name) | every case | WCAG 2.2, 1.4.4 and 4.1.2 |
| One primary action to a view | at most 1 | The kit's rule (`src/ui/kit.ts`); Vercel's interface guidelines ask for one clear primary action |
| A tool's front page uses the kit's page header | every front page | The kit; NN/g heuristic 4, Consistency and Standards: https://www.nngroup.com/articles/ten-usability-heuristics/ |
| Page titles are one size and weight across tools | 22 px / 600 | The app's tokens; the same heuristic |

## Measured by `tests/probes/keyboard-audit-probe.mjs`

| Criterion | Number | Source |
|---|---|---|
| Text contrast | 4.5:1 (3:1 for large text) | WCAG 2.2, 1.4.3; Microsoft's accessible text requirements; Apple HIG |
| Non-text contrast: control edges, focus rings, icons that carry meaning | 3:1 | WCAG 2.2, 1.4.11 |
| Every control is reached by keyboard and nothing traps it | all | WCAG 2.2, 2.1.1 and 2.1.2 |
| Focus is visible, and not hidden behind something | all | WCAG 2.2, 2.4.7 and 2.4.11 |
| Every control has a name | all | WCAG 2.2, 4.1.2 |
| A drag can also be done without dragging | all | WCAG 2.2, 2.5.7 |
| What hover shows can be dismissed, hovered and stays | all | WCAG 2.2, 1.4.13 |

## Judged from a screenshot by `visual-evaluator`, one criterion at a time

These cannot be read from the page as a number, so a model looks. Measured against people, models judging interfaces from pictures were wrong far more often than right in two studies (an 80% false-positive rate; 21% of experts' findings matched) and better than five people in a third, all on older models. So each finding must point at the place on the screenshot and name the criterion, and a skeptic checks it before anyone acts.

| Criterion | What to look for | Source |
|---|---|---|
| Spacing follows a rhythm | gaps between like things are equal; 8 px between buttons, 12 px control to its label, 16 px edge of a surface to its text | Windows app design, spacing: https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics |
| Alignment is deliberate | edges of blocks share lines; nothing sits a few pixels off its neighbours | Vercel web interface guidelines: "Deliberate alignment to grid/baseline/edges" |
| Hierarchy reads in one look | one thing is clearly first; headings, body and meta are told apart by size and weight, not by colour alone | NN/g heuristic 8, Aesthetic and Minimalist Design |
| Not a wall of identical cards | border, fill, radius and shadow mark what is a separate object; they are not on every block | Anthropic's frontend-design skill: "content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy" |
| An empty state says what goes here and how to start | a headline, a line, one action | The kit's `createEmptyState`; NN/g heuristic 10 |
| The same thing looks the same in every tool | a list row, a filter chip, a section label, a toolbar: one form across tools | NN/g heuristic 4 |
| Line length is comfortable | under about 80 characters for running text | Anthropic's frontend-design skill |
| Destructive actions are marked and confirmed, or can be undone | danger style, a confirm or an Undo | Vercel guidelines; NN/g heuristic 3 |
| State is visible | what is selected, loading, saved, failed | NN/g heuristic 1 |

## Where the sources differ, and what the app does

- **Target size.** WCAG asks 24 px; Windows asks 40 px for touch; macOS defaults to 28 pt. The app holds 24 px as the floor everywhere and its control heights (22 to 32 px) rely on WCAG's spacing exception for the smallest.
- **Contrast.** Vercel prefers APCA; W3C, Microsoft and Apple say 4.5:1. The app uses 4.5:1 (it is what the audit measures).
- **Screenshots or structure.** Playwright's own guidance prefers the accessibility tree (cheap, exact); Anthropic's harness uses screenshots (they catch what only shows). Both are used: numbers from the page, judgment from the picture.

## Not read

Material 3's structure pages (scripted, title only); NN/g on AI heuristic evaluation (404); OpenAI's harness-engineering post (403). Several pages were read through a summarising fetch: recheck exact wording before quoting.
