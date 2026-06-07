# The Living System — Founding Systems Design (v2)

**Branch:** `living-system` · **Status:** design (no implementation) · **Date:** 2026-06-07

> v2 follows a three-agent red-team of v1 (ground-truth codebase audit · a
> cybernetics critic + pre-mortem · a prior-art scan). It cut three pillars that
> were *labels wearing equations* and added the loops most likely to kill the
> project. **The discipline of this doc:** anything not yet a *falsifiable
> mechanism with a named sensor* is marked **[HYPOTHESIS]**, not "design." Every
> invariant must name the sensor that detects its violation — *from outside the
> loop it governs* — or it isn't an invariant, it's a slogan.

---

## 0. The reframe: nested viable systems — and who is which

Beer's Viable System Model is recursive: every viable system is built from viable
systems and nested in a larger one, each needing S1 operations · S2 coordination ·
S3 regulation · S4 intelligence · S5 policy/identity. We design **one model at
four nested levels** (v1 had five — *the AI landscape is not a viable system; it
has no boundary, operations, or identity. It is the motivation, §9, not a level.*):

```
  L3  The Commons   a federation of dyads — peer, private, governed
   └ L2  The Dyad   one human + their Parallx, as one cognitive system
      └ L1  Parallx the workbench as a viable system
         └ L0  The Loop  the cognitive cycle
```

**The correction v1 got wrong (and it changes the build order):** v1 called the
agent "Parallx's S4/S5." That contradicts the Ashby argument in §6 — by requisite
variety the agent *cannot* be the apex intelligence/identity. The honest mapping:

- **L2 (the dyad): the *human* is S5 (identity/policy) and the apex of S4 (where
  the future and meaning are judged).** This is structural, not deferential.
- **L1 (Parallx): the agent is S3 (the here-and-now homeostat that keeps the
  system stable and in-budget) plus a *bounded* S4 (environment scanning +
  prediction) operating *under* the human's S5.**
- What v1 called "the agent's S5" is really the **constraint + algedonic channel**:
  the human's policy injected downward as hard limits, plus the pain/pleasure
  signal (do-it / dismiss / alarm) flowing up. The agent doesn't *have* an identity;
  it *carries* the human's.

So the thesis, corrected: **the living system is Parallx growing a real S3 homeostat
and a bounded S4 predictor under the human's sovereign S5 — with the human
supplying the variety neither can.** Build order falls out as **S3 + bounded-S4
under human policy**, not "build the agent's identity first."

---

## 1. Parallx as a system (L1) — verified against the code

**Purpose (de facto):** a passive, local-first place to write/store/query AI. It
acts only when asked. **Intended:** measurably increase what one person can know,
make, and do — *while increasing their own capability and sovereignty* (the dual
objective; the source of the central tension, §3 R2).

**Boundary (the political choice):** beneficiary and decision-maker is the
**individual** (Critical Systems Heuristics) — never the developer, never a cloud.
v1 assumed the agent may *expand* its perception across the user's work-life;
correction: **perception scope is a graduated, consented stock, exactly like
autonomy** (pre-mortem #4: "nobody wants a watcher").

**The organs already exist — verified.** The ground-truth audit confirmed these are
real and largely usable:

| Organ | reality (file) | verdict |
|---|---|---|
| Indexing (pages+files, extraction, incremental) | `indexingPipeline.ts` | **ready** |
| Semantic graph (similarity/reference/co-occurrence edges, concepts, in SQLite) | `semanticGraphService.ts` | **ready** |
| Hybrid retrieval (vector + FTS, RRF, centroids) | `vectorStoreService.ts`, `retrievalService.ts` | **ready** |
| Output bus (origin-tagged, loop-break, logged) | `surfaceRouterService.ts` | **ready** |
| Signal bus (extension perception) | `autonomySignalService.ts` | partial |
| Diagnostics (interoception) | `diagnosticsService.ts` | thin |
| Memory (decay-ranked recall, agent-writable MEMORY.md) | `memoryService.ts`, `workspaceMemoryService.ts` | needs-work |
| Heartbeat loop (timer + events, governors) | `openclawHeartbeat*.ts` | needs-work |

**The diagnosis stands, sharpened:** Parallx is a strong **S1** (the body of work)
where the human is currently *all* of S3/S4/S5. The integration thesis is **~65%
true** — but three things are **missing pieces, not wiring** (§2). So "close the
loop by integration" gets you ~65% of a *reflex*; the gaps are what make it S4.

---

## 2. The three hard gaps (the real work — confirmed by the audit)

1. **Persistent agent-owned world model — "MIND" (CRITICAL).** Today there is *no*
   agent-curated predictive model. `MEMORY.md` holds facts/lessons *for the human*;
   it is not the agent's internal `P(you)` — "you usually work 9–5 on design;
   current project blocked on stakeholder feedback; you'll likely open X next."
   Without it, fidelity can't compound and the flywheel never spins. **This is the
   keystone.** Lineage: it is the *declarative memory* of ACT-R and the persistent
   self of Generative Agents / MemGPT — adopt those mechanics, do not reinvent.
2. **Turn-to-turn agent state — continuity (HIGH).** Every heartbeat turn is born,
   runs on an ephemeral session, and is purged. The agent cannot carry a
   hypothesis ("I think X; testing next tick") or a correction ("I was wrong about
   Y") across ticks. Today continuity ≈ 0. Need a machine-only agent-state store
   (a `heartbeat_turn_state` table or a non-user-facing `AGENT_STATE`), distinct
   from MEMORY.
3. **Unified, salience-ranked perception stream (MEDIUM-HIGH).** Senses are siloed
   (signals, diagnostics, file-watch, index events, canvas mutations each separate).
   Need one normalizer → a single **competition for a scarce "attention" slot per
   cycle** (LIDA's global-workspace gate — this *is* the §6 attenuator, and the
   anti-bloat/anti-nag mechanism).

These three are the build, not the heartbeat tick we already have.

---

## 3. Dynamics — the causal-loop model (now with the loops that kill it)

**Master stocks:** model-fidelity · trust/granted-autonomy · **human-capability** ·
continuity · workspace-coherence · **compute-headroom** (new) · **perception-scope**
(new).

**R1 — the trust flywheel (engine):** fidelity↑ → usefulness↑ → trust↑ → autonomy +
feedback↑ → fidelity↑. *Continuity is the hidden multiplier* — without it fidelity
can't compound, so the flywheel can't spin. Hence the MIND + continuity gaps first.

**Governors — and v2's rule: each names a sensor OUTSIDE the loop it governs**
(v1's were autodependent — sensed by the faculty that was failing):

| Pathology loop | governor | **independent sensor** (the v2 fix) |
|---|---|---|
| **Self-trigger** (agent's acts → events → more acts; *observed live* on `.parallx`) | exclude own effects from perception; single-flight; rate-limit | the action ledger (§ below) excludes own-origin events structurally |
| **Nag-spiral** (proactivity → annoyance → distrust → disabled → blind) | interruption budget shrinks as dismissals rise | **dismiss-ratio measured by the event bus**, no LLM in the loop |
| **Deskilling / Shifting-the-Burden** (*existential* — kills purpose #2) | optimise human-capability; *teach don't do* | **held-out skills probe** (a task the agent refuses to help on, timed over months) + **assistance-fade ratio** from the ledger |
| **Value-drift** (self-edits → goals drift from human) | human is value oracle | a **reserved, agent-*blind* check-in channel** the agent cannot attenuate (VSM algedonic) |
| **Compute/thermal** (NEW — *the #1 abandonment cause*) | idle must be *free* | a **cheap non-LLM gate** decides whether to even wake the model; loop activity governed by measured **compute-headroom** |
| **Memory bloat** (NEW — continuity treated as monotonically good) | forgetting/compaction is first-class | governed-memory layer: decay + provenance + explicit forgetting outflow |
| **Asymmetric trust** (NEW — one bad act zeroes trust) | probation state | **fast outflow / slow capped inflow**; irreversible/external actions gated by class regardless of trust level |
| **Human-agent oscillation** (S2) | human-priority reversible merge (§4) | live-edit detection in the event bus |

**Delays cause instability** (the stale-diagnostics finding generalizes): each loop
runs at the rate of what it tracks; nested clocks; no stale "now."

---

## 4. L0 — the cognitive cycle (honest about what it is)

**[MECHANISM]** The engine is, plainly, the **Generative-Agents cycle**: a
memory-stream + retrieval (recency·importance·relevance) + periodic **reflection** +
planning — proven to produce "it remembered / it knew" behavior. Parallx's loop is
a near-isomorph; adopt it directly.

**[HYPOTHESIS — labeled, not claimed] "active inference."** The *analogy* is apt
(predict → act to reduce future surprise → learn on error) and a file/LLM
realization has been prototyped externally. But an LLM asked "were you surprised?"
emits a *narrative* of surprise, not a calibrated free-energy quantity. v1's §10
("write a note, compare, the gap is the agenda") is **an LLM grading its own
homework** — sycophantic, miscalibrated, and the single most dangerous failure mode
(pre-mortem #3): a *confabulated dashboard that feels alive and learns nothing.*

**The fix — make exactly one prediction real, demote the rest to analogy:**
- Pick a **narrow, countable, externally-grounded** prediction: *the next file the
  user opens* / *the next N commands invoked*.
- Store it as a ranked list with explicit probabilities.
- **Score it against what actually happened — observed by the event bus, not the
  LLM** — with Brier / log-loss. That is a real, falsifiable, calibratable error
  signal, buildable on the existing bus.
- Surprise (that error) becomes the **impasse** (SOAR) that justifies spending an
  LLM deliberation. Everything else stays *analogy in the prose* until there is a
  real probabilistic model.

**Reflection must be grounded** (Reflexion + memory-governance research): every MIND
update **cites the episodic receipt** that justifies it — which also discharges
Invariant 5 (receipts) and is the antidote to memory drift (the documented failure
of self-summarizing memory).

**Nested timescales:** reflex (seconds) · reflection (daily) · planning (weekly) ·
arc (months) — each its own S3/S4 at its clock.

---

## 5. S2 and S3* — the two organs v1 hand-waved

**S2 — coordination (the part most likely to make it hateful day-one).** Two
controllers act on one workspace (human + agent). v1 said "locks / deference" —
a slogan. **The dissolve:** model it as **human-priority reversible merge**, not
locking. The agent only ever writes **reversible proposals against a snapshot;
the human's direct edits are authoritative commits, never blocked.** On conflict
(agent acted on a stale snapshot — the §3 delay problem), the agent's diff is
auto-rebased or discarded and re-proposed. (Local-first/CRDT thinking — Ink &
Switch / Automerge — is the right substrate; don't invent sync.) This makes S2 a
restatement of Invariant 5 (reversible + receipts), so it falls out for free.

**S3\* — the audit channel (absent in v1, and the only real defense against
confabulation).** A **tamper-evident, append-only action ledger** of *actual tool
calls and diffs* — separate from the agent's self-described "what I did." The human
(or a watchdog) audits ground truth, not narration. This is the sensor that
backstops several governors above and the §6 confabulation risk.

---

## 6. Requisite variety (Ashby) — why the human is *inside* the system

A regulator needs variety ≥ the disturbance. A human work-life's variety is
effectively unbounded; the agent's model cannot match it → **full autonomy is
impossible in principle.** Two structural mandates: **attenuate** (focus on the
scarce-slot salient subset — the LIDA gate) and **amplify** (self-built tools,
federation, and above all the human-in-the-loop as the variety source). "Keep the
human in the loop" is the cybernetic law that makes the system viable *and* keeps
purpose #2 alive. This is the rigorous death of "replace the human."

---

## 7. The Invariants (S5 — each names its independent sensor, or it's a slogan)

1. **Sovereignty** — individual is beneficiary + decision-maker; no data egress
   without explicit revocable consent. *Sensor:* network/egress audit in the ledger.
2. **Perception is consented + graduated** — scope expands only by per-domain
   revocable grant. *Sensor:* the perception-scope grant registry.
3. **Human-in-the-loop as variety source** — no headless replacement of judgement.
   *Sensor:* the held-out skills probe (#5 below) must not trend down.
4. **Optimise human-capability, not output** — teach, don't just do. *Sensor:*
   **skills probe + assistance-fade ratio** (the conscience meter, §9).
5. **Every loop has a governor with an external sensor** (the table in §3).
6. **Trust is binding and earned** — graduated; every act legible, reversible,
   ledgered; asymmetric recovery + probation. *Sensor:* the action ledger.
7. **Reversible-by-default** — agent writes are proposals (S2). *Sensor:* ledger
   shows undo-availability per action.
8. **Co-authored, inspectable goals** — the objective is set with the human and
   visible/editable (else "optimise your flourishing" = manipulation). *Sensor:*
   the goal registry is human-editable and diffed.
9. **Idle is free** — the loop must not consume an LLM turn to do nothing. *Sensor:*
   compute-cost meter (§9).
10. **Governed commons** — no federation/skill-sharing without decentralized
    reputation + sovereignty intact; **imported skills are treated as hostile code.**

---

## 8. Prior art — the lineage (borrow the wheels; the novelty is the synthesis)

| Strand | borrow | avoid |
|---|---|---|
| **Generative Agents** | memory-stream + retrieval triple + reflection cadence (the L0 cycle) | — |
| **MemGPT / Letta** | small self-edited core + paged store for continuity | "if it fails to save, it's gone" — make saves robust |
| **Voyager** | NL-described, embedding-indexed **executable code** skill library, stored on self-verified success (self-construction §end) | unverified skills; treat shared ones as supply-chain attacks |
| **ACT-R / SOAR / LIDA** | procedural/declarative split (skills vs MIND); impasse→subgoal (=surprise→deliberate); global-workspace attention gate (=attenuator) | hand-authored symbolic models (the knowledge bottleneck); the *utility problem* — perf can **degrade** with accreted learning ⇒ pruning/forgetting first-class |
| **Active inference (file/LLM realization)** | the reframe (files not distributions, LLM not matrices) — validation, not just aspiration | promising *calibrated* surprise; bootstrapping the error-handler with the same fallible loop |
| **Memory-governance (SSGM, Reflexion-grounding)** | provenance + validation + decay + human veto on every MIND edit | self-summarizing memory (the drift/poisoning engine) |
| **Local-first / Ink & Switch / Automerge** | CRDT substrate for S2 merge and L3 federation | reinventing P2P sync; coupling federation to blockchain/tokens |

**Honest novelty (what's actually new is the constraints, not the parts):**
1. **VSM-as-design-discipline** — prior agents build *capability*; this derives the
   build order from *missing viability functions*. Nobody reasons this way.
2. **Governors as a first-class, non-optional rule** — the field *reacts* to drift
   (SSGM) after the fact; here the balancing loop ships with the reinforcing one.
3. **Optimising the human-capability stock** — essentially no agent work measures
   whether the *human* gets stronger; it's the most original and least gameable claim.
4. **Surprise as the one currency** for attention + proactivity + the learning
   signal.
The synthesis (sovereign + continuity + surprise-driven + capability-optimising +
VSM-governed) is, as surveyed, **unbuilt.**

---

## 9. Leverage (Meadows) + the re-scoped first build

Work the top of the lever, never #12 (the in-app agent's "tune the interval"):
**#2 paradigm** (sovereign/distributed — the motivation, *not* a recursion level) →
**#3 goal** (capability+sovereignty, not output — most leverage, most danger) →
**#4 self-organization** (self-built tools; governed) → **#5 rules** (the invariants)
→ **#6 information flows** (close the loop + the visible/editable mind).

**Build sequence (each step green + an *external* meter before the next):**
1. **Continuity + the MIND keystone + the action ledger.** Persistent agent state +
   a governed (provenance/decay/veto) MIND world-model; the tamper-evident ledger.
   *This is ~80% of the real risk* (drift, the utility problem) — so governed memory
   ships *with* it, not after.
2. **One real prediction, externally graded** (next-file / next-commands, Brier-scored
   by the bus) → surprise as the deliberation trigger. Demote the rest of "active
   inference" to analogy.
3. **The cheap idle gate + compute-headroom governor** (idle is free) and the
   nag/asymmetric-trust governors — all event-bus-sensed.
4. **The mind panel** — visible/editable MIND + the ledger (radical transparency =
   trust + the human's S3* audit).
5. **Self-construction** (Voyager-style verified skill library — the Live AI widget
   is the seed).
6. **Federation** — *only* after decentralized reputation + hostile-skill sandboxing.

---

## 10. Measurement — the conscience (operationalized, not a slogan)

Per master stock, instrumented from day one (the live e2e harness on this branch
already lets us observe from the user's seat):

- **Fidelity** — Brier/log-loss of the *externally-graded* prediction (§9.2), **not**
  the LLM's self-grade.
- **Trust** — granted-autonomy level + falling intervention/undo rate (from the ledger).
- **Human-capability (the conscience)** — **held-out skills probe** (unaided human
  performance on a withheld task, tracked over months) + **assistance-fade ratio**
  (is the agent's share of recurring work going *down*?). If usefulness rises while
  capability falls, deskilling is winning and the design has failed *regardless of
  how alive it feels.* Measured independently of the agent, or it doesn't count.
- **Continuity** — does the agent correctly recall/build on its own prior threads?
- **Compute-cost** — "agent cost today" as a first-class, user-visible meter.
- **Coherence** — order/health of the actual work over time.

---

## Pre-mortem (kept in view — the 5 deaths to design against)

1. **Laptop got hot/slow → turned off, never back on.** → idle free; govern by headroom; show cost.
2. **One early error zeroed trust forever.** → asymmetric trust + earned-irreversibility (reversible/low-blast-radius until fidelity is *measured*).
3. **Confabulator — felt alive, learned nothing.** → one externally-graded prediction + the action ledger.
4. **Nobody wanted a watcher.** → perception scope is graduated/consented like autonomy.
5. **Deskilling won silently, dashboard stayed green.** → the capability meter is instrumented *before* any "do-it" ships.

---

*Engine: the Generative-Agents cycle, surprise as currency. Body: reversible
proposals + governed self-built skills (S1–S3). Mind: the persistent, governed MIND
(bounded S4). Conscience: the human-capability meter + the invariants, each with an
external sensor (S5 = the human). World: the governed Commons. All recursive; all
sovereign; the human always inside, and always the apex.*
