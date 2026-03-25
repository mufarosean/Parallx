# Parallx Claw User Model

**Status:** Planning complete  
**Date:** 2026-03-24  
**Purpose:** Explain the redesign from the user's point of view.

---

## 1. Purpose And Audience

This document describes what the redesign means as product behavior rather than
as internal architecture.

It exists because a redesign that is architecturally cleaner but less legible to
users would still be a product failure.

---

## 2. What Stays The Same For Users

From the user's perspective, these core expectations remain:

- chat stays inside Parallx,
- local-first AI remains core,
- the workspace remains the AI's working context,
- Parallx continues to behave like a second-brain workbench rather than a thin
  gateway to another app.

---

## 3. What Changes For Users

The redesign aims to make these behaviors clearer and more reliable:

- prompt files and skill definitions become more explicit and inspectable,
- approval behavior becomes easier to understand,
- source/provenance behavior becomes easier to explain,
- runtime behavior becomes less dependent on hidden orchestration quirks,
- the AI should feel more coherent across surfaces.

---

## 4. What The Runtime Should Explain More Clearly

The redesigned runtime should make it easier for users and developers to
understand:

- why a tool was used,
- why approval was requested,
- which context influenced a turn,
- why a response took a particular grounded or non-grounded path,
- which prompt or skill layers were active.

---

## 5. How Skills And Prompt Files Fit The User Experience

The redesign moves toward a more file-first user model:

- skills are visible contracts rather than mostly invisible built-ins,
- prompt layers are understandable rather than scattered across multiple hidden
  seams,
- workspace customization remains natural to the product rather than feeling
  bolted on.

---

## 6. What Is Intentionally Not Included In The First Cut

Users should not expect the first cut to include:

- multi-channel messaging surfaces,
- a second external runtime to install and manage,
- Docker/OpenShell sandboxing,
- a hosted control-plane experience,
- cloud-first behavior as the default operating model.

The first cut is intentionally narrower than the full upstream claw ecosystems.

---

## 7. How Approvals And Safety Should Feel

The redesign should make approvals feel:

- explicit,
- understandable,
- tied to clear runtime behavior,
- safer rather than more opaque.

Approval behavior is part of the product experience, not just a technical gate.

---

## 8. What Local-First Means In Practice

For this redesign, local-first means:

- Parallx does not require a second always-on external claw runtime,
- local model support through Ollama remains a first-class path,
- upstream runtime ideas are translated into Parallx rather than forcing users
  to adopt the upstream operating model.

---

## 9. Migration Expectations For Existing Users

Existing users should experience migration as:

- a runtime improvement inside Parallx,
- not a product migration to another app,
- not a hidden behavior change with no fallback,
- not a reset of unrelated workspace and product capabilities.

---

## 10. Completion Gate

If the redesigned AI feels more powerful internally but less understandable to
the user, the redesign has missed part of its goal.

This document is complete for the planning phase because it defines the intended
user-facing meaning of the redesign.