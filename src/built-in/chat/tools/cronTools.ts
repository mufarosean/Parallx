// cronTools.ts — 8 cron tool actions (M58 W4)
//
// Upstream parity:
//   - cron-tool.ts:1-541 @ github.com/openclaw/openclaw — exposes 8 actions:
//     status, list, add, update, remove, run, runs, wake
//   - CronService (openclawCronService.ts) — D4 17/17 ALIGNED, 77 unit tests
//
// Parallx adaptation:
//   - One tool per action (matches M11 tool surface; upstream had one tool
//     with a union "action" field)
//   - Approval gating (cron_add / cron_update / cron_remove = requires-approval;
//     cron_status / cron_list / cron_runs / cron_run / cron_wake = free) is
//     sourced from `cronToolPermissionLevel` in openclawToolPolicy.ts so both
//     registration and introspection share the same rule
//   - Outputs are shallow JSON summaries suitable for direct model consumption
//     — ICronJob / ICronRunResult already carry only JSON-safe fields
//
// Ship-thin scope (M58 §6.5): the cron executor itself emits surface
// deliveries only (no LLM call). These tools fully drive the scheduler —
// add/update/remove/list/etc. work end-to-end today. Only the *effect of
// firing* is thin until M59's isolated-turn substrate lands.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type {
  CronService,
  ICronJob,
  ICronJobCreateParams,
  ICronJobUpdateParams,
  ICronPayload,
  ICronRunResult,
  ICronSchedule,
  CronWakeMode,
} from '../../../openclaw/openclawCronService.js';
import { cronToolPermissionLevel } from '../../../openclaw/openclawToolPolicy.js';

// Type-only re-export so test + documentation consumers can pin to the real
// scheduler class via this module when desired.
export type { CronService };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Narrow view of the scheduler this tool surface needs. Keeping it narrow
 * lets tests pass a fake without recreating the whole CronService.
 */
export interface ICronToolHost {
  addJob(params: ICronJobCreateParams): ICronJob;
  updateJob(id: string, params: ICronJobUpdateParams): ICronJob;
  removeJob(id: string): boolean;
  getJob(id: string): ICronJob | undefined;
  runJob(id: string): Promise<ICronRunResult>;
  wake(): Promise<void>;
  readonly jobs: readonly ICronJob[];
  readonly runHistory: readonly ICronRunResult[];
  getJobRuns(jobId: string): readonly ICronRunResult[];
  status(): { jobCount: number; runningJobs: number; timerActive: boolean; totalRuns: number };
}

function failure(message: string): IToolResult {
  return { content: JSON.stringify({ ok: false, error: message }), isError: true };
}

function success(payload: Record<string, unknown>): IToolResult {
  return { content: JSON.stringify({ ok: true, ...payload }) };
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function readSchedule(v: unknown): ICronSchedule | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  const at = readOptionalString(raw.at);
  const every = readOptionalString(raw.every);
  const cron = readOptionalString(raw.cron);
  return { at, every, cron };
}

function readPayload(v: unknown): ICronPayload | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const raw = v as Record<string, unknown>;
  const agentTurn = readOptionalString(raw.agentTurn);
  const systemEvent = (raw.systemEvent && typeof raw.systemEvent === 'object' && !Array.isArray(raw.systemEvent))
    ? raw.systemEvent as Record<string, unknown>
    : undefined;
  return { agentTurn, systemEvent };
}

function readWakeMode(v: unknown): CronWakeMode | undefined {
  return v === 'now' || v === 'next-heartbeat' ? v : undefined;
}

function missingHost(): IToolResult {
  return failure('Cron service not available');
}

// ---------------------------------------------------------------------------
// Shared JSON schema fragments
// ---------------------------------------------------------------------------

const SCHEDULE_SCHEMA = {
  type: 'object',
  description: 'Schedule spec — exactly one of at / every / cron must be set.',
  properties: {
    at: { type: 'string', description: 'ISO-8601 datetime for a one-shot job.' },
    every: { type: 'string', description: 'Duration string for repeating jobs (e.g. "5m", "1h").' },
    cron: { type: 'string', description: 'Standard 5-field cron expression.' },
  },
};

const PAYLOAD_SCHEMA = {
  type: 'object',
  description: 'Payload delivered when the job fires.',
  properties: {
    agentTurn: { type: 'string', description: 'Message to inject as an agent turn (executed by M59 substrate; captured-only in M58).' },
    systemEvent: { type: 'object', description: 'Structured system event to emit.' },
  },
};

// ---------------------------------------------------------------------------
// cron_status
// ---------------------------------------------------------------------------

export function createCronStatusTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_status';
  return {
    name,
    description: 'Report cron scheduler status: active timer, total jobs, running jobs, total runs.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (_args, _token: ICancellationToken): Promise<IToolResult> => {
      if (!host) return missingHost();
      return success({ status: host.status() });
    },
  };
}

// ---------------------------------------------------------------------------
// cron_list
// ---------------------------------------------------------------------------

export function createCronListTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_list';
  return {
    name,
    description: 'List all scheduled cron jobs (read-only).',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (_args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      return success({ jobs: host.jobs });
    },
  };
}

// ---------------------------------------------------------------------------
// cron_add
// ---------------------------------------------------------------------------

export function createCronAddTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_add';
  return {
    name,
    description: 'Schedule a new cron job. Requires user approval. Exactly one of schedule.at / schedule.every / schedule.cron.',
    parameters: {
      type: 'object',
      required: ['name', 'schedule', 'payload'],
      properties: {
        name: { type: 'string', description: 'Human-readable job name.' },
        schedule: SCHEDULE_SCHEMA,
        payload: PAYLOAD_SCHEMA,
        wakeMode: { type: 'string', enum: ['now', 'next-heartbeat'], description: 'When to fire (default: "now").' },
        contextMessages: { type: 'number', description: 'Number of recent chat messages to include when firing (0-10).' },
        enabled: { type: 'boolean', description: 'Whether the job starts enabled (default: true).' },
        description: { type: 'string', description: 'Optional human description.' },
        deleteAfterRun: { type: 'boolean', description: 'Auto-remove after one successful fire.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      const jobName = readString(args.name);
      if (!jobName) return failure('Missing required argument: name');
      const schedule = readSchedule(args.schedule);
      if (!schedule) return failure('Missing required argument: schedule');
      const payload = readPayload(args.payload);
      if (!payload) return failure('Missing required argument: payload');
      try {
        const job = host.addJob({
          name: jobName,
          schedule,
          payload,
          wakeMode: readWakeMode(args.wakeMode),
          contextMessages: readNumber(args.contextMessages),
          enabled: readBoolean(args.enabled),
          description: readOptionalString(args.description),
          deleteAfterRun: readBoolean(args.deleteAfterRun),
        });
        return success({ job });
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// cron_update
// ---------------------------------------------------------------------------

export function createCronUpdateTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_update';
  return {
    name,
    description: 'Update an existing cron job. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Job id (returned by cron_add / cron_list).' },
        name: { type: 'string' },
        schedule: SCHEDULE_SCHEMA,
        payload: PAYLOAD_SCHEMA,
        wakeMode: { type: 'string', enum: ['now', 'next-heartbeat'] },
        contextMessages: { type: 'number' },
        enabled: { type: 'boolean' },
        description: { type: 'string' },
        deleteAfterRun: { type: 'boolean' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      const id = readString(args.id);
      if (!id) return failure('Missing required argument: id');
      try {
        const patch: ICronJobUpdateParams = {
          name: readString(args.name),
          schedule: readSchedule(args.schedule),
          payload: readPayload(args.payload),
          wakeMode: readWakeMode(args.wakeMode),
          contextMessages: readNumber(args.contextMessages),
          enabled: readBoolean(args.enabled),
          description: readOptionalString(args.description),
          deleteAfterRun: readBoolean(args.deleteAfterRun),
        };
        const job = host.updateJob(id, patch);
        return success({ job });
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// cron_remove
// ---------------------------------------------------------------------------

export function createCronRemoveTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_remove';
  return {
    name,
    description: 'Remove a scheduled cron job. Requires user approval.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Job id to remove.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      const id = readString(args.id);
      if (!id) return failure('Missing required argument: id');
      const removed = host.removeJob(id);
      return success({ removed, id });
    },
  };
}

// ---------------------------------------------------------------------------
// cron_run
// ---------------------------------------------------------------------------

export function createCronRunTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_run';
  return {
    name,
    description: 'Manually fire a cron job by id (user-initiated).',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Job id to fire now.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      const id = readString(args.id);
      if (!id) return failure('Missing required argument: id');
      try {
        const result = await host.runJob(id);
        return success({ result });
      } catch (err) {
        return failure(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// cron_runs
// ---------------------------------------------------------------------------

export function createCronRunsTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_runs';
  return {
    name,
    description: 'List recent cron fire history. Optional `jobId` filters to a single job.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Optional — restrict history to this job.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      const jobId = readString(args.jobId);
      const runs = jobId ? host.getJobRuns(jobId) : host.runHistory;
      return success({ runs });
    },
  };
}

// ---------------------------------------------------------------------------
// cron_wake
// ---------------------------------------------------------------------------

export function createCronWakeTool(host: ICronToolHost | undefined): IChatTool {
  const name = 'cron_wake';
  return {
    name,
    description: 'Trigger an immediate check for due cron jobs (user-initiated; does not create work).',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    permissionLevel: cronToolPermissionLevel(name),
    source: 'built-in',
    handler: async (_args, _token): Promise<IToolResult> => {
      if (!host) return missingHost();
      await host.wake();
      return success({ waked: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Registration bundle
// ---------------------------------------------------------------------------

/**
 * Build all 8 cron tool definitions in a single array. Order matches the
 * upstream cron-tool.ts action enum for easy diff review.
 */
export function createCronTools(host: ICronToolHost | undefined): IChatTool[] {
  return [
    createCronStatusTool(host),
    createCronListTool(host),
    createCronAddTool(host),
    createCronUpdateTool(host),
    createCronRemoveTool(host),
    createCronRunTool(host),
    createCronRunsTool(host),
    createCronWakeTool(host),
  ];
}

/** The 8 upstream cron tool names, exported for tests + introspection. */
export const CRON_TOOL_NAMES = [
  'cron_status',
  'cron_list',
  'cron_add',
  'cron_update',
  'cron_remove',
  'cron_run',
  'cron_runs',
  'cron_wake',
] as const;
