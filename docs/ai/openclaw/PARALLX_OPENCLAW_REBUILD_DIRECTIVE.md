# Parallx OpenClaw Rebuild Directive

**Status:** Active rebuild directive  
**Date:** 2026-03-24  
**Purpose:** Record the architectural reversal for Parallx AI: stop extending the Parallx-native claw runtime, freeze it as legacy, and rebuild the default AI surface from a separate OpenClaw-style implementation root.

---

## 1. Directive

Parallx should not keep evolving the current claw runtime as the main AI path.

The correct direction is:

1. freeze the current claw runtime as a legacy comparison lane;
2. stop adding new default-chat behavior inside that lane;
3. build the replacement from a separate implementation root;
4. keep the old lane accessible so the two implementations can be compared explicitly.

---

## 2. Implemented First Cut

The first cut of that directive is now in the repo.

### 2.1 New source root

The new implementation root is:

- `src/openclaw/`

This is where the new default AI implementation begins.

### 2.2 Separate default runtime lane

The default chat surface can now route to:

- `parallx.chat.openclaw-default` for the new OpenClaw lane;
- `parallx.chat.default` as the legacy default registration;
- `parallx.chat.legacy-default` as an explicit comparison alias for the frozen claw lane.

### 2.3 Runtime selector

Default-surface selection is now controlled through unified AI config:

- `runtime.implementation = 'openclaw'`
- `runtime.implementation = 'legacy-claw'`

The current default is now `openclaw`.

---

## 3. Guardrails

From this point forward:

1. the existing claw runtime is a legacy lane, not the target architecture;
2. new default-chat capability work should go into `src/openclaw/`;
3. if legacy code must be touched, it should be for isolation, freeze, or compatibility only;
4. comparison must remain possible until the OpenClaw lane proves parity.

---

## 4. OpenClaw Shape For The New Lane

The new lane should follow OpenClaw-style discipline:

1. workspace-root bootstrap files are explicit inputs;
2. file-backed memory layers are explicit inputs;
3. the model works against tools and workspace state rather than coded workflow authority;
4. session ownership and runtime selection are explicit;
5. the new lane lives in its own source root instead of being layered into the old runtime utilities.

---

## 5. What This Does Not Mean

This directive does not require deleting the legacy code immediately.

Immediate deletion would remove the comparison lane the rebuild needs.

Instead, the current claw runtime is now treated as:

- preserved legacy behavior,
- accessible by explicit participant ID,
- no longer the place where the new default AI architecture is supposed to evolve.

---

## 6. Next Implementation Steps

The next OpenClaw-lane work should focus on:

1. moving more bootstrap and memory behavior into `src/openclaw/`;
2. replacing legacy retrieval/planning assumptions with OpenClaw-style tool-led exploration;
3. adding explicit OpenClaw session/bootstrap diagnostics;
4. expanding tests to compare `parallx.chat.openclaw-default` against `parallx.chat.legacy-default`.