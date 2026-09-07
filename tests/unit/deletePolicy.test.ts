/**
 * The delete policy: two workspace settings read without throwing and pushed
 * to the main-process delete handler as one object.
 */
import { describe, it, expect } from 'vitest';
import {
  DELETE_TO_RECYCLE_BIN_SETTING,
  ERASER_PATH_SETTING,
  DEFAULT_ERASER_PATH,
  registerDeletePolicySettings,
  readDeletePolicy,
  isDeletePolicySetting,
  applyDeletePolicy,
} from '../../src/services/deletePolicy';

function fakeRegistry(initial?: Record<string, unknown>) {
  const schemas = new Map<string, { default: unknown }>();
  const values = new Map<string, unknown>(Object.entries(initial ?? {}));
  let registrations = 0;
  return {
    registrations: () => registrations,
    register(schema: { key: string; default: unknown }) { registrations++; schemas.set(schema.key, schema); },
    getSchema(key: string) { return schemas.get(key); },
    getValue<T>(key: string): T {
      const s = schemas.get(key);
      if (!s) throw new Error(`unregistered: ${key}`);
      return (values.has(key) ? values.get(key) : s.default) as T;
    },
    set(key: string, v: unknown) { values.set(key, v); },
  };
}

describe('deletePolicy', () => {
  it('registers both settings once', () => {
    const reg = fakeRegistry();
    registerDeletePolicySettings(reg);
    registerDeletePolicySettings(reg);
    expect(reg.registrations()).toBe(2);
    expect(reg.getSchema(DELETE_TO_RECYCLE_BIN_SETTING)).toBeTruthy();
    expect(reg.getSchema(ERASER_PATH_SETTING)).toBeTruthy();
  });

  it('defaults to the Recycle Bin and the standard Eraser install', () => {
    expect(readDeletePolicy(fakeRegistry())).toEqual({ recycleBin: true, eraserPath: DEFAULT_ERASER_PATH });
    expect(readDeletePolicy(undefined)).toEqual({ recycleBin: true, eraserPath: DEFAULT_ERASER_PATH });
  });

  it('reads the workspace values and trims the Eraser path', () => {
    const reg = fakeRegistry({ [DELETE_TO_RECYCLE_BIN_SETTING]: false, [ERASER_PATH_SETTING]: '  D:\\Tools\\Eraser.exe ' });
    expect(readDeletePolicy(reg)).toEqual({ recycleBin: false, eraserPath: 'D:\\Tools\\Eraser.exe' });
  });

  it('knows which setting keys it owns', () => {
    expect(isDeletePolicySetting(DELETE_TO_RECYCLE_BIN_SETTING)).toBe(true);
    expect(isDeletePolicySetting(ERASER_PATH_SETTING)).toBe(true);
    expect(isDeletePolicySetting('workspace.sealed')).toBe(false);
  });

  it('pushes the policy to the sink and survives a missing or failing sink', async () => {
    const reg = fakeRegistry({ [DELETE_TO_RECYCLE_BIN_SETTING]: false });
    const seen: unknown[] = [];
    const policy = applyDeletePolicy(reg, { setDeletePolicy: async (p) => { seen.push(p); } });
    expect(policy.recycleBin).toBe(false);
    expect(seen).toEqual([{ recycleBin: false, eraserPath: DEFAULT_ERASER_PATH }]);
    expect(() => applyDeletePolicy(reg, undefined)).not.toThrow();
    expect(() => applyDeletePolicy(reg, null)).not.toThrow();
    expect(() => applyDeletePolicy(reg, { setDeletePolicy: () => Promise.reject(new Error('no ipc')) })).not.toThrow();
    await Promise.resolve();
  });
});
