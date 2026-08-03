// pythonTools.ts — chat tools for the workspace Python runtime (M94).
//
// These are registered only while `python.enabled` is on for the workspace
// (see chat/main.ts), so a workspace that has not opted in carries zero
// footprint in the model's tool list — the assistant cannot offer to run
// Python somewhere the user never allowed it.
//
// Deliberately NOT provided: an "execute this code string" tool. A script the
// model wants to run is written to the workspace with the ordinary file tools
// first, which means the user can read it before approving the run, it lands
// in version control alongside everything else, and the run log points at
// something that still exists afterwards. Inline code would give up all three.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type {
  IPythonEnvService,
  IPythonRunExit,
} from '../../../services/pythonEnvService.js';

/** Cap on output folded back into the model's context. */
const MAX_TOOL_OUTPUT = 20_000;

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return text.slice(0, MAX_TOOL_OUTPUT) + `\n\n… (truncated, ${text.length} chars total)`;
}

// ── python_run_script ───────────────────────────────────────────────────────

export function createPythonRunScriptTool(service: IPythonEnvService): IChatTool {
  return {
    name: 'python_run_script',
    displaySummary: 'Run a Python script from the workspace (approval).',
    description:
      'Run a .py file that already exists in the workspace, using the workspace\'s ' +
      'own Python environment. Write the script with fs_write_file first. The script ' +
      'runs with the workspace root as its working directory, so relative paths resolve ' +
      'against workspace content, and PARALLX_OUT names a folder for any files it produces. ' +
      'Returns the script\'s combined output. Long-running scripts must print progress ' +
      'as they work: a run is stopped only after a stretch of NO output (workspace ' +
      '"Stall timeout" setting, default 120s). Total runtime is unlimited while it ' +
      'keeps reporting.',
    parameters: {
      type: 'object',
      required: ['scriptPath'],
      properties: {
        scriptPath: {
          type: 'string',
          description: 'Workspace-relative path to a .py file, e.g. "scripts/summarise.py".',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command-line arguments passed to the script.',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'python',
    async handler(args: Record<string, unknown>, token: ICancellationToken): Promise<IToolResult> {
      const scriptPath = String(args['scriptPath'] || '').trim();
      if (!scriptPath) {
        return { content: 'scriptPath is required', isError: true };
      }
      const scriptArgs = Array.isArray(args['args'])
        ? (args['args'] as unknown[]).map((a) => String(a))
        : [];

      const started = await service.runScript(scriptPath, scriptArgs);
      if (!started.ok || !started.handle) {
        return { content: started.error ?? 'Could not start the script.', isError: true };
      }
      const { runId } = started.handle;

      // The bridge streams output and signals completion by event; the tool
      // contract is a single result, so collect until exit.
      const chunks: string[] = [];
      const exit = await new Promise<IPythonRunExit>((resolve) => {
        let settled = false;
        const finish = (p: IPythonRunExit) => {
          if (settled) return;
          settled = true;
          dataSub.dispose();
          exitSub.dispose();
          cancelSub?.dispose();
          resolve(p);
        };

        const dataSub = service.onDidRunData((p) => {
          if (p.runId === runId) chunks.push(p.chunk);
        });
        const exitSub = service.onDidRunExit((p) => {
          if (p.runId === runId) finish(p);
        });
        // A cancelled turn should stop the script, not orphan it.
        const cancelSub = token?.onCancellationRequested?.(() => {
          void service.cancelRun(runId);
        });

        // Guard against a script that finished between the spawn returning and
        // these subscriptions being attached: without this the tool would wait
        // on an event that has already been and gone.
        const already = service.recentRuns().find((r) => r.runId === runId);
        if (already && already.exitCode !== null) {
          if (already.output) chunks.push(already.output);
          finish({
            runId,
            exitCode: already.exitCode,
            error: already.error ? { code: 'ERROR', message: already.error } : null,
            durationMs: already.durationMs ?? 0,
          });
        }
      });

      const output = truncate(chunks.join('').trim() || '(no output)');

      if (exit.error) {
        return {
          content: `Script ${scriptPath} did not complete: ${exit.error.message}\n\nOutput:\n${output}`,
          isError: true,
        };
      }
      if (exit.exitCode !== 0) {
        return {
          content: `Script ${scriptPath} exited with code ${exit.exitCode} after ${exit.durationMs}ms.\n\nOutput:\n${output}`,
          isError: true,
        };
      }
      const where = exit.outDir ? `\n\nOutput folder: ${exit.outDir}` : '';
      return { content: `Script ${scriptPath} finished in ${exit.durationMs}ms.\n\n${output}${where}` };
    },
  };
}

// ── python_install_packages ─────────────────────────────────────────────────

export function createPythonInstallTool(service: IPythonEnvService): IChatTool {
  return {
    name: 'python_install_packages',
    displaySummary: 'Install Python packages into the workspace environment (approval).',
    description:
      'Install packages into this workspace\'s Python environment. Packages are private ' +
      'to this workspace. Accepts plain names with an optional version ("pandas", ' +
      '"pandas==2.1.0"); paths, URLs, and pip flags are rejected. Creates the environment ' +
      'if it does not exist yet.',
    parameters: {
      type: 'object',
      required: ['packages'],
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Package specifiers, e.g. ["pandas", "openpyxl==3.1.2"].',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'python',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      const packages = Array.isArray(args['packages'])
        ? (args['packages'] as unknown[]).map((p) => String(p).trim()).filter(Boolean)
        : [];
      if (!packages.length) {
        return { content: 'packages is required and must be a non-empty array', isError: true };
      }

      // Installing into an environment that does not exist is a confusing
      // failure; creating it is implied by the request.
      const status = await service.getStatus();
      if (!status.envExists) {
        const created = await service.createEnv();
        if (!created.ok) {
          return { content: created.error ?? 'Could not create the environment.', isError: true };
        }
      }

      const res = await service.installPackages(packages);
      if (!res.ok) {
        return {
          content: `Install failed: ${res.error}\n\n${truncate(res.output ?? '')}`.trim(),
          isError: true,
        };
      }
      return { content: `Installed: ${packages.join(', ')}\n\n${truncate(res.output ?? '')}`.trim() };
    },
  };
}

// ── python_list_packages ────────────────────────────────────────────────────

export function createPythonListPackagesTool(service: IPythonEnvService): IChatTool {
  return {
    name: 'python_list_packages',
    displaySummary: 'List packages in the workspace Python environment.',
    description:
      'List the packages installed in this workspace\'s Python environment, and whether ' +
      'an environment exists at all. Check this before writing a script that imports ' +
      'third-party libraries.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'python',
    async handler(_args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      const status = await service.getStatus();
      if (!status.envExists) {
        return {
          content: status.interpreterFound
            ? 'No Python environment exists for this workspace yet. python_install_packages will create one.'
            : 'No Python 3.10+ interpreter is available on this machine.',
        };
      }
      const packages = await service.listPackages();
      if (!packages.length) {
        return { content: `Environment exists (built with Python ${status.createdWith ?? '?'}) but has no packages installed.` };
      }
      const lines = packages.map((p) => `${p.name}==${p.version}`).join('\n');
      return {
        content: `Python ${status.createdWith ?? '?'} environment, ${packages.length} packages:\n\n${lines}`,
      };
    },
  };
}

/** All Python tools, in registration order. */
export function createPythonTools(service: IPythonEnvService): IChatTool[] {
  return [
    createPythonListPackagesTool(service),
    createPythonInstallTool(service),
    createPythonRunScriptTool(service),
  ];
}
