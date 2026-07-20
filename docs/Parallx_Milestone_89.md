# Milestone 89 — Personality (Craft → Voice → Presence → Celebration)

**Status: APPROVED 2026-07-20 — S1 in progress on branch `m89-personality`.**
Checkpoint: `master` @ fa00ed10 (rollback point; nothing merges until Mufaro
has felt it in the app).

**Direction (agreed 2026-07-20, from the design-personality research):**
craft first, voice second, presence third, celebration rare. Parallx is a
study tool lived in for hours — Linear-school earned personality, not
mascot-school whimsy.

## Research grounding (see session sources)

- Linear: personality through invisible craft — optimistic UI, safe-triangle
  menus, opacity hierarchy (actionable = full color, informational = 40–60%).
- Slack/Duolingo: empty states and waits are the app's speaking moments;
  microcopy names what's happening and what to do next.
- Motion research: hovers/presses 120–180ms, state changes 180–260ms, big
  transitions ≤300ms, ONE easing family everywhere; springs for
  gesture-driven motion only.
- Notion AI-handoff swirl: presence cues for AI acting on your behalf.

## Slices

### S1 — Motion adoption sweep (craft)
The vocabulary ALREADY EXISTS in `px-tokens.css` (M83): `--px-dur-instant/
fast/base/slow` (70/120/180/260ms), `--px-ease`, `--px-ease-out`,
`--px-ease-spring`, `--px-press`. Adoption is the gap: 227 raw `transition:`
declarations across built-in CSS improvise ~30 timing combos vs 37 tokenized.
- Mechanical sweep: raw durations map to bands (≤130ms→fast, 131–220ms→base,
  >220ms→slow; ≤80ms→instant), `ease`/`ease-out`/`ease-in-out`→`--px-ease`,
  explicit enter animations→`--px-ease-out`. `linear`, `steps()`, `none` and
  progress/spinner animations are exempt.
- Enforcement: a lint test (`motionTokenCompliance.test.ts`) fails when a
  new raw duration/easing enters a `transition:` in built-in CSS outside the
  exemption list — the same canary pattern as chatGateCompliance.
- Extensions (`ext/*/main.js` CSS) follow in a later pass via the same
  mapping once the built-in sweep has been felt and approved.

### S2 — Empty-state voice (voice)
One registry module (`src/ui/emptyStates.ts`) holding every empty-state
line: {icon, headline, hint, action?}. Surfaces: new canvas page, empty
planner day, empty review queue, empty graph, zero search results, empty
autonomy log, fresh workspace welcome. Tone: warm, brief, always names the
next action ("No tasks today — press C to capture one"). Greppable,
consistent, testable (registry shape + no orphan surfaces).

### S3 — Presence cues (presence)
- AI-handoff shimmer on canvas blocks the assistant is writing into
  (Notion-school; CSS class toggled by the existing AI-edit pipeline).
- Heartbeat status heart pulses once when the deterministic lane files a
  finding ("watchers: 1 filed" gets a visual moment).
- Optimistic-UI audit of the three highest-traffic actions (task check-off,
  page create, tab switch) — act instantly, reconcile after.

### S4 — Celebration (rare, earned)
Last task of the day completed / review queue emptied → ONE brief
confetti-class moment (CSS-only, ≤600ms, respects reduced-motion). Rare by
construction: keyed to day-level events, cooldown-guarded like heartbeat
findings.

## Rules
- No hardcoded colors/durations — tokens only (M83 rule extended to motion).
- `prefers-reduced-motion` honored globally: all decorative motion collapses
  to instant.
- No always-running animations (perf rule; rafThrottle discipline stands).
- Every slice ships with its enforcement/lint test in the same commit.
