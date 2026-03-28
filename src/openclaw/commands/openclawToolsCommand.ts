// D2: /tools command — List available tools and their status
// Upstream: src/commands/tools.ts — tool listing and status

import type { IChatResponseStream, ToolPermissionLevel } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';
import { resolveToolProfile } from '../openclawToolPolicy.js';

export async function tryHandleOpenclawToolsCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
  mode?: string,
): Promise<boolean> {
  if (command !== 'tools') return false;

  const effectiveMode = mode ?? 'agent';
  const toolDefs = services.getToolDefinitions();
  const readOnlyDefs = services.getReadOnlyToolDefinitions();
  const permissions = services.getToolPermissions?.() ?? {};
  const profile = resolveToolProfile(effectiveMode);

  const lines: string[] = ['## Available Tools\n'];
  lines.push(`**Mode:** ${effectiveMode} | **Profile:** ${profile}\n`);

  if (toolDefs.length === 0 && readOnlyDefs.length === 0) {
    lines.push('No tools registered.');
    response.markdown(lines.join('\n'));
    return true;
  }

  // Tool-calling tools (full access)
  if (toolDefs.length > 0) {
    lines.push('### Tool-Calling Tools');
    lines.push('| Tool | Description | Permission |');
    lines.push('|------|-------------|------------|');
    for (const t of toolDefs) {
      const perm: ToolPermissionLevel | 'default' = permissions[t.name] ?? 'default';
      const permIcon = perm === 'always-allowed' ? '✅' : perm === 'never-allowed' ? '🚫' : '🔒';
      const desc = t.description?.slice(0, 60) ?? '—';
      lines.push(`| ${t.name} | ${desc} | ${permIcon} ${perm} |`);
    }
  }

  // Read-only tools
  if (readOnlyDefs.length > 0) {
    lines.push('\n### Read-Only Tools');
    lines.push('| Tool | Description |');
    lines.push('|------|-------------|');
    for (const t of readOnlyDefs) {
      const desc = t.description?.slice(0, 60) ?? '—';
      lines.push(`| ${t.name} | ${desc} |`);
    }
  }

  // Skills
  const skills = services.getSkillCatalog?.() ?? [];
  if (skills.length > 0) {
    lines.push('\n### Skills');
    lines.push('| Skill | Description |');
    lines.push('|-------|-------------|');
    for (const s of skills) {
      lines.push(`| ${s.name} | ${s.description?.slice(0, 60) ?? '—'} |`);
    }
  }

  const total = toolDefs.length + readOnlyDefs.length + skills.length;
  lines.push(`\n*${total} total capabilities registered*`);

  response.markdown(lines.join('\n'));
  return true;
}
