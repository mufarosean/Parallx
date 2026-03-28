# Parallx OpenClaw Skill E2E Parity Plan

**Status:** Implemented for the live OpenClaw OpenClaw participant lanes on 2026-03-27  
**Date:** 2026-03-27  
**Purpose:** Define the upstream OpenClaw skill lifecycle as the canonical
end-to-end process, compare each stage to Parallx's current implementation, and
identify which non-conforming skill paths should be removed so Parallx ends up
with one unified skill process.

---

## 1. Canonical End-To-End Skill Flow From OpenClaw

This section defines the runtime-owned skill lifecycle that Parallx should
mirror.

### Step 1. Enter the embedded run pipeline

The turn enters the normal OpenClaw execution pipeline. Session lanes, global
lanes, model resolution, auth-profile order, and context engine setup happen
before the final attempt loop settles on a concrete embedded attempt.

Meaning:

- skills are part of the runtime pipeline,
- they are not an isolated helper layered onto an already-built prompt.

Upstream grounding:

- `agent-runner.ts`
- `agent-runner-execution.ts`
- `run.ts`
- `attempt.ts`
- `OPENCLAW_PIPELINE_REFERENCE.md` L1-L4 overview

### Step 2. Load skill entries before prompt assembly

Inside `runEmbeddedAttempt`, OpenClaw loads skill entries before it builds the
system prompt or creates tools.

Meaning:

- the runtime has a concrete, normalized set of skills for this turn,
- skill loading is an execution input, not a late-stage prompt patch.

Upstream grounding:

- `runEmbeddedAttempt`
- `loadSkillEntries`
- `OPENCLAW_PIPELINE_REFERENCE.md`

### Step 3. Treat skills as file-backed runtime assets

The loaded skills come from `SKILL.md`-backed definitions that the runtime can
normalize into structured entries.

Meaning:

- skills are inspectable,
- skills are not hidden prompt fragments,
- the runtime can explain where a skill came from.

Upstream grounding:

- `OPENCLAW_REFERENCE_SOURCE_MAP.md`

### Step 4. Convert skill entries into system-prompt-visible skill artifacts

The runtime passes the loaded skills into `buildEmbeddedSystemPrompt`, which
includes skill prompt entries along with bootstrap files, tool descriptions, and
runtime metadata.

Meaning:

- the model sees the authoritative skill catalog through the canonical prompt,
- skill awareness is a first-class runtime product.

Upstream grounding:

- `buildEmbeddedSystemPrompt`
- `OPENCLAW_PIPELINE_REFERENCE.md`

### Step 5. Build tools from the same runtime state

After loading skills and assembling the prompt, OpenClaw creates tools from the
same attempt context.

Meaning:

- prompt-visible capabilities and executable capabilities come from one runtime
  preparation pass,
- the runtime is responsible for keeping them coherent.

Upstream grounding:

- `createOpenClawCodingTools`
- `OPENCLAW_REFERENCE_SOURCE_MAP.md`

### Step 6. Apply tool policy after capability creation

The resulting capability surface is filtered through tool policy.

Meaning:

- capability existence and capability availability are separate,
- runtime policy is the authority for what remains usable this turn.

Upstream grounding:

- `isToolAllowedByPolicies`
- `OPENCLAW_REFERENCE_SOURCE_MAP.md`

### Step 7. Create the agent session and apply the finished system prompt

Only after skills, tools, and prompt artifacts are resolved does OpenClaw create
the agent session and apply the system prompt.

Meaning:

- the session starts with the skill contract already in place,
- the model does not need a later compensating patch to learn what skills are.

Upstream grounding:

- `createAgentSession`
- `OPENCLAW_PIPELINE_REFERENCE.md`

### Step 8. Bootstrap and assemble the context engine on top of that contract

The context engine bootstrap, transcript restore, and context assembly happen
after the skill-aware prompt foundation exists.

Meaning:

- retrieval and context enrich an already-defined runtime contract,
- they do not substitute for missing skill authority.

Upstream grounding:

- `runAttemptContextEngineBootstrap`
- `assembleAttemptContextEngine`
- `OPENCLAW_PIPELINE_REFERENCE.md`

### Step 9. Execute the turn with unified skill, prompt, tool, and policy state

The model runs the turn using one session state that already includes:

- loaded skill entries,
- prompt-visible skill artifacts,
- created tools,
- filtered tool availability,
- assembled context.

Meaning:

- skills are part of one execution contract,
- not multiple parallel skill mechanisms.

Upstream grounding:

- `runEmbeddedAttempt`
- `OPENCLAW_PIPELINE_REFERENCE.md`

### Step 10. Keep the skill path inspectable through runtime reporting

The runtime can report on prompt inputs, skills, tools, and context as part of
the same execution story.

Meaning:

- users and developers can inspect what skill contract actually influenced the
  turn,
- no hidden secondary skill path is needed.

Upstream grounding:

- `PARALLX_OPENCLAW_EXECUTION_PHASE_CONTEXT_REPORT.md`
- `PARALLX_CLAW_SKILLS_AND_PROMPTS_SPEC.md`

---

## 2. Side-By-Side Parity Comparison

Important interpretation note:

- the 10 steps below are the canonical runtime lifecycle order from upstream OpenClaw,
- they are not a safe implementation backlog order for Parallx,
- a later runtime lifecycle step can become compliant before an earlier one if the earlier step is broader in scope.

| Step | OpenClaw end-to-end behavior | Current Parallx implementation | Gap? | What Parallx needs to do |
| --- | --- | --- | --- | --- |
| 1. Enter pipeline | Skills belong to the runtime pipeline from the attempt layer downward. | The live OpenClaw participant lanes now keep skill loading, skill-state normalization, skill-derived capability exposure, tool-policy filtering, prompt construction, and execution inside the runtime path. Boot-time skill-tool registration is removed from the active contract. | No | This step is implemented correctly for the live OpenClaw participant lanes. |
| 2. Load skills before prompt assembly | `loadSkillEntries` runs before system prompt and tool creation. | `buildOpenclawTurnContext()` now loads the canonical file-backed catalog through `getSkillCatalog()` and normalizes it into `skillState` before `executeOpenclawAttempt()` builds the prompt. | No | This step is implemented correctly for the live OpenClaw default lane. |
| 3. File-backed runtime assets | Skills are file-backed, inspectable runtime assets. | The live lane now consumes skills from `SkillLoaderService`'s file-backed catalog, and the old duplicate built-in manifest registry is gone. Seeded defaults still end up as actual `.parallx/skills/*/SKILL.md` files, so the runtime contract is file-first. | No | This step is implemented correctly; keep all future skill sources manifest-driven and file-backed. |
| 4. Prompt-visible skill artifacts | Canonical system prompt builder injects skill prompt entries from the loaded runtime skill set. | The new `openclawPromptArtifacts.ts` builder feeds `buildOpenclawSystemPrompt()` from one normalized `skillState`, and both live execution and `/context` estimation use that same path. | No | This step is implemented correctly for the live OpenClaw lane. |
| 5. Build tools from same runtime state | Tools are created from the same resolved runtime state as the prompt. | `buildOpenclawTurnContext()` now derives skill-tool capability exposure from the same loaded `skillCatalog` used to build `skillState`, merges that with platform tools for the turn, and passes one runtime-owned tool state into prompt construction and execution. | No | This step is implemented correctly for the live OpenClaw lane. |
| 6. Apply policy after capability creation | Tool policy filters the capability set after creation. | The runtime tool-state builder now creates the full capability surface first and only then applies `applyOpenclawToolPolicy()` to compute the model-available subset for the turn and for prompt-visible tool summaries. | No | This step is implemented correctly for the live OpenClaw lane. |
| 7. Create session and apply finished prompt | The session begins with the full skill contract already resolved. | The raw skill-body injection path is removed. `executeOpenclawAttempt()` now builds one canonical prompt artifact from bootstrap files, workspace digest, normalized skill state, tools, preferences, and overlays before the model turn is sent. | No | This step is implemented correctly for the live OpenClaw lane. |
| 8. Assemble context after skill contract exists | Context enriches an already-set skill/prompt/tool contract. | `buildOpenclawTurnContext()` resolves `skillState` before `runOpenclawTurn()` assembles context, so context assembly now occurs after the skill contract exists and no longer relies on activated-skill side channels. | No | This step is implemented correctly for the live OpenClaw lane. |
| 9. Execute turn under one contract | Model executes with unified skill, prompt, tool, and policy state. | The live OpenClaw participant lanes now execute with one runtime-owned skill, prompt, tool, and policy contract. Tool-kind skills are no longer exposed by a boot-time side path, and runtime invocation falls through one capability story. | No | This step is implemented correctly for the live OpenClaw participant lanes. |
| 10. Inspectability | Runtime can explain which skills were loaded, visible, and effective. | `/context` and the stored prompt report now expose total skills, visible skills, hidden skills, per-skill visibility reasons, total exposed tools, available tools, filtered tools, skill-derived capability counts, and per-tool filtered reasons/source metadata. | No | This step is implemented correctly for the live OpenClaw lane. |

---

## 3. Current Parallx Skill Paths Mapped To The Framework

This section identifies which existing Parallx paths fit the unified
end-to-end framework and which do not.

### Paths that fit the target framework and should be retained, then aligned

1. `src/services/skillLoaderService.ts`
   - Keep the file-backed discovery direction.
   - Redesign it into the canonical registry/loading phase for the runtime.

2. `src/openclaw/openclawSystemPrompt.ts`
   - Keep the idea that the canonical prompt builder owns model-visible skill
     artifacts.
   - Feed it from unified skill state only.

3. `src/openclaw/openclawParticipantServices.ts`
   - Keep the adapter seam idea.
   - Narrow it so the runtime consumes one skill state contract rather than a
     grab bag of skill helpers.

### Paths that do not fit the target framework and should be removed or absorbed

1. `src/openclaw/openclawTurnPreprocessing.ts`
   - `activateSkill(...)`
   - `detectAndActivateFreeTextSkill(...)`
   
   Why this does not fit:
   
   - it creates a pre-runtime skill activation side path,
   - it lets regex/free-text activation shape skill behavior before the unified
     runtime skill load has produced one canonical skill state,
   - it encourages a second concept of skill application separate from the
     runtime-owned skill lifecycle.

   Required action:

   - remove this as a separate authority,
   - if explicit skill requests remain supported, resolve them inside the
     canonical runtime skill-loading step.

2. `src/openclaw/openclawAttempt.ts`
   - `systemPromptAddition: [assembled.systemPromptAddition, context.activatedSkillBody]...`

   Why this does not fit:

   - it injects raw skill body text as a late patch,
   - it bypasses the single canonical prompt artifact model.

   Required action:

   - remove `activatedSkillBody` as a side-channel prompt input,
   - replace it with canonical prompt construction from resolved skill state.

3. `src/services/skillLoaderService.ts`
   - `manifestToToolDefinition(...)`

   Why this does not fit in its current form:

   - it auto-converts loaded skills into tools without a clearly unified runtime
     decision about which skill kinds should affect tool exposure,
   - it causes the skill registry layer to own tool instantiation behavior.

   Required action:

   - move any skill-to-tool mapping decision into the unified runtime contract,
   - remove standalone auto-registration of workflow skills as tools if that is
     not part of the final contract.

4. `src/built-in/chat/main.ts`
   - `registerSkillTools()`

   Why this does not fit:

   - it registers skills as tools outside the canonical attempt pipeline,
   - it creates another skill execution surface that is not clearly tied to the
     OpenClaw attempt lifecycle.

   Required action:

   - remove direct skill-tool registration from the app boot path,
   - expose only the capability surface emitted by the unified runtime skill
     contract.

5. `src/built-in/chat/config/chatSystemPrompts.ts`
   - `buildSkillInstructionSection(...)`

   Why this does not fit:

   - it is a second style of skill prompt injection separate from the canonical
     OpenClaw prompt builder,
   - it represents old chat-era skill authority that competes with the OpenClaw
     lane.

   Required action:

   - remove this alternate skill instruction path once the OpenClaw prompt path
     is the sole authority.

6. `src/built-in/chat/skills/builtInSkillManifests.ts`

   Why this does not fit:

   - it appears to be a separate built-in skill source that is not the same as
     the file-first runtime contract,
   - it creates ambiguity about whether built-ins come from manifests, seeded
     workspace files, or some hidden registry path.

   Required action:

   - either absorb these definitions into the single canonical bundled-skill
     source,
   - or delete this file and its concept entirely.

---

## 4. Unified Target For Parallx

Parallx should converge on this one end-to-end skill process:

1. runtime enters the OpenClaw attempt flow,
2. runtime loads all bundled and workspace skills through one registry,
3. runtime validates and normalizes them into one skill state,
4. runtime computes model-visible skill artifacts from that state,
5. runtime computes any skill-derived capability exposure from that same state,
6. runtime applies policy filtering,
7. runtime builds one canonical system prompt,
8. runtime creates the session with that prompt,
9. runtime assembles context and executes the turn,
10. runtime reports which skills were loaded, visible, filtered, and effective.

Everything outside that chain should either be absorbed into it or deleted.

### 2026-03-27 implementation update

This plan is now implemented in the live OpenClaw participant lanes:

1. the default OpenClaw participant now builds one normalized runtime skill state from the canonical file-backed skill catalog,
2. the live turn runner consumes that skill state for prompt-visible skill artifacts,
3. `/context` estimate/reporting now consumes the same skill state instead of rebuilding a separate skill prompt view,
4. skill-derived tool capabilities are now created per turn from the same loaded skill catalog instead of being registered at app boot,
5. runtime tool policy is now applied after capability creation inside the same runtime-owned tool-state builder,
6. runtime prompt reporting now records loaded skill count, visible skill count, hidden skill count, per-skill visibility reasons, exposed tool count, filtered tool count, available tool count, skill-derived capability count, and per-tool filtered reasons/source metadata,
7. settings-backed user preferences are now carried into the OpenClaw prompt path through the same canonical artifact builder,
8. workspace and canvas OpenClaw lanes now consume runtime-derived skill-tool exposure through the same activation wrapper instead of depending on boot-time registration.

The OpenClaw skill-contract parity work described in this document is now closed for the live OpenClaw participant lanes. Remaining AI-system redesign work belongs to broader Milestone 40 convergence outside this skill-contract slice.

---

## 5. Immediate Cleanup Rule

When implementing the unified skill flow, any Parallx code that mentions or
applies skills but does not clearly belong to one of the ten canonical runtime
steps above should be treated as removal-candidate code.

That includes:

- regex/free-text pre-activation paths,
- raw skill-body prompt injection,
- skill-specific prompt helpers outside the canonical OpenClaw prompt builder,
- hidden or duplicate bundled-skill registries,
- boot-time skill-to-tool registration that bypasses runtime-owned capability
  creation.

This rule is necessary to prevent the next version of the runtime from keeping
old skill concepts alive under different names.
