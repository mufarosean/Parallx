// D2+D3: /doctor command — delegates to IDiagnosticsService when available
// Upstream: src/commands/doctor.ts — runtime health diagnostics
// D3: Renders results from the shared diagnostics service

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';
import type { IDiagnosticResult } from '../../services/serviceTypes.js';

export async function tryHandleOpenclawDoctorCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'doctor') return false;

  response.progress('Running diagnostics...');

  // ONE diagnostics engine (RETIREMENT.md Part 3.1). The 49-line inline
  // fallback that duplicated nine checks is deleted — the workbench now
  // registers DiagnosticsService unconditionally in its first pass, so
  // an absent service here means broken wiring, said plainly.
  if (!services.diagnosticsService) {
    response.markdown('Diagnostics are unavailable in this session (service wiring incomplete).');
    return true;
  }
  renderDiagnosticReport(await services.diagnosticsService.runChecks(), response);
  return true;
}

function renderDiagnosticReport(checks: readonly IDiagnosticResult[], response: IChatResponseStream): void {
  const passCount = checks.filter(c => c.status === 'pass').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  const lines: string[] = ['## Diagnostic Report\n'];
  const statusIcon = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'OK';
  lines.push(`${statusIcon} **${passCount}** pass, **${failCount}** fail, **${warnCount}** warn\n`);

  lines.push('| Check | Status | Detail |');
  lines.push('|-------|--------|--------|');
  for (const c of checks) {
    const icon = c.status === 'pass' ? 'pass' : c.status === 'fail' ? 'FAIL' : 'warn';
    lines.push(`| ${c.name} | ${icon} | ${c.detail} |`);
  }

  if (failCount > 0) {
    lines.push('\n### Recommended Actions');
    for (const c of checks.filter(c => c.status === 'fail')) {
      lines.push(`- **${c.name}:** ${c.detail}`);
    }
  }

  response.markdown(lines.join('\n'));
}


