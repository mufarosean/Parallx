// toolValidator.ts — tool manifest validation
//
// Validates a parsed manifest object against the IToolManifest schema.
// No heavy JSON-schema library — focused, synchronous validation logic.

import {
  CURRENT_MANIFEST_VERSION,
  SUPPORTED_ACTIVATION_PREFIXES,
  type IToolManifest,
  type IManifestContributions,
} from './toolManifest.js';

// ─── Current Shell Version ───────────────────────────────────────────────────

/**
 * The current Parallx shell version. Used for engine compatibility checks.
 * In production this would be derived from package.json at build time.
 */
export const PARALLX_VERSION = '0.2.0';

// ─── Validation Result ───────────────────────────────────────────────────────

export interface ValidationError {
  /** Dot-path to the offending field (e.g., 'contributes.views[0].id'). */
  readonly path: string;
  /** Human-readable error message. */
  readonly message: string;
}

interface ValidationWarning {
  /** Dot-path to the field that triggered the warning. */
  readonly path: string;
  /** Human-readable warning message. */
  readonly message: string;
}

export interface ValidationResult {
  /** Whether the manifest is valid (no errors). Warnings don't fail validation. */
  readonly valid: boolean;
  /** Validation errors (each prevents registration). */
  readonly errors: readonly ValidationError[];
  /** Validation warnings (informational, don't prevent registration). */
  readonly warnings: readonly ValidationWarning[];
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Validate a parsed manifest object.
 * Returns structured errors and warnings.
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (manifest === null || manifest === undefined || typeof manifest !== 'object') {
    errors.push({ path: '', message: 'Manifest must be a non-null object' });
    return { valid: false, errors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // ── manifestVersion ──
  _requireField(m, 'manifestVersion', 'number', errors);
  if (typeof m.manifestVersion === 'number' && m.manifestVersion !== CURRENT_MANIFEST_VERSION) {
    errors.push({
      path: 'manifestVersion',
      message: `Unsupported manifest version ${m.manifestVersion}; expected ${CURRENT_MANIFEST_VERSION}`,
    });
  }

  // ── Identity fields ──
  _requireNonEmptyString(m, 'id', errors);
  _requireNonEmptyString(m, 'name', errors);
  _requireNonEmptyString(m, 'version', errors);
  _requireNonEmptyString(m, 'publisher', errors);

  // Validate id format: alphanumeric, dots, hyphens, underscores
  if (typeof m.id === 'string' && m.id.length > 0) {
    if (!/^[a-zA-Z0-9._-]+$/.test(m.id)) {
      errors.push({ path: 'id', message: 'id must contain only alphanumeric characters, dots, hyphens, and underscores' });
    }
  }

  // Validate version is semver-like
  if (typeof m.version === 'string' && m.version.length > 0) {
    if (!/^\d+\.\d+\.\d+/.test(m.version)) {
      errors.push({ path: 'version', message: 'version must be a semver string (e.g., "1.0.0")' });
    }
  }

  // ── description (optional) ──
  if (m.description !== undefined && typeof m.description !== 'string') {
    errors.push({ path: 'description', message: 'description must be a string' });
  }

  // ── main ──
  _requireNonEmptyString(m, 'main', errors);

  // ── activationEvents ──
  if (!Array.isArray(m.activationEvents)) {
    errors.push({ path: 'activationEvents', message: 'activationEvents must be an array' });
  } else {
    for (let i = 0; i < m.activationEvents.length; i++) {
      const event = m.activationEvents[i];
      if (typeof event !== 'string' || event.length === 0) {
        errors.push({ path: `activationEvents[${i}]`, message: 'must be a non-empty string' });
        continue;
      }
      if (!_isValidActivationEvent(event)) {
        errors.push({
          path: `activationEvents[${i}]`,
          message: `Unsupported activation event: "${event}". Supported: *, onStartupFinished, onCommand:<id>, onView:<id>`,
        });
      }
    }
  }

  // ── engines ──
  if (m.engines === undefined || m.engines === null || typeof m.engines !== 'object') {
    errors.push({ path: 'engines', message: 'engines must be an object with a "parallx" field' });
  } else {
    const engines = m.engines as Record<string, unknown>;
    if (typeof engines.parallx !== 'string' || engines.parallx.length === 0) {
      errors.push({ path: 'engines.parallx', message: 'engines.parallx must be a non-empty version string' });
    } else {
      // Basic compatibility check: parse the required version and compare
      const compat = _checkVersionCompatibility(engines.parallx as string, PARALLX_VERSION);
      if (!compat.compatible) {
        errors.push({ path: 'engines.parallx', message: compat.reason });
      }
    }
  }

  // ── contributes (optional) ──
  if (m.contributes !== undefined) {
    if (typeof m.contributes !== 'object' || m.contributes === null) {
      errors.push({ path: 'contributes', message: 'contributes must be an object' });
    } else {
      _validateContributions(m.contributes as Record<string, unknown>, errors, warnings);
    }
  }

  // ── Warn on unknown top-level fields (forward compatibility) ──
  const knownFields = new Set([
    'manifestVersion', 'id', 'name', 'version', 'publisher', 'description',
    'main', 'activationEvents', 'contributes', 'engines',
  ]);
  for (const key of Object.keys(m)) {
    if (!knownFields.has(key)) {
      warnings.push({ path: key, message: `Unknown field "${key}" — will be ignored` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Contributions Validation ────────────────────────────────────────────────

function _validateContributions(
  contributes: Record<string, unknown>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const knownPoints = new Set(['views', 'viewContainers', 'commands', 'configuration', 'menus', 'keybindings']);

  for (const key of Object.keys(contributes)) {
    if (!knownPoints.has(key)) {
      warnings.push({ path: `contributes.${key}`, message: `Unknown contribution point "${key}" — will be ignored` });
    }
  }

  // ── views ──
  if (contributes.views !== undefined) {
    if (!Array.isArray(contributes.views)) {
      errors.push({ path: 'contributes.views', message: 'must be an array' });
    } else {
      for (let i = 0; i < contributes.views.length; i++) {
        _validateViewDescriptor(contributes.views[i], `contributes.views[${i}]`, errors);
      }
    }
  }

  // ── viewContainers ──
  if (contributes.viewContainers !== undefined) {
    if (!Array.isArray(contributes.viewContainers)) {
      errors.push({ path: 'contributes.viewContainers', message: 'must be an array' });
    } else {
      for (let i = 0; i < contributes.viewContainers.length; i++) {
        _validateViewContainerDescriptor(contributes.viewContainers[i], `contributes.viewContainers[${i}]`, errors);
      }
    }
  }

  // ── commands ──
  if (contributes.commands !== undefined) {
    if (!Array.isArray(contributes.commands)) {
      errors.push({ path: 'contributes.commands', message: 'must be an array' });
    } else {
      for (let i = 0; i < contributes.commands.length; i++) {
        _validateCommandDescriptor(contributes.commands[i], `contributes.commands[${i}]`, errors);
      }
    }
  }

  // ── configuration ──
  if (contributes.configuration !== undefined) {
    if (!Array.isArray(contributes.configuration)) {
      errors.push({ path: 'contributes.configuration', message: 'must be an array' });
    } else {
      for (let i = 0; i < contributes.configuration.length; i++) {
        _validateConfigurationDescriptor(contributes.configuration[i], `contributes.configuration[${i}]`, errors);
      }
    }
  }

  // ── keybindings ──
  if (contributes.keybindings !== undefined) {
    if (!Array.isArray(contributes.keybindings)) {
      errors.push({ path: 'contributes.keybindings', message: 'must be an array' });
    } else {
      for (let i = 0; i < contributes.keybindings.length; i++) {
        const kb = contributes.keybindings[i];
        const p = `contributes.keybindings[${i}]`;
        if (!_isObject(kb)) { errors.push({ path: p, message: 'must be an object' }); continue; }
        _requireNonEmptyStringAt(kb as Record<string, unknown>, 'command', p, errors);
        _requireNonEmptyStringAt(kb as Record<string, unknown>, 'key', p, errors);
      }
    }
  }

  // ── menus ──
  if (contributes.menus !== undefined) {
    if (!_isObject(contributes.menus)) {
      errors.push({ path: 'contributes.menus', message: 'must be an object' });
    } else {
      const menus = contributes.menus as Record<string, unknown>;
      for (const menuId of Object.keys(menus)) {
        const items = menus[menuId];
        if (!Array.isArray(items)) {
          errors.push({ path: `contributes.menus.${menuId}`, message: 'must be an array of menu items' });
          continue;
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const p = `contributes.menus.${menuId}[${i}]`;
          if (!_isObject(item)) { errors.push({ path: p, message: 'must be an object' }); continue; }
          _requireNonEmptyStringAt(item as Record<string, unknown>, 'command', p, errors);
        }
      }
    }
  }
}

function _validateViewDescriptor(value: unknown, path: string, errors: ValidationError[]): void {
  if (!_isObject(value)) { errors.push({ path, message: 'must be an object' }); return; }
  const v = value as Record<string, unknown>;
  _requireNonEmptyStringAt(v, 'id', path, errors);
  _requireNonEmptyStringAt(v, 'name', path, errors);
  if (v.icon !== undefined && typeof v.icon !== 'string') {
    errors.push({ path: `${path}.icon`, message: 'must be a string' });
  }
  if (v.defaultContainerId !== undefined && typeof v.defaultContainerId !== 'string') {
    errors.push({ path: `${path}.defaultContainerId`, message: 'must be a string' });
  }
  if (v.when !== undefined && typeof v.when !== 'string') {
    errors.push({ path: `${path}.when`, message: 'must be a string' });
  }
}

function _validateViewContainerDescriptor(value: unknown, path: string, errors: ValidationError[]): void {
  if (!_isObject(value)) { errors.push({ path, message: 'must be an object' }); return; }
  const v = value as Record<string, unknown>;
  _requireNonEmptyStringAt(v, 'id', path, errors);
  _requireNonEmptyStringAt(v, 'title', path, errors);
  const validLocations = ['sidebar', 'panel', 'auxiliaryBar'];
  if (typeof v.location !== 'string' || !validLocations.includes(v.location)) {
    errors.push({ path: `${path}.location`, message: `must be one of: ${validLocations.join(', ')}` });
  }
}

function _validateCommandDescriptor(value: unknown, path: string, errors: ValidationError[]): void {
  if (!_isObject(value)) { errors.push({ path, message: 'must be an object' }); return; }
  const v = value as Record<string, unknown>;
  _requireNonEmptyStringAt(v, 'id', path, errors);
  _requireNonEmptyStringAt(v, 'title', path, errors);
  if (v.category !== undefined && typeof v.category !== 'string') {
    errors.push({ path: `${path}.category`, message: 'must be a string' });
  }
}

function _validateConfigurationDescriptor(value: unknown, path: string, errors: ValidationError[]): void {
  if (!_isObject(value)) { errors.push({ path, message: 'must be an object' }); return; }
  const v = value as Record<string, unknown>;
  _requireNonEmptyStringAt(v, 'title', path, errors);
  if (!_isObject(v.properties)) {
    errors.push({ path: `${path}.properties`, message: 'must be an object' });
    return;
  }
  const props = v.properties as Record<string, unknown>;
  const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
  for (const propKey of Object.keys(props)) {
    const prop = props[propKey];
    const pp = `${path}.properties.${propKey}`;
    if (!_isObject(prop)) { errors.push({ path: pp, message: 'must be an object' }); continue; }
    const p = prop as Record<string, unknown>;
    if (typeof p.type !== 'string' || !validTypes.includes(p.type)) {
      errors.push({ path: `${pp}.type`, message: `must be one of: ${validTypes.join(', ')}` });
    }
  }
}

// ─── Version Compatibility ───────────────────────────────────────────────────

interface VersionCheckResult {
  compatible: boolean;
  reason: string;
}

/**
 * Basic semver range compatibility check.
 *
 * Supported formats:
 * - `"^X.Y.Z"` — compatible if shell major matches and shell >= X.Y.Z
 * - `"~X.Y.Z"` — compatible if shell major.minor matches and shell >= X.Y.Z
 * - `">=X.Y.Z"` — compatible if shell >= X.Y.Z
 * - `"X.Y.Z"` — compatible if shell >= X.Y.Z (exact or higher)
 * - `"*"` — always compatible
 */
function _checkVersionCompatibility(required: string, current: string): VersionCheckResult {
  if (required === '*') {
    return { compatible: true, reason: '' };
  }

  const currentParts = _parseSemver(current);
  if (!currentParts) {
    return { compatible: false, reason: `Cannot parse current version: ${current}` };
  }

  // Strip prefix
  let prefix = '';
  let versionStr = required;
  if (required.startsWith('^')) { prefix = '^'; versionStr = required.slice(1); }
  else if (required.startsWith('~')) { prefix = '~'; versionStr = required.slice(1); }
  else if (required.startsWith('>=')) { prefix = '>='; versionStr = required.slice(2); }

  const requiredParts = _parseSemver(versionStr);
  if (!requiredParts) {
    return { compatible: false, reason: `Cannot parse required version: ${required}` };
  }

  const [curMaj, curMin, curPatch] = currentParts;
  const [reqMaj, reqMin, reqPatch] = requiredParts;

  switch (prefix) {
    case '^':
      // Major must match, current >= required
      if (curMaj !== reqMaj) {
        return { compatible: false, reason: `Requires Parallx ^${versionStr} but shell is ${current} (major mismatch)` };
      }
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ^${versionStr} but shell is ${current}` };
      }
      return { compatible: true, reason: '' };

    case '~':
      // Major and minor must match, current >= required
      if (curMaj !== reqMaj || curMin !== reqMin) {
        return { compatible: false, reason: `Requires Parallx ~${versionStr} but shell is ${current} (minor mismatch)` };
      }
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ~${versionStr} but shell is ${current}` };
      }
      return { compatible: true, reason: '' };

    case '>=':
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx >=${versionStr} but shell is ${current}` };
      }
      return { compatible: true, reason: '' };

    default:
      // Exact or higher
      if (_compareSemver(currentParts, requiredParts) < 0) {
        return { compatible: false, reason: `Requires Parallx ${versionStr} but shell is ${current}` };
      }
      return { compatible: true, reason: '' };
  }
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function _requireField(obj: Record<string, unknown>, key: string, type: string, errors: ValidationError[]): void {
  if (!(key in obj)) {
    errors.push({ path: key, message: `Required field "${key}" is missing` });
  } else if (typeof obj[key] !== type) {
    errors.push({ path: key, message: `"${key}" must be of type ${type}` });
  }
}

function _requireNonEmptyString(obj: Record<string, unknown>, key: string, errors: ValidationError[]): void {
  if (!(key in obj) || typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
    errors.push({ path: key, message: `"${key}" must be a non-empty string` });
  }
}

function _requireNonEmptyStringAt(obj: Record<string, unknown>, key: string, parentPath: string, errors: ValidationError[]): void {
  if (!(key in obj) || typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
    errors.push({ path: `${parentPath}.${key}`, message: 'must be a non-empty string' });
  }
}

function _isValidActivationEvent(event: string): boolean {
  return SUPPORTED_ACTIVATION_PREFIXES.some(prefix => {
    if (prefix === '*' || prefix === 'onStartupFinished') {
      return event === prefix;
    }
    // For prefixed events like 'onCommand:', the event must start with the prefix
    // and have content after the colon
    return event.startsWith(prefix) && event.length > prefix.length;
  });
}
