# Parallx Claw Dependency Policy

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Define the binding dependency envelope for the Parallx claw
redesign.

---

## 1. Purpose And Scope

This document governs runtime and build-time dependencies that affect the
redesign. It exists to prevent the project from accidentally importing upstream
operational requirements that conflict with Parallx's intended product shape.

---

## 2. Dependency Principles

The first implementation cut must remain:

- local-first,
- desktop-first,
- free of hidden operators or required external daemons,
- free of surprise infrastructure requirements,
- rooted in the proven in-repo Parallx substrate.

The redesign may borrow ideas and selected code from claw systems, but it may
not inherit operating assumptions that force users to install and manage a
second runtime stack.

---

## 3. Allowed First-Cut Dependencies

The following are allowed in the first implementation cut:

- the existing Electron application runtime,
- the existing Parallx service and storage stack,
- Ollama for local model inference,
- the existing SQLite and vector infrastructure,
- selected vendored upstream code that does not impose disallowed runtime
  assumptions.

---

## 4. Conditionally Allowed Later-Phase Dependencies

These are not first-cut assumptions, but may be considered later through an
explicit decision-record update:

- optional cloud model providers,
- stronger sandboxing or isolation technologies,
- remote runtime separation,
- richer plugin/package distribution,
- deeper replay tooling or operator-facing runtime infrastructure.

---

## 5. Disallowed First-Cut Dependencies

The following are explicitly disallowed in the first implementation cut:

- external OpenClaw daemon requirement,
- external NemoClaw CLI/runtime requirement,
- Docker requirement,
- OpenShell requirement,
- Python blueprint runner requirement,
- hosted NVIDIA inference requirement,
- browser-based control-plane dependency,
- multi-channel chat ingress requirements.

These are not soft discouragements. They are hard first-cut exclusions.

---

## 6. Upstream Code Intake Rule

Any imported or adapted upstream code must be dependency-neutral relative to
this policy or must have the conflicting dependency assumption removed during
adaptation.

When upstream code is copied or adapted, the redesign docs must record:

1. the exact purpose of the slice,
2. the upstream dependency assumption that was removed or translated,
3. why the result still conforms to this policy.

---

## 7. Review Rule

Any proposal that introduces a new runtime or operational dependency must update
this document and the decisions ledger before implementation proceeds.

If the dependency proposal cannot fit the first-cut envelope, it belongs in a
later phase and must be documented as such rather than implicitly introduced.

---

## 8. Completion Gate

This document is complete only when the first-cut dependency envelope is
explicit enough to reject inappropriate upstream reuse automatically.

This document meets that gate for the planning phase.