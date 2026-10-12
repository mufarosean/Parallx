// manifest.ts — the Agents tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';
import { AGENTS_ICON } from './agentsIcon.js';

export const AGENTS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.agents',
  name: 'Agents',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Everything the AI does on its own, in one place: what needs you, what is running, routines and workflows, history, and what it has learned.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'agents.show', title: 'Agents: Show',
        aiInvocable: true, aiDescription: 'Reveal the Agents view: approvals, running tasks, upcoming routines.' },
      // Not aiInvocable: making a routine is the user's call (the model has its own cron tools).
      { id: 'agents.newRoutine', title: 'Agents: New Routine…' },
      { id: 'agents.openRun', title: 'Agents: Watch Run' },
      { id: 'agents.showRoutines', title: 'Agents: Show Routines',
        aiInvocable: true, aiDescription: 'Reveal the Agents view on its Routines tab: the heartbeat, scheduled routines and workflows.' },
      { id: 'agents.showHistory', title: 'Agents: Show History',
        aiInvocable: true, aiDescription: 'Reveal the Agents view on its History tab: every background run, newest first.' },
      { id: 'workflows.new', title: 'Workflows: New Workflow',
        aiInvocable: true, aiDescription: 'Create a blank workflow and open it in the editor.' },
      { id: 'workflows.openEditor', title: 'Workflows: Open Editor' },
      // Ids kept from the retired Autonomy Log panel; History lives in Agents now.
      { id: 'autonomyLog.markAllRead', title: 'Agents: Mark History Read',
        aiInvocable: true, aiDescription: 'Mark every background run result in Agents History as read.' },
      { id: 'autonomyLog.clear',       title: 'Agents: Clear History',
        aiInvocable: true, aiDescription: 'Clear the delivered background run results from Agents History.' },
    ],
    editors: [
      { typeId: 'agents-run', displayName: 'Agent Run' },
      { typeId: 'workflow', displayName: 'Workflow' },
    ],
    icons: [AGENTS_ICON],
    viewContainers: [
      { id: 'agents-container', title: 'Agents', icon: 'px-automations', location: 'auxiliaryBar' as const },
    ],
    views: [{ id: 'view.agents', name: 'Agents', defaultContainerId: 'agents-container' }],
  },
};
