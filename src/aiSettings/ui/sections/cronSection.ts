// cronSection.ts — Minimal Cron scheduler settings section (M58 W4)
//
// Ship-thin UX per Parallx_Milestone_58.md §6.5:
//   The cron scheduler is always active. Jobs only exist when the user
//   explicitly approves `cron_add` tool calls, so there's nothing to toggle
//   on/off — default safety is "no jobs = nothing fires".
//
//   This section is an informational subsection: it states that the
//   scheduler is present + active, summarises the approval posture
//   (add/update/remove require approval; read-only + user-initiated
//   actions are free), and reserves a `data-role="cron-job-list"` slot
//   for the M59 job-list UI to populate without needing a new section.

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { AISettingsProfile, IAISettingsService } from '../../aiSettingsTypes.js';

export class CronSection extends SettingsSection {

  constructor(service: IAISettingsService) {
    super(service, 'cron', 'Scheduled jobs');
  }

  build(): void {
    const intro = $('div.ai-settings-section__info');
    intro.textContent =
      'Parallx runs a cron scheduler in the background. It stays idle until the ' +
      'agent schedules a job via an approved cron_add tool call. No jobs are ' +
      'created by default.';
    this.contentElement.appendChild(intro);

    const approval = $('div.ai-settings-section__info');
    approval.textContent =
      'Approval posture: cron_add / cron_update / cron_remove require your ' +
      'confirmation before the agent can change the schedule. cron_status / ' +
      'cron_list / cron_runs / cron_run / cron_wake are free (read-only or ' +
      'user-initiated).';
    this.contentElement.appendChild(approval);

    // Placeholder slot for the M59 job-list view.
    const placeholder = $('div.ai-settings-section__info');
    placeholder.setAttribute('data-role', 'cron-job-list');
    placeholder.textContent = 'Scheduled jobs appear here once the agent creates them.';
    this.contentElement.appendChild(placeholder);
  }

  update(_profile: AISettingsProfile): void {
    // Informational-only section — no live fields to sync.
  }
}
