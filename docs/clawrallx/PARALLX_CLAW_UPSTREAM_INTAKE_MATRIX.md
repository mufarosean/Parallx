# Parallx Claw Upstream Intake Matrix

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Classify what Parallx preserves, adopts, hybridizes, or excludes
from OpenClaw and NemoClaw.

---

## 1. Executive Summary

Parallx should not attempt a git-history rollback and should not adopt OpenClaw
or NemoClaw wholesale.

The correct path is:

- preserve the proven Parallx AI substrate,
- replace the current orchestration layer,
- selectively vendor and adapt useful claw runtime ideas,
- explicitly exclude upstream operational assumptions that conflict with a
  desktop-first local-first Parallx runtime.

Headline conclusions:

- Preserve Parallx model transport, retrieval, indexing, vector storage, memory
  storage, and session persistence.
- Replace Parallx orchestration, prompt authority, skill/runtime contract, and
  front-door routing behavior.
- Use NemoClaw as the primary source for explicit runtime contracts, approval
  discipline, traceability, and file-first structure.
- Use OpenClaw as the secondary source for capability registration,
  extensibility patterns, and clean runtime boundary concepts.
- Exclude gateway/daemon dependence, Docker/OpenShell sandboxing, Python
  blueprint runtime, multi-channel messaging surfaces, and cloud-first
  inference assumptions from the first cut.

---

## 2. Intake Constraints

This intake is governed by the following hard constraints:

1. The repository cannot be safely rewound to a pre-AI state without losing
   unrelated work.
2. The first implementation cut must run inside Parallx without requiring an
   externally installed OpenClaw or NemoClaw runtime.
3. Ollama remains allowed because it already fits Parallx's local-first model.
4. Docker, OpenShell, Python blueprint execution, and hosted NVIDIA inference
   are excluded from the first cut.
5. The working Parallx substrate must be preserved unless a later document
   justifies a narrower replacement.
6. The redesign must not end in a permanent split-brain dual-runtime state.

---

## 3. Source-System Characterization

### 3.1 OpenClaw

OpenClaw is primarily a gateway-centered, always-on, multi-channel runtime.

Its strongest transferable ideas for Parallx are:

- capability registration,
- plugin discovery and precedence,
- control-plane separation,
- explicit runtime services.

Its non-transferable first-cut assumptions are:

- always-on gateway as a required service,
- browser/dashboard control surface,
- multi-channel messaging surfaces,
- external daemon lifecycle.

### 3.2 NemoClaw

NemoClaw is primarily a sandbox-centered reference stack around OpenClaw and
OpenShell.

Its strongest transferable ideas for Parallx are:

- explicit runtime contracts,
- file-first structure,
- approval and policy discipline,
- checkpoint and reproducibility thinking,
- strong distinction between runtime control and inference execution.

Its non-transferable first-cut assumptions are:

- OpenShell sandbox requirement,
- Docker/container runtime requirement,
- Python blueprint execution,
- hosted NVIDIA inference as the default profile.

### 3.3 Parallx target interpretation

Parallx is a desktop workbench with a functioning local AI substrate. The
redesign should therefore translate claw ideas into an in-process desktop
runtime rather than adopting upstream operating models literally.

---

## 4. Decision Framework

Every subsystem is classified using one of these outcomes:

- **Preserve Parallx**: Keep the existing Parallx approach as the first-cut
  foundation.
- **Adopt OpenClaw**: Reuse the OpenClaw pattern closely with limited
  adaptation.
- **Adopt NemoClaw**: Reuse the NemoClaw pattern closely with limited
  adaptation.
- **Hybridize**: Build a Parallx-native design informed by one or both upstream
  systems.
- **Exclude**: Do not import the subsystem or assumption into the first cut.

These labels are operational, not rhetorical. If a subsystem is not classified
here, it is not ready for implementation planning.

---

## 5. Subsystem Intake Matrix

| Subsystem | Current Parallx state | OpenClaw pattern | NemoClaw pattern | Recommendation | First-cut scope | Deferred scope |
|-----------|-----------------------|------------------|------------------|----------------|-----------------|----------------|
| Model transport | Clean local model transport via `ILanguageModelsService` and Ollama provider | Provider registry behind daemon runtime | Profile-based routing with stronger explicit provider framing | Preserve Parallx, hybridize profile concepts | Keep Parallx transport, optionally introduce profile vocabulary | Additional providers only after dependency-policy approval |
| Prompt layering | Split across multiple seams, no single authority | Gateway/plugin-oriented prompt injection | Stronger file-first runtime discipline | Hybridize | One canonical prompt contract inside Parallx | More advanced layer tooling later |
| Skills and tool manifests | Tools exist, manifest discipline incomplete | Plugin-defined capability registration | More explicit runtime contract mindset | Hybridize | File-first manifest-driven skills | Broader distribution/registry later |
| Session/runtime lifecycle | Good session substrate, weak orchestration contract | Gateway/session routing | Stronger explicit runtime/checkpoint framing | Hybridize | Explicit run/session/checkpoint contract | Deeper replay tooling later |
| Participant/routing | Too much responsibility in front-door routing and default participant | Narrower command/participant concepts | More structured orchestration contract | Hybridize | Replace monolithic front-door authority | Advanced routing heuristics later |
| Approval/policy | Working foundations but not a full explicit contract | Interactive runtime prompts | Strong policy/approval framing | Hybridize | First-class runtime approval objects and audit records | Stronger policy sets later |
| Tracing/evals | Some foundations exist, not one unified runtime story | Service/event orientation | Reproducibility and explicit runtime state thinking | Hybridize | Runtime provenance and verification hooks | Richer replay and operator tooling later |
| Retrieval/indexing | Strong and already product-specific | Not an improvement for Parallx | Not an improvement for Parallx | Preserve Parallx | Keep existing retrieval and indexing substrate | Optimize later only if evidence demands it |
| Persistence/state | Working SQLite-based chat persistence | File/state-dir oriented | Blueprint/checkpoint oriented | Preserve Parallx, extend selectively | Keep Parallx persistence with optional checkpoint extension | More formal replay storage later |
| UI/chat surfaces | Stable integrated workbench chat UI | Web/dashboard + channels | OpenClaw-in-sandbox surface | Preserve Parallx | Keep Parallx UI shell | Optional richer inspection UI later |
| Daemon/gateway model | No separate daemon required | Core operating assumption | Still depends on external managed runtime shape | Exclude | No daemon in first cut | Revisit only if later product requirements justify it |
| Sandboxing/security model | Approval-based safety, no OS-level sandbox | No equivalent first-cut improvement | OpenShell-centered sandbox model | Exclude in first cut | Keep approval-centric safety model | Consider stronger sandbox later |
| External dependency model | Electron/Node/SQLite/Ollama already fit | External gateway and package ecosystem assumptions | Docker/OpenShell/Python/NVIDIA assumptions | Preserve Parallx dependency posture | Stay within allowed first-cut dependency policy | Later expansion only through explicit decision record |
| Config/state layout | Existing Parallx config plus AI settings | `~/.openclaw` style state and config dirs | Blueprint/profile-oriented split config | Hybridize | Keep Parallx-centered config with better runtime contract | More layered config only if needed |
| Bundled vs workspace capability loading | Incomplete file-first story today | Plugin discovery precedence | Better discipline around explicit sources | Hybridize | Same visible contract for bundled and workspace skills | Personal/shared skill layers later if desired |

---

## 6. Detailed Notes On Critical Rows

### 6.1 Model transport

Parallx already has the correct first-cut operating model here. The redesign
should not replace local model transport with a gateway-bound or cloud-first
abstraction. The useful upstream lesson is stronger vocabulary around provider
profiles and runtime contracts, not a new transport substrate.

### 6.2 Prompt layering

Prompt layering is a redesign target because the current system still permits
split authority. The final runtime must have one canonical prompt contract with
ordered and inspectable layers.

### 6.3 Skills and manifests

The redesign should move away from permanent hidden bundled behavior and toward
manifest-driven file-backed skills. OpenClaw contributes useful capability
registration patterns. NemoClaw contributes stronger runtime-discipline ideas.

### 6.4 Runtime lifecycle

This is the most important hybridization area. Parallx should keep its session
substrate but move to an explicit runtime session and run contract with
checkpoint-aware semantics.

### 6.5 Approval and policy

Approval behavior must become a first-class runtime concern. It should not stay
as a mostly implicit tool-local decision path.

### 6.6 Gateway and sandbox assumptions

These are the easiest places to drift. Both must remain excluded from the first
cut even if upstream docs make them look attractive. They conflict with the
desktop-first local-first constraint.

---

## 7. Upstream Code-Ingestion Policy

Any upstream code intake must be:

- selective,
- attributable,
- justified at the subsystem level,
- compatible with the dependency policy,
- stripped of disallowed runtime assumptions where necessary.

Parallx will not mirror or vendor either upstream repository wholesale.

If code is copied or adapted, the redesign docs must state:

1. what problem the slice solves,
2. which upstream assumption was removed or translated,
3. why the result still conforms to Parallx's dependency policy.

---

## 8. Deferred Topics

These topics are intentionally deferred from the first-cut redesign boundary:

- hosted control planes,
- multi-channel messaging ingress,
- daemon extraction,
- remote runtime separation,
- Docker/OpenShell sandboxing,
- cloud-provider default support,
- advanced operator-facing dashboards.

Deferred does not mean forbidden forever. It means explicitly out of scope for
the first implementation cut.

---

## 9. Open Questions

The remaining open questions do not block the first-cut planning boundary but
should be tracked:

1. whether a later personal-skill layer should exist in addition to bundled and
   workspace skills,
2. whether cloud model support should be defined in the first runtime contract
   as a deferred interface or omitted entirely,
3. how much replay/debug tooling is needed beyond checkpoint-aware persistence
   in the first cut.

---

## 10. Completion Gate

This document is complete only when:

1. every major subsystem is classified,
2. every exclusion is justified,
3. the first-cut boundary is explicit,
4. no architecture-critical intake decision is left as a vague future idea.

This document meets that gate for the redesign planning phase.