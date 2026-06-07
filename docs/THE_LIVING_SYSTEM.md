# The Living System — Founding Systems Design

**Branch:** `living-system` · **Status:** design (no implementation yet) · **Date:** 2026-06-07

> This is the system model the autonomy work must trace to. It is deliberately
> not a manifesto and not code. It is the stock-flow / feedback / Viable-System
> analysis that earlier hype skipped — and which, when applied, *revises* the
> vision. Read it before proposing any feature; check every proposal against
> §7 (Invariants) and §8 (Leverage).

---

## 0. The central reframe: nested viable systems

The mistake is to model "the autonomy agent" as a thing inside "the Parallx app."
Beer's **Viable System Model** is recursive: every viable system is composed of
viable systems and is itself a subsystem of a larger one, each needing the same
five functions (S1 operations · S2 coordination · S3 regulation · S4 intelligence ·
S5 policy/identity). So we design **one model at five nested levels**:

```
  L4  AI landscape            centralized superintelligence  ⟷  distributed sovereign intelligence
   └ L3  The Commons          a federation of dyads (peer, private, governed)
      └ L2  The Dyad          one human + their Parallx, as one cognitive system
         └ L1  Parallx        the workbench as a (currently incomplete) viable system
            └ L0  The Loop    the heartbeat cognition: perceive → predict → act → learn
```

The thesis in one line: **the "living system" is Parallx acquiring the S4
(intelligence) and S5 (identity) it currently lacks — and the human supplying
the requisite variety it can never have alone.** Everything below is that claim,
made rigorous.

---

## 1. Parallx as a system (L1) — what actually exists today

**Purpose (de facto, read from behaviour):** a local-first place to write, store,
and query an AI over your work. Powerful, but *passive* — it acts only when asked.

**Purpose (intended):** to measurably increase what one person can know, make, and
do — *while increasing their own capability and sovereignty* (the dual objective;
see §3, it is the source of the central tension).

**Boundary (a choice, and the political one):** today Parallx draws its edge at
"the workbench." The living-system design *pushes the boundary outward* (perceive
and act across the user's whole work-life) and *upward* (federate). Per Critical
Systems Heuristics the load-bearing decision is: the **beneficiary and the
decision-maker are the individual** — not the developer, not a cloud. That is
what "sovereign" means structurally, and it is the one boundary we never cross.

**Elements (the real subsystems, and which VSM role each already plays):**

| Parallx subsystem | today's VSM role |
|---|---|
| Canvas (pages in SQLite), files, Planner | **S1** — operations / the body of work |
| Chat + the openclaw turn runtime + tools | **S1** effectors (acts only on request) |
| Surface Router (`SurfaceRouterService`) | the nervous system / output bus |
| Signal bus (`AutonomySignalService`, `api.autonomy.signal`) | proto-**afferent** nerves (perception intake) |
| File watcher · indexing pipeline · semantic graph · vector store | proto-**perception + world-model** (latent, unintegrated) |
| `DiagnosticsService` (background checks) | proto-**interoception** (sense of its own health) |
| Memory service · `MEMORY.md` · SQLite | proto-**long-term memory** |
| Heartbeat runner/executor/context | proto-**S3 regulation** (a bare tick) + the seed of **S4** |
| Settings registry · DI container · command system | the wiring / connective tissue |

**The diagnosis.** Parallx is a strong **S1** with rich latent organs, but the
human is currently its entire **S3 + S4 + S5** — the user does all the regulating,
sensing-of-the-whole, and goal-setting. The autonomy runtime is a thin S3 tick
with no real S4 and no S5. *The organs of intelligence already exist, scattered
and disconnected.* This is the highest-leverage fact in the document:

> **We are not building senses, memory, or a world model from scratch. They exist
> (indexing, semantic graph, diagnostics, memory service). The work is to
> *integrate latent organs into a loop* and add the two missing functions: S4
> (a model that predicts) and S5 (an identity that aligns).**

---

## 2. The autonomy runtime as Parallx's S4/S5 (L1 → the build target)

Mapping VSM onto what we must complete:

- **S1 Operations** — the tool/command system + surface router. *Exists.* The agent's hands.
- **S2 Coordination** — *missing, and non-obvious.* Two controllers act on one
  workspace: the human (direct edits) and the agent. Without coordination they
  oscillate and fight (the agent "tidies" what you're mid-editing). S2 is the
  anti-oscillation layer: shared attention, locks/deference, "don't touch what
  the human is touching." (The `.parallx` self-trigger I found is an S2/S3 failure.)
- **S3 Regulation / homeostasis** — the heartbeat loop + resource/attention
  budgets + the **governors** on every loop. *Exists only as a bare tick.* This is
  the "here-and-now" controller keeping the system stable and within budget.
- **S4 Intelligence** — *the big gap.* The persistent **world model** + **prediction**
  (active inference) + environment scanning. The "outside-and-future" organ.
  Today: absent (ephemeral, amnesiac turns; a stale snapshot). This is the mind.
- **S5 Policy / identity** — *absent beyond a kill switch.* The agent's alignment
  to *this* human, the invariant set (§7), the sense of "who I am and whom I serve."

**Build order falls directly out of VSM:** a system missing S4 and S5 is not
viable — it is a reflex. So: **S5 first** (identity + invariants — cheap, and it
constrains everything after), **then S4** (the persistent model + loop — the
mind), wiring the already-present latent senses (§1) and the existing S1 tools
into it, with **S2/S3 governors** built *alongside*, never after.

---

## 3. Dynamics — the causal-loop model (the heart)

**Master stocks** (accumulations that determine behaviour over time):
1. **Model fidelity** — how well S4 models *this* user/work.
2. **Trust / granted-autonomy** — how much rope the human has given.
3. **Human capability** — the user's *own* competence (the stock that must grow).
4. **Continuity** — persistent memory of self/threads (today ≈ 0; purged each tick).
5. **Workspace coherence** — order/health of the actual work (canvas, files, tasks).

**R1 — the trust flywheel (the engine):**
`fidelity↑ → usefulness↑ → trust↑ → autonomy + feedback↑ → fidelity↑`. Fragile:
break any link and it spins down. *Continuity is the hidden multiplier* — without
it, fidelity can't compound, so the flywheel never spins. Hence S4 + continuity first.

**The loops that kill it — each needs a designed governor (a balancing loop):**

- **R-runaway (self-trigger):** agent activity → events → more activity. *Observed
  literally* (heartbeat waking on its own `.parallx` writes). **Governor:** the
  agent's own effects are excluded from its perception; single-flight; rate limits.
- **Nag-spiral:** proactivity without restraint → annoyance → distrust → disabled →
  blind → worse. **Governor:** an attention/interruption budget tied to the trust
  stock; silence is the default (NOOP).
- **R2 — deskilling (Shifting the Burden — *existential*):** agent does more →
  human does less → human capability↓ → reliance↑ → agent does more. This archetype
  **destroys purpose #2 and the whole mission**: "extended mind" becomes "replaced
  mind." **Governor:** optimise the *human-capability* stock, not output — *teach,
  don't just do*; surface reasoning; hand back the controls. Measured (§9), or it
  wins silently.
- **Value-drift:** self-modification + learning with no anchor → goals drift from
  the human's. **Governor:** S5 invariants + co-authored, inspectable goals + the
  human as the value oracle.
- **Complexity-collapse (L1 archetype):** more senses/skills → more noise/bloat →
  the workbench becomes unusable. **Governor:** attenuate to *salient* subsets (§6).
- **Human-agent oscillation (S2):** see §2. **Governor:** deference to live human action.

**Delays cause instability.** The stale-diagnostics finding generalises:
perception, action, and learning each lag. A control loop with delay overshoots
and oscillates. Therefore loops must run at a rate matched to what they track, and
*different stocks need different clocks* — see §4.

---

## 4. L0 — the cognitive loop: active inference across nested time

S4's engine is the principle living cognition actually runs on (Friston): **hold a
generative model of the world; predict; act to minimise surprise (prediction
error); update the model on surprise.** Mapped:

- **World model** = a generative model of *you* (next actions, needs, struggles),
  *your projects*, and *open threads* — persistent, agent-curated, human-inspectable.
- **Attention** = prediction error. Salience is *surprise*, not "a file changed."
- **Proactivity** = acting to reduce *expected future* surprise — i.e. removing
  friction before it lands. The "it knew" effect, derived rather than guessed.
- **Learning** = model update when surprised. Every Do-it/Dismiss is a gradient.

**Recursion in time** (the dimension everyone omits): nested loops, each a viable
S3/S4 at its timescale — reflex (seconds: react to an edit), reflection (daily:
review), planning (weekly: advance goals), arc (months/years: who you're becoming).
A loop that lives only in minutes can never be a life companion.

---

## 5. The outer recursion (L2–L4) — designed, not deferred

- **L2 The Dyad (human + Parallx).** The unit of intelligence is the *coupled
  pair*, not either alone (extended-mind thesis). Boundary pushes out: perception
  and action span the user's whole work-life (with consent, locally). The human is
  inside the system, as its S-anything-it-lacks (see §6).
- **L3 The Commons.** Sovereign dyads federate peer-to-peer, encrypted, no center:
  agents negotiate for their humans and trade self-built skills *without raw data
  leaving a machine*. This is S2 (coordination) at the inter-dyad level — and it is
  the move the centralized labs structurally cannot make. **Risk: Tragedy of the
  Commons** — a shared skill-space is polluted/free-ridden without a center.
  Requires *decentralized reputation/governance before any sharing* (§7.7). Not
  built until governed.
- **L4 The AI landscape.** The paradigm (Meadows leverage #2): centralized,
  extractive superintelligence *vs* distributed, sovereign, amplifying intelligence.
  Parallx is a stake for the second future — the PC against the mainframe. This is
  the *why*, and it is the argument that converts AI skeptics: AI that gives power
  *to* people, not *over* them.

---

## 6. Requisite variety (Ashby) — why the human is *inside* the system

Ashby's Law: a regulator needs variety ≥ the disturbance it regulates. A human
work-life's variety is effectively unbounded; S4's model **cannot** match it.
Therefore **full autonomy is impossible in principle** — not hard, impossible.
Two consequences, both structural design mandates, not preferences:

1. **Attenuate** the environment's variety: the agent must focus on *salient*
   subsets (surprise-ranked), never try to model everything. (Also the
   complexity-collapse governor.)
2. **Amplify** the agent's variety: self-built tools, the federation's shared
   skills, and — above all — **the human in the loop as the variety source.**

So "keep the human in the loop" is not UX courtesy; it is the cybernetic law that
makes the system viable *and* the thing that keeps purpose #2 (capability) alive.
This is the rigorous death of "replace the human"; the design is *couple and steer*.

---

## 7. The Invariants (S5 — the constitution, holds at every level)

Every design decision is checked against these. They are the policy that makes a
*local, autonomous* system safe enough to actually run with real power.

1. **Sovereignty** — beneficiary and decision-maker is the individual; data never
   leaves the machine without explicit, revocable consent. (The boundary, §1.)
2. **Human-in-the-loop as variety source** — no fully-headless replacement of human judgement (§6).
3. **Optimise the human-capability stock** — teach, don't just do; the metric is the
   *human getting stronger* (§3 R2, §9).
4. **Every loop has a governor** — no reinforcing loop ships without its balancing
   loop (self-trigger, nag, drift, oscillation).
5. **Trust is the binding constraint** — autonomy is earned and graduated; every
   action legible, explainable, and reversible. Receipts for everything.
6. **Matched clocks** — each loop runs at the rate of what it tracks; nested
   timescales; no stale "now."
7. **Governed commons** — no federation/skill-sharing without decentralized
   reputation + the sovereignty invariant intact.
8. **Co-authored, inspectable goals** — the objective function is set *with* the
   human and visible/editable, or "optimise your flourishing" becomes manipulation.

---

## 8. Leverage-ranked roadmap (Meadows — work the top, never the bottom)

The in-app agent's instinct — "tune the heartbeat interval" — is leverage point
**#12 (a parameter): the weakest possible intervention.** We work the top of the lever:

1. **#2 Paradigm** — commit to sovereign/distributed (the frame, already chosen).
2. **#3 Goals** — set the system goal to *capability + sovereignty*, not output
   (this is where most leverage *and* most danger live: wrong goal = efficient harm).
3. **#4 Self-organization** — the agent builds its own tools/skills; the federation
   evolves them. Highest capability leverage; pair with §7.4 governors.
4. **#5 Rules** — the Invariants (§7).
5. **#6 Information flows** — *close the loop* (wire the latent senses → world model
   → deliberation → action → memory) and make the model **visible + editable** to
   the human (the "mind panel"). Cheapest high-leverage move; do it first.

**Build sequence (each step green + verified before the next):**
1. **Close the loop with continuity** — replace the amnesiac ephemeral tick with a
   persistent agent state (a `MIND` world-model the loop reads and rewrites), wiring
   the already-present senses (diagnostics ✓ done; indexing; semantic graph; signal
   bus ✓ done). Turns the reflex into S4.
2. **S5 + governors** — identity/invariants, the trust ledger (earned autonomy),
   the loop governors (§3). Makes it safe.
3. **Active inference** — predict → surprise → act → learn (§4). Makes it *alive*.
4. **The mind panel** — visible/editable model + reasoning (#6). Makes it *trusted*.
5. **Self-construction** — agent writes its own tools (the Live AI widget is the seed).
6. **Federation** — only after §7.7 governance. Makes it a *commons*.

---

## 9. How we'll know it's working (measurement — usually skipped, decisive here)

Define a meter per master stock; instrument from day one (the live e2e harness on
this branch already lets us observe the system from the user's seat):

- **Model fidelity** — prediction hit-rate: of what S4 predicted you'd need, how
  much you actually used. (Active inference gives this for free.)
- **Trust** — granted-autonomy level over time; intervention/undo rate trending down.
- **Human capability (the one that matters)** — is the human doing *harder* things,
  *faster*, and *learning*? If usefulness rises while capability falls, R2
  (deskilling) is winning and the design has failed its purpose, regardless of how
  "alive" it feels. This meter is the conscience of the project.
- **Continuity** — does the agent correctly recall and build on its own prior threads?
- **Workspace coherence** — order/health of the actual work over time.

---

## 10. The first build (the proof of the whole thesis)

One experiment validates the model: **close the loop with continuity + prediction.**
Each cycle the persistent agent writes *what it expects you to do next*; next cycle
it checks itself; **the gap is its agenda**, and it remembers what it learned. The
morning it greets you with *"you usually start X about now — I staged it; I was
wrong about Y yesterday, here's what I changed,"* the reflex has become S4, and
every other organ (panel, self-construction, federation) has something to attach to.

Verification: drive it through the e2e harness from the user's seat (as we now
can), and watch the §9 meters — especially human-capability.

---

*Engine: active inference + continuity. Body: self-construction + earned autonomy
(S1–S3). Mind: the persistent world model (S4). Conscience: the Invariants (S5).
World: the governed Commons. All recursive; all sovereign; the human always inside.*
