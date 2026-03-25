# Parallx Claw Skills And Prompts Spec

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the file-first contract for skills and prompt layering in
the Parallx claw runtime.

---

## 1. Purpose And Scope

The redesign needs one inspectable, file-first contract for skills and prompts
so that bundled behavior, workspace customization, and runtime prompt assembly
all follow the same visible rules.

This document defines that contract.

---

## 2. Design Principles

The skill and prompt system must be:

- file-first,
- inspectable,
- user-extensible,
- deterministic in load order,
- minimal in hidden behavior.

If the runtime cannot explain which prompt layers and skill definitions
influenced a turn, the contract is incomplete.

---

## 3. Skill Model

In Parallx, a skill is a file-backed capability declaration that tells the
runtime:

- what the capability is,
- how it should be described,
- which tools it exposes or influences,
- what approval expectations it carries,
- whether it is enabled and visible.

A skill is not an invisible hardcoded string block.

---

## 4. Skill Manifest Schema

The first-cut manifest should define at least:

- `id`
- `name`
- `version`
- `description`
- `invocationHints` or `triggers`
- `toolDefinitions`
- `approvalRequirements`
- `enabledByDefault`
- `visibility`
- `dependencies` if any
- `sourceType`

The exact serialization format can be finalized during implementation, but the
contract must remain explicit and file-backed.

---

## 5. Skill Sources And Precedence

The first-cut runtime recognizes two skill sources:

1. bundled skills shipped with Parallx,
2. workspace skills provided by the active workspace.

Rule:

- both use the same manifest contract,
- both are inspectable,
- both participate in the same validation and enablement model.

Possible future layers such as personal or shared skills are deferred.

---

## 6. Skill Discovery And Validation

The runtime must define:

- where bundled skills live,
- where workspace skills live,
- when discovery runs,
- how manifests are validated,
- how invalid or incompatible skills are reported,
- how disabled skills are handled.

Invalid skills must not silently mutate runtime behavior.

---

## 7. Prompt Layer Model

The canonical layer order is:

1. immutable Parallx runtime instructions,
2. bundled prompt layers if any exist,
3. workspace/root prompt files,
4. rule overlays,
5. runtime-generated context,
6. user turn content.

This order is normative for the redesign.

---

## 8. Precedence And Conflict Rules

The runtime must define:

- which later layers may refine lower layers,
- which lower layers are immutable,
- how conflicting directives are resolved,
- how the effective prompt can be inspected.

No hidden secondary prompt-authority path is allowed.

---

## 9. Runtime Exposure Rules

Not all skill data is necessarily model-visible.

The runtime must distinguish:

- model-visible metadata,
- runtime-only control data,
- approval or policy-only metadata,
- debugging and explainability metadata.

This prevents accidental leakage of implementation-only controls while keeping
the system inspectable.

---

## 10. Auditability And Debugging

The app should be able to show:

- the effective prompt layers used for a turn,
- which skills were loaded,
- which skills were visible to the runtime,
- which skills influenced tool availability.

If a user or developer cannot inspect that information, the system is still too
opaque.

---

## 11. Explicit Exclusions

The final design must not depend on:

- a permanent hidden bundled-skill string path,
- a second hidden prompt-construction authority,
- skill behavior that cannot be traced back to a file-backed contract.

---

## 12. Completion Gate

This document is complete only when skill discovery, validation, prompt
precedence, and auditability are explicit enough to test and implement.

This document meets that planning-phase gate.