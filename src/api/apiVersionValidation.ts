// apiVersionValidation.ts — API version compatibility checking
//
// Implements `isCompatible(engineRequirement, shellVersion)` which checks
// if a tool's declared `engines.parallx` requirement is compatible with
// the running shell version. Supports ^, ~, >=, exact, and * syntax.
//
// This is the standalone version validation module used by the API boundary
// and tool activation system. The validator in toolValidator.ts uses similar
// logic internally; this module exports it as a first-class API.

import { PARALLX_VERSION } from '../tools/toolValidator.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VersionCompatibilityResult {
  /** Whether the versions are compatible. */
  readonly compatible: boolean;
  /** Human-readable reason if not compatible. */
  readonly reason: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a tool's engine requirement is compatible with a shell version.
 *
 * Supports:
 * - `*` — any version
 * - `^x.y.z` — compatible within major version (major must match, minor.patch >=)
 * - `~x.y.z` — compatible within minor version (major.minor must match, patch >=)
 * - `>=x.y.z` — current must be >= required
 * - `x.y.z` — exact or higher
 *
 * @param engineRequirement The `engines.parallx` value from the manifest.
 * @param shellVersion The current shell version. Defaults to `PARALLX_VERSION`.
 */
export function isCompatible(
  engineRequirement: string,
  shellVersion: string = PARALLX_VERSION,
): VersionCompatibilityResult {
  // Wildcard — always compatible
  if (engineRequirement === '*') {
    return { compatible: true, reason: '' };
  }

  const currentParts = _parseSemver(shellVersion);
  if (!currentParts) {
    return { compatible: false, reason: `Cannot parse shell version: ${shellVersion}` };
  }

  // Determine prefix
  let prefix = '';
  let versionStr = engineRequirement;

  if (engineRequirement.startsWith('^')) {
    prefix = '^';
    versionStr = engineRequirement.slice(1);
  } else if (engineRequirement.startsWith('~')) {
    prefix = '~';
    versionStr = engineRequirement.slice(1);
  } else if (engineRequirement.startsWith('>=')) {
    prefix = '>=';
    versionStr = engineRequirement.slice(2);
  }

  const requiredParts = _parseSemver(versionStr);
  if (!requiredParts) {
    return { compatible: false, reason: `Cannot parse required version: ${engineRequirement}` };
  }

  const [curMaj, curMin] = currentParts;
  const [reqMaj, reqMin] = requiredParts;

  switch (prefix) {
    case '^':
      // Major must match, current >= required
      if (curMaj !== reqMaj) {
        return { compatible: false, reason: `Requires Parallx ^${versionStr} but shell is ${shellVersion} (major mismatch)` };
      }
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ^${versionStr} but shell is ${shellVersion}` };
      }
      return { compatible: true, reason: '' };

    case '~':
      // Major and minor must match, current >= required
      if (curMaj !== reqMaj || curMin !== reqMin) {
        return { compatible: false, reason: `Requires Parallx ~${versionStr} but shell is ${shellVersion} (minor mismatch)` };
      }
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ~${versionStr} but shell is ${shellVersion}` };
      }
      return { compatible: true, reason: '' };

    case '>=':
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx >=${versionStr} but shell is ${shellVersion}` };
      }
      return { compatible: true, reason: '' };

    default:
      // Exact or higher
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ${versionStr} but shell is ${shellVersion}` };
      }
      return { compatible: true, reason: '' };
  }
}

/**
 * The current shell version exposed via `parallx.env.appVersion`.
 */
export { PARALLX_VERSION } from '../tools/toolValidator.js';

// ─── Internal ────────────────────────────────────────────────────────────────

function _parseSemver(version: string): [number, number, number] | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function _compareSemver(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}
