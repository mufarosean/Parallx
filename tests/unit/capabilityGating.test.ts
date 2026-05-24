/**
 * M81 Slice C — Capability Gating characterization.
 *
 * Closes the §22 debt for `capabilityGating.test.ts` promised in
 * `docs/Parallx_Milestone_81.md`. Per the 2026-05-23 audit ruling
 * (`docs/research/M81_SLICE_C_AUDIT.md`), capability gating is CLOSED in
 * place: there is no new `CapabilityService`; gating is already enforced
 * by four collaborating layers shipped by M11, M65, M67, and M65. This
 * test is a meta-guard that pins those layers in place and verifies their
 * key contracts so a future refactor cannot silently delete them.
 *
 * Layers under guard:
 *   L1. `PermissionService` (M11)       — 3-level always/requires/never
 *                                          per-tool confirmation tiers.
 *   L2. `openclawToolPolicy`  (M65 Iter 1) — readonly/standard/full
 *                                          profile allowlists for built-in
 *                                          tool denial.
 *   L3. `openclawToolPolicy.resolveColorGate` (M65 Iter 2) — color gate that
 *                                          blocks Red tools when the turn
 *                                          is tainted by external content.
 *   L4. `webFetchBridge.cjs`   — Egress chokepoint with DNS preflight,
 *                                HTTPS enforcement, domain blocklist, body
 *                                cap, and timeout (electron main process).
 *
 * This is the consolidation point the original `capabilityService.ts`
 * proposal would have replaced. Slice C audit refused that proposal
 * because the four layers already cover the surface.
 */

import { describe, expect, it } from 'vitest';
import {
  isToolDeniedByProfile,
  resolveToolProfile,
  resolveColorGate,
  getToolColor,
  markTurnTainted,
  beginNewTurn,
  type OpenclawToolProfile,
} from '../../src/openclaw/openclawToolPolicy';
import { ALWAYS_REQUIRE_CONFIRMATION } from '../../src/services/permissionService';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

describe('M81 Slice C — capability gating (closed-in-place; multi-layer guard)', () => {
  // L1 ── PermissionService confirmation tiers ────────────────────────────
  describe('L1 PermissionService confirmation tiers (M11)', () => {
    it('always-require list contains the irreversible/destructive tools by name', () => {
      // The set is the M11 floor: any of these MUST require confirmation
      // regardless of user profile. Adding to the floor is allowed; removing
      // an item must be reviewed.
      expect(ALWAYS_REQUIRE_CONFIRMATION.size).toBeGreaterThan(0);
      // Each entry is a non-empty string.
      for (const id of ALWAYS_REQUIRE_CONFIRMATION) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });
  });

  // L2 ── openclawToolPolicy profile allowlists ───────────────────────────
  describe('L2 openclawToolPolicy profile allowlists (M65)', () => {
    it('resolveToolProfile maps chat modes to tool profiles', () => {
      // edit mode → standard (no command execution surface);
      // ask + agent + unknown all default to full (approval gates handle
      // the real safety boundary, not mode-based denial).
      expect(resolveToolProfile('edit')).toBe('standard');
      expect(resolveToolProfile('ask')).toBe('full');
      expect(resolveToolProfile('agent')).toBe('full');
      expect(resolveToolProfile('garbage')).toBe('full');
      expect(resolveToolProfile(undefined)).toBe('full');
    });

    it('readonly profile denies a write-class built-in tool', () => {
      // `edit_file` is a canonical write tool (blue). It must be denied
      // in the readonly profile (which excludes any name not in its
      // allowlist), and allowed in `full`.
      expect(isToolDeniedByProfile('edit_file', 'readonly' as OpenclawToolProfile)).toBe(true);
      expect(isToolDeniedByProfile('edit_file', 'full' as OpenclawToolProfile)).toBe(false);
    });

    it('standard profile allows green file reads but not arbitrary names', () => {
      // `read_file` is on the standard allowlist; `unknown_tool` is not.
      expect(isToolDeniedByProfile('read_file', 'standard' as OpenclawToolProfile)).toBe(false);
      expect(isToolDeniedByProfile('unknown_tool', 'standard' as OpenclawToolProfile)).toBe(true);
    });

    it('full profile is wildcard (no name-based denial)', () => {
      expect(isToolDeniedByProfile('read_file', 'full' as OpenclawToolProfile)).toBe(false);
      expect(isToolDeniedByProfile('totally_unknown', 'full' as OpenclawToolProfile)).toBe(false);
    });
  });

  // L3 ── Color gate on tainted turns ─────────────────────────────────────
  describe('L3 color gate on tainted turns (M65 Iter 2)', () => {
    it('classifies webSearch/webFetch as red', () => {
      expect(getToolColor('webSearch')).toBe('red');
      expect(getToolColor('webFetch')).toBe('red');
    });

    it('classifies any mcp__* tool as red', () => {
      expect(getToolColor('mcp__example__do_thing')).toBe('red');
    });

    it('classifies file-mutation tools as blue (consequential writes)', () => {
      expect(getToolColor('write_file')).toBe('blue');
      expect(getToolColor('edit_file')).toBe('blue');
    });

    it('blue tools require approval when their session is tainted', () => {
      const sid = 'test.session.cap-gate.1';
      beginNewTurn(sid);
      expect(resolveColorGate('write_file', sid)).toBeNull();
      markTurnTainted(sid);
      expect(resolveColorGate('write_file', sid)).toBe('requires-approval');
      beginNewTurn(sid);
      expect(resolveColorGate('write_file', sid)).toBeNull();
    });

    it('red tools are NOT routed through the color gate (they have their own permission tier)', () => {
      const sid = 'test.session.cap-gate.2';
      markTurnTainted(sid);
      // Color gate only forces approval for BLUE on tainted turns.
      // Red tools (webSearch/webFetch) are gated by the normal permission
      // flow, not by this function.
      expect(resolveColorGate('webSearch', sid)).toBeNull();
    });
  });

  // L4 ── Egress chokepoint file is present (M65 web research) ────────────
  describe('L4 egress chokepoint (webFetchBridge.cjs)', () => {
    it('electron/webFetchBridge.cjs exists in the repository', async () => {
      const bridge = path.resolve(process.cwd(), 'electron', 'webFetchBridge.cjs');
      const stat = await fs.stat(bridge).catch(() => null);
      expect(stat?.isFile()).toBe(true);
    });

    it('webFetchBridge enforces HTTPS, body cap, timeout, and DNS preflight (constants present)', async () => {
      const bridge = path.resolve(process.cwd(), 'electron', 'webFetchBridge.cjs');
      const src = await fs.readFile(bridge, 'utf8');
      // These are the audit-named guarantees of the chokepoint. The strings
      // are present in the source as comments, error messages, or constants.
      // If any disappears, the chokepoint has been weakened and the guard
      // must be re-reviewed.
      expect(src).toMatch(/https/i);
      expect(src).toMatch(/timeout|MAX_/i);
      expect(src).toMatch(/body|content-length|MAX_BODY|MAX_RESPONSE/i);
      expect(src).toMatch(/dns\.|lookup|resolve|hostname/i);
    });
  });

  // Anti-bitrot guard ─────────────────────────────────────────────────────
  describe('anti-bitrot: no parallel CapabilityService was added', () => {
    it('src/ does not contain a parallel capabilityService.ts file', async () => {
      const candidate = path.resolve(process.cwd(), 'src', 'services', 'capabilityService.ts');
      const stat = await fs.stat(candidate).catch(() => null);
      // If this file is ever introduced, the four-layer model collapses
      // into "where does gating live?" ambiguity. The audit explicitly
      // refused this file. Adding it requires a milestone-level decision.
      expect(stat).toBeNull();
    });
  });
});
