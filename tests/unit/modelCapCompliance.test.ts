// modelCapCompliance.test.ts — no tool or extension puts its own limit on the model.
//
// The house rule (CLAUDE.md, "One route to the model"): no call sets its own
// token cap or reasoning budget. A cap counts the thinking too, and a
// thinking model then answers nothing or a cut-off line; that broke Act, and
// it was found again in Study on 2026-11-16, where every generation, check
// and explain call carried one. The owner had said it more than once; the
// rule lived only as a sentence. This is the check.
//
// The only limits are one the user set (passed as `userLimit` through a
// tool's one route) and the core's own guard against a runaway. So: in
// every extension and every built-in tool, no line may set a token cap or a
// thinking budget, unless it is the line that passes the user's own limit
// on. The core's chat engine, its providers and its settings are where the
// user's limit and the guard live, and are not read here.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
/** A token cap or a thinking budget being set: as an option (`maxTokens: 800`) or by assignment. */
const SETS_A_LIMIT = /\b(maxTokens|max_tokens|maxOutputTokens|max_output_tokens|num_predict|budget_tokens|thinkingBudget|reasoningBudget|thinkTokens)\b\s*[:=](?!=)/;
/** The one way a limit may be passed on: it is the user's own. */
const THE_USERS_OWN = /\buserLimit\b/;
/** Where the user's limit and the core's guard live. */
const CORE_ROUTE = ['src/built-in/chat/providers/'];

function files(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // An extension's own test drivers (ext/*/test) stand in for the provider or drive a model for an experiment: not the app.
    if (name === 'node_modules' || name === 'dist' || name === 'test' || name === 'tests' || name.startsWith('.')) continue;
    const at = join(dir, name);
    if (statSync(at).isDirectory()) out.push(...files(at, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(at);
  }
  return out;
}

function limitsSetIn(paths: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of paths) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (CORE_ROUTE.some((p) => rel.startsWith(p))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (SETS_A_LIMIT.test(code) && !THE_USERS_OWN.test(code)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return found;
}

describe('no tool or extension limits the model itself', () => {
  it('no extension sets a token cap or a thinking budget', () => {
    expect(limitsSetIn(files(join(ROOT, 'ext'), ['.js', '.mjs', '.ts'])), 'An extension set its own limit on the model. Remove it: the only limits are one the user set and the core\'s guard.').toEqual([]);
  });

  it('no built-in tool sets a token cap or a thinking budget', () => {
    expect(limitsSetIn(files(join(ROOT, 'src', 'built-in'), ['.ts'])), 'A built-in tool set its own limit on the model. Remove it: the only limits are one the user set and the core\'s guard.').toEqual([]);
  });

  it('the check sees a cap when there is one, and lets the user\'s own limit through', () => {
    expect(SETS_A_LIMIT.test('const options = { temperature, maxTokens: 800 };')).toBe(true);
    expect(SETS_A_LIMIT.test('options.num_predict = 512;')).toBe(true);
    expect(SETS_A_LIMIT.test('thinking: { type: "enabled", budget_tokens: 4096 }')).toBe(true);
    expect(SETS_A_LIMIT.test('if (opts.maxTokens === 0) return;')).toBe(false);
    expect(SETS_A_LIMIT.test('lmCalls.push({ kind, maxTokens })')).toBe(false);
    expect(THE_USERS_OWN.test('if (Number(userLimit) > 0) out.maxTokens = Number(userLimit);')).toBe(true);
  });
});
