// commandRules.test.ts — shell-command permission rules: read-only
// commands never prompt, an allowed command FAMILY runs without a prompt,
// compound commands need every segment allowed, redirections disqualify,
// the blocklist and Careful still win, autonomous turns still defer.

import { describe, expect, it } from 'vitest';
import {
  commandMatchesRules,
  commandPrefix,
  commandSegments,
  isReadOnlyCommand,
} from '../../src/services/commandRules';
import { PermissionService } from '../../src/services/permissionService';
import { PolicyDecisionPoint } from '../../src/services/policyDecisionPoint';

describe('commandRules (pure)', () => {
  it('splits compound commands and names the family', () => {
    expect(commandSegments('npm test && git status | head')).toEqual([['npm', 'test'], ['git', 'status'], ['head']]);
    expect(commandPrefix('  ./gradlew build')).toBe('gradlew');
    expect(commandPrefix('NPM run dev')).toBe('npm');
    expect(commandPrefix('')).toBe('');
  });

  it('read-only commands are recognised, alone or piped together', () => {
    expect(isReadOnlyCommand('git status')).toBe(true);
    expect(isReadOnlyCommand('git status --short')).toBe(true);
    expect(isReadOnlyCommand('ls -la | head')).toBe(true);
    expect(isReadOnlyCommand('cat package.json')).toBe(true);
    expect(isReadOnlyCommand('git push')).toBe(false);
    expect(isReadOnlyCommand('npm install')).toBe(false);
    expect(isReadOnlyCommand('ls && rm -rf build')).toBe(false); // every segment must qualify
  });

  it('redirections and substitutions disqualify a command outright', () => {
    expect(isReadOnlyCommand('cat a.txt > b.txt')).toBe(false);
    expect(isReadOnlyCommand('echo $(rm -rf x)')).toBe(false);
    expect(isReadOnlyCommand('git diff --output=x')).toBe(false);
    expect(commandMatchesRules('npm test > out.txt', new Set(['npm']))).toBe(false);
  });

  it('a family rule covers the family, and only whole compound commands', () => {
    const rules = new Set(['npm']);
    expect(commandMatchesRules('npm run build', rules)).toBe(true);
    expect(commandMatchesRules('npm test && npm run lint', rules)).toBe(true);
    expect(commandMatchesRules('npm test && rm -rf dist', rules)).toBe(false);
    expect(commandMatchesRules('git status', new Set())).toBe(false);
  });
});

describe('PermissionService command rules', () => {
  it('persists families in permissions.json alongside tool overrides', () => {
    const svc = new PermissionService();
    svc.addCommandRule('npm run build', 'persistent');
    svc.addCommandRule('git commit -m x', 'session');
    expect(svc.isCommandAllowed('npm test')).toBe(true);
    expect(svc.isCommandAllowed('git commit -m y')).toBe(true); // session rule
    const json = svc.serializeOverrides();
    const other = new PermissionService();
    other.loadPersistentOverrides(json);
    expect(other.getCommandRules()).toEqual(['npm']); // session rules never persist
    expect(other.isCommandAllowed('git commit -m y')).toBe(false);
    expect(other.isCommandAllowed('git status')).toBe(true); // read-only needs no rule
  });

  it('the shell card grants a FAMILY, never the whole tool', async () => {
    const svc = new PermissionService();
    svc.setConfirmationHandler(async () => 'always-allow');
    const ok = await svc.confirmToolInvocation('terminal_run_command', 'shell', { command: 'npm run build' }, 'requires-approval');
    expect(ok).toBe(true);
    expect(svc.getCommandRules()).toEqual(['npm']);
    expect(svc.getPersistentOverrides().has('terminal_run_command')).toBe(false);
    // The belt still holds for the tool as a whole.
    expect(svc.checkPermission('terminal_run_command', 'requires-approval').autoApproved).toBe(false);
  });
});

describe('PDP shell rules (Rule 5b)', () => {
  const setup = () => {
    const perms = new PermissionService();
    const pdp = new PolicyDecisionPoint();
    pdp.setPermissionService(perms);
    return { perms, pdp };
  };
  const shell = (command: string, sessionId = 'chat-1') => ({
    caller: { kind: 'built-in' as const, id: 'test' },
    tool: { name: 'terminal_run_command', defaultLevel: 'requires-approval' as const },
    args: { command },
    sessionId,
  });

  it('a read-only command runs without a prompt; an unknown one still asks', () => {
    const { pdp } = setup();
    expect(pdp.decide(shell('git status')).outcome).toBe('allow');
    expect(pdp.decide(shell('git status')).reasons).toContain('command-readonly');
    expect(pdp.decide(shell('npm install')).outcome).toBe('require-approval');
  });

  it('an allowed family runs; a chained escape does not', () => {
    const { pdp, perms } = setup();
    perms.addCommandRule('npm', 'persistent');
    expect(pdp.decide(shell('npm run build')).outcome).toBe('allow');
    expect(pdp.decide(shell('npm run build')).reasons).toContain('command-rule');
    expect(pdp.decide(shell('npm test && rm -rf dist')).outcome).toBe('require-approval');
  });

  it('the blocklist and Careful Mode sit above every rule', () => {
    const { pdp, perms } = setup();
    perms.addCommandRule('rm', 'persistent');
    expect(pdp.decide(shell('rm -rf /')).outcome).toBe('deny');
    perms.setCarefulMode(true);
    expect(pdp.decide(shell('git status')).outcome).toBe('require-approval');
  });

  it('autonomous turns still defer: rules are for turns the user started', () => {
    const { pdp, perms } = setup();
    perms.markHeartbeatSession('hb-1');
    perms.addCommandRule('npm', 'persistent');
    expect(pdp.decide(shell('npm test', 'hb-1')).outcome).toBe('require-approval');
    expect(pdp.decide(shell('git status', 'hb-1')).outcome).toBe('require-approval');
  });
});
