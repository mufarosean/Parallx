// workflowLibrary.test.ts — the templates must all VALIDATE (a gallery
// that hands out broken graphs is worse than none), and the cron
// migration must preserve behaviour: schedule, prompt, enablement,
// context depth, and provenance.

import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TEMPLATES,
  cronJobToWorkflow,
  instantiateTemplate,
} from '../../src/services/workflows/workflowLibrary';
import { validateWorkflow } from '../../src/services/workflows/workflowGraph';
import type { ICronJob } from '../../src/openclaw/openclawCronService';

describe('the template gallery', () => {
  it('every template instantiates into a VALID, non-draft workflow', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const doc = instantiateTemplate(t, `wf-${t.key}`);
      const v = validateWorkflow(doc);
      expect(v.errors, `template ${t.key}: ${v.errors.join('; ')}`).toEqual([]);
      expect(v.isDraft, `template ${t.key} has no trigger`).toBe(false);
    }
  });

  it('templates install DISABLED — the user turns them on, not the gallery', () => {
    const doc = instantiateTemplate(WORKFLOW_TEMPLATES[0], 'wf-x');
    expect(doc.enabled).toBe(false);
    expect(doc.source).toBe('stock');
  });
});

describe('cron migration (the two-node promise)', () => {
  const baseJob: ICronJob = {
    id: 'cron-7',
    name: 'Flashcard Reminder',
    schedule: { cron: '0 8 * * *' },
    payload: { agentTurn: 'Check my due flashcards and tell me the count.' },
    wakeMode: 'now',
    contextMessages: 4,
    enabled: true,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    runCount: 12,
  };

  it('a job with an agent turn becomes schedule → agent turn, behaviour intact', () => {
    const doc = cronJobToWorkflow(baseJob, 'wf-m1');
    expect(validateWorkflow(doc).ok).toBe(true);
    expect(doc.enabled).toBe(true);
    expect(doc.source).toBe('migrated-cron');
    expect(doc.migratedFromCronId).toBe('cron-7');
    const turn = doc.nodes.find((n) => n.kind === 'action.agentTurn')!;
    expect(turn).toMatchObject({ prompt: 'Check my due flashcards and tell me the count.', contextMessages: 4 });
    const trig = doc.nodes.find((n) => n.kind === 'trigger.schedule')!;
    expect((trig as { spec: { kind: string } }).spec).toEqual({ kind: 'daily', time: '08:00' });
  });

  it('a bare reminder job becomes schedule → notify', () => {
    const doc = cronJobToWorkflow(
      { ...baseJob, payload: {}, description: 'Drink water' }, 'wf-m2');
    expect(validateWorkflow(doc).ok).toBe(true);
    const n = doc.nodes.find((x) => x.kind === 'action.notify')!;
    expect((n as { message: string }).message).toBe('Drink water');
  });

  it('a disabled job migrates disabled', () => {
    expect(cronJobToWorkflow({ ...baseJob, enabled: false }, 'wf-m3').enabled).toBe(false);
  });
});
