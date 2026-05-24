// parallxConfigService.test.ts — pin .parallx/config.json loader + merger.
//
// Pins:
//   - DEFAULT_CONFIG aggregates all section defaults.
//   - mergeConfig: missing sections → defaults; unknown keys silently dropped.
//   - mergeConfig: type-mismatched scalar override → kept default.
//   - mergeConfig: arrays filtered to string-only.
//   - mergeConfig: null override allowed when default is null (contextLength).
//   - mergeConfig: null override allowed when default is a non-object scalar.
//   - ParallxConfigService.load with no fs → DEFAULT_CONFIG, isLoaded=true, no event.
//   - ParallxConfigService.load file missing → DEFAULT_CONFIG, fires event.
//   - ParallxConfigService.load valid JSON → merged config + event.
//   - ParallxConfigService.load JSONC (// and /* */ comments + trailing commas) parses.
//   - ParallxConfigService.load malformed JSON → DEFAULT_CONFIG (no throw).
//   - ParallxConfigService.load non-object JSON → DEFAULT_CONFIG.
//   - ParallxConfigService.get('agent.maxIterations') returns value; unknown path → undefined.
//   - Typed accessors (model/agent/etc.) reflect current config.

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_PERMISSIONS,
  DEFAULT_INDEXING,
  mergeConfig,
  ParallxConfigService,
  type IConfigFileSystem,
  type IParallxConfig,
} from '../../src/services/parallxConfigService';

describe('mergeConfig', () => {
  it('empty input returns DEFAULT_CONFIG-shaped object', () => {
    const r = mergeConfig({});
    expect(r.model).toEqual(DEFAULT_MODEL_CONFIG);
    expect(r.agent).toEqual(DEFAULT_AGENT_CONFIG);
    expect(r.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(r.indexing).toEqual(DEFAULT_INDEXING);
  });

  it('unknown top-level sections silently ignored', () => {
    const r = mergeConfig({ frobnicator: { x: 1 } } as any);
    expect((r as any).frobnicator).toBeUndefined();
  });

  it('partial section merges over defaults', () => {
    const r = mergeConfig({ agent: { maxIterations: 25 } });
    expect(r.agent.maxIterations).toBe(25);
    expect(r.agent.autoRag).toBe(DEFAULT_AGENT_CONFIG.autoRag);
  });

  it('unknown keys inside a section are dropped', () => {
    const r = mergeConfig({ agent: { maxIterations: 25, mystery: 99 } as any });
    expect((r.agent as any).mystery).toBeUndefined();
  });

  it('type-mismatched scalar override keeps the default', () => {
    const r = mergeConfig({ agent: { maxIterations: 'not-a-number' as any } });
    expect(r.agent.maxIterations).toBe(DEFAULT_AGENT_CONFIG.maxIterations);
  });

  it('array overrides filtered to string entries only', () => {
    const r = mergeConfig({ indexing: { excludePatterns: ['*.tmp', 123 as any, null as any, 'build/'] } });
    expect(r.indexing.excludePatterns).toEqual(['*.tmp', 'build/']);
  });

  it('null override allowed when default is null (model.contextLength)', () => {
    const r = mergeConfig({ model: { contextLength: null } });
    expect(r.model.contextLength).toBeNull();
  });

  it('null override accepted when default is a scalar (non-object)', () => {
    // _mergeSection allows null when default is non-object — pin that branch.
    const r = mergeConfig({ agent: { maxIterations: null as any } });
    expect(r.agent.maxIterations).toBeNull();
  });

  it('section that is an array (not object) → kept default', () => {
    const r = mergeConfig({ agent: [1, 2, 3] as any });
    expect(r.agent).toEqual(DEFAULT_AGENT_CONFIG);
  });

  it('section that is null → kept default', () => {
    const r = mergeConfig({ agent: null as any });
    expect(r.agent).toEqual(DEFAULT_AGENT_CONFIG);
  });
});

function mkFs(over: Partial<IConfigFileSystem> & { _files?: Record<string, string> } = {}): IConfigFileSystem {
  const files = over._files ?? {};
  return {
    exists: vi.fn(async (p: string) => p in files),
    readFile: vi.fn(async (p: string) => files[p]),
    ...over,
  } as IConfigFileSystem;
}

describe('ParallxConfigService — load', () => {
  it('no filesystem → DEFAULT_CONFIG, isLoaded=true, no event', async () => {
    const svc = new ParallxConfigService();
    const events: IParallxConfig[] = [];
    svc.onDidChangeConfig((e) => events.push(e));
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(svc.config).toEqual(DEFAULT_CONFIG);
    expect(events).toEqual([]);
  });

  it('file missing → DEFAULT_CONFIG, NO event fired', async () => {
    // Pin actual current behavior: early-return when !exists skips the
    // onDidChangeConfig.fire() at the end of load().
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: {} }));
    const events: IParallxConfig[] = [];
    svc.onDidChangeConfig((e) => events.push(e));
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(svc.config).toEqual(DEFAULT_CONFIG);
    expect(events).toEqual([]);
  });

  it('valid JSON → merged config + event fires', async () => {
    const json = JSON.stringify({ agent: { maxIterations: 42 } });
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: { '.parallx/config.json': json } }));
    const events: IParallxConfig[] = [];
    svc.onDidChangeConfig((e) => events.push(e));
    await svc.load();
    expect(svc.config.agent.maxIterations).toBe(42);
    expect(events.length).toBe(1);
    expect(events[0].agent.maxIterations).toBe(42);
  });

  it('JSONC: strips // line comments, /* block */ comments, and trailing commas', async () => {
    const jsonc = `{
      // top-level comment
      "agent": {
        /* inline block */
        "maxIterations": 7,
      },
    }`;
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: { '.parallx/config.json': jsonc } }));
    await svc.load();
    expect(svc.config.agent.maxIterations).toBe(7);
  });

  it('malformed JSON → DEFAULT_CONFIG (no throw)', async () => {
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: { '.parallx/config.json': '{ this is not json' } }));
    await svc.load();
    expect(svc.config).toEqual(DEFAULT_CONFIG);
  });

  it('non-object JSON (array) → DEFAULT_CONFIG', async () => {
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: { '.parallx/config.json': '[1,2,3]' } }));
    await svc.load();
    expect(svc.config).toEqual(DEFAULT_CONFIG);
  });

  it('exists() throwing is caught → DEFAULT_CONFIG, isLoaded=true', async () => {
    const fs: IConfigFileSystem = {
      exists: async () => { throw new Error('boom'); },
      readFile: async () => '',
    };
    const svc = new ParallxConfigService();
    svc.setFileSystem(fs);
    await svc.load();
    expect(svc.isLoaded).toBe(true);
    expect(svc.config).toEqual(DEFAULT_CONFIG);
  });
});

describe('ParallxConfigService — accessors + get()', () => {
  it('typed accessors reflect current config', async () => {
    const svc = new ParallxConfigService();
    svc.setFileSystem(mkFs({ _files: { '.parallx/config.json': JSON.stringify({ permissions: { fileWrite: 'always-allow' } }) } }));
    await svc.load();
    expect(svc.permissions.fileWrite).toBe('always-allow');
    expect(svc.model).toEqual(DEFAULT_MODEL_CONFIG);
    expect(svc.agent).toEqual(DEFAULT_AGENT_CONFIG);
    expect(svc.contextBudget).toBeDefined();
    expect(svc.indexing).toEqual(DEFAULT_INDEXING);
  });

  it('get(dot-path) returns value', () => {
    const svc = new ParallxConfigService();
    expect(svc.get('agent.maxIterations')).toBe(DEFAULT_AGENT_CONFIG.maxIterations);
    expect(svc.get('model.chat')).toBe(DEFAULT_MODEL_CONFIG.chat);
  });

  it('get(unknown-path) returns undefined', () => {
    const svc = new ParallxConfigService();
    expect(svc.get('missing.key')).toBeUndefined();
    expect(svc.get('agent.nope.deep')).toBeUndefined();
  });

  it('CONFIG_PATH constant is ".parallx/config.json"', () => {
    expect(ParallxConfigService.CONFIG_PATH).toBe('.parallx/config.json');
  });
});
