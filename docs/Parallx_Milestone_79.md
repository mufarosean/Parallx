# Milestone 79 — Text Generator: RP Engine Hardening

> **Status:** Planning + execution underway.

## Why

The text-generator extension ships a clean openclaw clone: character card +
lore (triggered) + memory + history (trimmed) + user message, all delivered
as plain-text injection. It works well for short scenes but produces three
recurring frustrations on long sessions:

1. **Character drift** — the model loses the character's voice as the
   original card moves further from the recency horizon.
2. **Lore misfires** — keyword matching is binary; the wrong entry
   surfaces in the wrong scene, or the right one doesn't surface.
3. **Loss of long-term coherence** — important early moments slip out
   of context when history is trimmed; the model forgets who said what,
   what happened, who's where.

M79 is the system milestone. It does *not* add new UI screens. It changes
what goes into the model, what comes out, and what persists between turns,
so every generation is smarter without the user having to do anything.

## The three tensions M79 negotiates

1. **Recency vs. importance.** Recent messages dominate the model's
   attention. Important moments are usually old. Today's pipeline only
   weights by recency.
2. **Specificity vs. flexibility.** A tight character card produces
   consistent voice but reads rigid. A loose card improvises but drifts.
   Today the card is one blob — no way to mark what's rigid vs. fluid.
3. **Player agency vs. character consistency.** The user wants to steer;
   the character has their own personality. The friction surface is
   today either heavy-handed (system messages) or invisible (no API).

Every M79 phase addresses one of these.

## Out of scope

- New UI surfaces (e.g. a "lorebook scope" editor — the format becomes
  smarter, the editor remains the same `.md` file).
- File-storage refactor for chats (still JSONL + `thread.json`).
- Token-counting via Ollama's `/api/tokenize`. Tempting but adds an
  HTTP call per turn; deferred until we measure that the estimation
  error actually matters in practice.

## UX contract for M79

> **The user must not be able to tell something changed except that
> their characters are more consistent, lore lands where it should,
> and the AI doesn't forget.** No new modes the user has to learn.
> Auto-extract and auto-derive run silently. The user can always
> inspect what the system did via the existing prompt inspector.

## Phases

### Phase 1 — Memory architecture (episodic + semantic split)

The biggest single change. Today: one `memories.md` file the user can
edit, plus a `cachedSummary` field that gets refilled when history is
trimmed via `summarizeOld`.

After Phase 1:
- **`memory.semantic.jsonl`** — durable facts. One JSON entry per fact,
  each with: `id`, `text`, `category` (relationship | trait | event |
  place | preference | other), `confidence`, `createdAt`, `source`
  (auto | user). Always-on injection, sorted by category then recency,
  capped at a small budget.
- **`memory.episodic.jsonl`** — narrative beats. One JSON entry per
  beat, each with: `id`, `summary`, `importance` (0–1), `messageRange`,
  `createdAt`. Pulled by `recency × importance` up to a budget.
- **Auto-extract.** After every N user-to-AI exchanges (default: 10)
  the system runs a background LLM call that reads the most recent
  chunk and emits structured JSON (facts + beats + importance). Results
  are merged into both files. The call is fire-and-forget; it never
  blocks the user.
- **User promotion.** Any message gets a "Remember this" action that
  promotes it directly into semantic memory with `source: user` and
  `confidence: 1.0`. (Phase 5 UI item.)
- **Inspection.** The system prompt inspector shows what was pulled
  this turn, so the user can debug.

The old `memories.md` continues to work — its content is read alongside
the new files and treated as additional semantic content. Existing users
see no breaking change.

**UX impact:** zero new surfaces. The model remembers more.

### Phase 2 — Lorebook v2 (scope + priority + anti-triggers + recency)

Today's lorebook format:

```
[trigger1, trigger2, keyword3]
Content shown when any trigger appears in recent chat.
```

After Phase 2:

```
[trigger1, trigger2]
scope: always | triggered | scene:cafe | character:ada
priority: 1 (low) to 10 (high)
anti: flashback, dream
---
Content for this entry.
```

- `scope: triggered` (default) — current behavior.
- `scope: always` — top of every generation, capped.
- `scope: scene:X` — only when scene state's location/mood/tag matches.
- `scope: character:X` — only when that character is in the cast.
- `priority` — when budget is tight, low-priority entries drop first.
- `anti: ...` — keywords that *suppress* the entry even if a trigger
  fires. "Don't surface Bob/Alice relationship during a flashback."
- Recency decay — an entry that fired three turns ago gets a more
  compressed re-injection than its first appearance.

The simple syntax `[triggers]\nbody\n\n` still works. Power users
opt into the metadata block. Editors don't have to change.

**UX impact:** zero. Lore that should fire fires; lore that shouldn't doesn't.

### Phase 3 — Three small per-turn improvements

Three independent additions, each ~50–100 tokens of system-prompt cost.

**3a. Scene state (auto-derived).** A small structured channel stored
on the thread: `location`, `time`, `present` (character names),
`mood`. The AI emits a hidden update block at the end of each response
(`<scene-update location="cafe" time="evening" mood="tense"/>`).
The block is parsed and stripped before display; the resulting state
is injected at the top of every system prompt. If the AI doesn't emit
one, state carries over from the prior turn. Users can edit the scene
state via a small panel in the chat header (Phase 5).

**3b. Character anchor.** Today the persona re-anchor uses a 220-char
slice of the character's description first line. Replace with an
authored "voice anchor" field on the character (3–5 lines: voice,
syntax, signature phrases, no-go phrases). Auto-generated from the
character card on save (one-shot LLM call), editable. Injected
separately from the full card so it stays in high-attention territory
even when history is long.

**3c. Variation avoidance v2.** Today: extract openings from the last
2 AI outputs by the same speaker, ask the model to avoid them. Extend
to: extract n-grams (3–5 word phrases) from the last 5 outputs,
identify the ones that repeat across messages, inject as an explicit
avoid list. Costs ~50 tokens; measurably reduces "her eyes glittered"
syndrome.

**UX impact:** zero. Prose stays fresh, character stays consistent,
scene stays coherent.

### Phase 4 — OOC channel + branching tree

**4a. OOC mode.** A first-class input toggle: when active, the user's
message is recorded with `hiddenFrom: 'ai'` and styled visibly
differently in the chat (a "Backstage" label, muted tone). The AI
never sees it. Users can promote an OOC message to in-character with
one click if they change their mind.

**4b. Branching tree (scoped).** Each AI message can become a fork
point. Forking creates a new branch from that message; the original
branch and the new one both persist. The chat view shows the active
branch; a small UI surface (sidebar) lists branches with their
divergence points. This is the largest single feature in M79 — if
scope blows out, ship 4a + a "fork from message" command without
the tree visualization, and finish the tree in a follow-up.

**UX impact:** opt-in. OOC is a small visible toggle. Branching adds
a fork affordance per AI message and a branch list.

### Bonus — instruction-following fix (the `/ai` directive bug)

The `/ai <instruction>` mechanism let users guide the AI's next turn:

```
The user steps inside the room.
/ai have the character notice the smell of smoke
```

Reported behaviour: the AI was ignoring the directive completely.

Root cause: the directive lived in a consolidated late-stage *system*
message that landed BEFORE the actual user-message. The user-message
tokens then dominated the model's attention right before generation,
and the directive — though present — was crowded out.

Fix:
1. Strengthen the system-side wording ("DIRECTOR'S NOTE FOR THIS TURN
   (mandatory — override defaults if needed)") and keep it last in the
   consolidated system message (closest to the user turn).
2. **Also** append the directive as a bracketed stage direction at the
   END of the user-message text itself. This makes it the literal last
   text the model reads before generating — the strongest position for
   per-turn guidance.

The fallback path (when there is no user-message text, e.g. shortcut
button or `/ai` with no body) gets the same emphatic phrasing inline.

### Phase 5 — Polish layer

The UX items from the prior text-generator audit that ride along on
the same surfaces:

- Chat search uses `.includes()` instead of regex (escape bug today).
- `newChat` command shows a helpful "Create a character first" modal
  instead of an error if no characters exist.
- Lorebook picker gets a filter input.
- Auto-title updates on first AI response too, not just first user
  message.
- Silent `.catch(() => {})` save failures show a toast.
- Empty-thread `[Active turn: X]` warning surfaces cleanly.
- "Remember this" message action (Phase 1's user-promotion path).
- Scene state edit panel in chat header (Phase 3a).

## Success criteria

- Long chats (200+ messages) keep character voice better than baseline
  in side-by-side eval.
- Lore entries fire in the right scenes; users can encode complex
  conditions without editor changes.
- Important early events still surface 100+ messages later via
  episodic memory.
- No new UX surfaces require the user to learn anything to get the
  benefits.
- Existing chats continue to load and render correctly — no migration
  trauma.
