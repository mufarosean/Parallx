import { URI } from '../platform/uri.js';
import type {
  WorkspaceState,
  SerializedWorkspaceFolder,
  WorkspaceIdentity,
  WorkspaceMetadata,
} from './workspaceTypes.js';

export const PARALLX_WORKSPACE_MANIFEST_VERSION = 1;

export interface WorkspaceBoundaryPolicy {
  readonly mode: 'strict';
  readonly allowWorkspaceFoldersOnly: true;
  readonly defaultFileAccess: 'deny';
  readonly allowlistedUris?: readonly string[];
  readonly policyVersion: number;
}

export interface WorkspaceToolSettings {
  readonly enabled?: boolean;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly workspaceState?: Readonly<Record<string, unknown>>;
}

export interface WorkspaceSettingsEnvelope {
  readonly global: Readonly<Record<string, unknown>>;
  readonly profiles?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly tools: Readonly<Record<string, WorkspaceToolSettings>>;
}

export interface WorkspaceStorageEnvelope {
  readonly workspaceDataDir: string;
  readonly canvas: {
    readonly database: {
      readonly relativePath: string;
      readonly strategy: 'workspace-root-relative';
      readonly journalMode: 'WAL';
    };
    readonly migrations: {
      readonly source: 'bundled';
      readonly path?: string;
    };
  };
  readonly attachments?: {
    readonly relativeDir: string;
    readonly strategy: 'workspace-root-relative';
  };
}

export interface WorkspaceManifestIdentity {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly iconOrColor?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly savedAt: string;
  readonly sourceUri?: string;
  readonly tags?: readonly string[];
}

export interface WorkspaceManifestFolder {
  readonly uri: string;
  readonly name: string;
  readonly index: number;
  readonly addedAt?: string;
  readonly trusted?: boolean;
}

export interface WorkspaceManifest {
  readonly manifestVersion: number;
  readonly identity: WorkspaceManifestIdentity;
  readonly folders: readonly WorkspaceManifestFolder[];
  readonly boundary: WorkspaceBoundaryPolicy;
  readonly settings: WorkspaceSettingsEnvelope;
  readonly storage: WorkspaceStorageEnvelope;
  readonly state: {
    readonly workbench: WorkspaceState;
    readonly checksums?: Readonly<Record<string, string>>;
  };
  readonly meta?: {
    readonly exportedBy?: string;
    readonly exportedAt?: string;
    readonly notes?: string;
  };
}

export interface WorkspaceManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface WorkspaceManifestBuildOptions {
  readonly sourceUri?: string;
  readonly exportedBy?: string;
  readonly notes?: string;
  readonly settings?: WorkspaceSettingsEnvelope;
  readonly storage?: WorkspaceStorageEnvelope;
  readonly boundary?: WorkspaceBoundaryPolicy;
  readonly tags?: readonly string[];
}

const DEFAULT_BOUNDARY: WorkspaceBoundaryPolicy = {
  mode: 'strict',
  allowWorkspaceFoldersOnly: true,
  defaultFileAccess: 'deny',
  policyVersion: 1,
};

const DEFAULT_SETTINGS: WorkspaceSettingsEnvelope = {
  global: {},
  tools: {},
};

const DEFAULT_STORAGE: WorkspaceStorageEnvelope = {
  workspaceDataDir: '.parallx',
  canvas: {
    database: {
      relativePath: '.parallx/data.db',
      strategy: 'workspace-root-relative',
      journalMode: 'WAL',
    },
    migrations: {
      source: 'bundled',
    },
  },
  attachments: {
    relativeDir: '.parallx/attachments',
    strategy: 'workspace-root-relative',
  },
};

export function createWorkspaceManifestFromState(
  state: WorkspaceState,
  options: WorkspaceManifestBuildOptions = {},
): WorkspaceManifest {
  const nowIso = new Date().toISOString();

  return {
    manifestVersion: PARALLX_WORKSPACE_MANIFEST_VERSION,
    identity: {
      id: state.identity.id,
      name: state.identity.name,
      iconOrColor: state.identity.iconOrColor,
      createdAt: state.metadata.createdAt,
      updatedAt: state.metadata.lastAccessedAt,
      savedAt: nowIso,
      sourceUri: options.sourceUri,
      tags: options.tags,
    },
    folders: (state.folders ?? []).map((f, index) => ({
      uri: URI.from({ scheme: f.scheme, path: f.path }).toString(),
      name: f.name,
      index,
      trusted: true,
      addedAt: nowIso,
    })),
    boundary: options.boundary ?? DEFAULT_BOUNDARY,
    settings: options.settings ?? DEFAULT_SETTINGS,
    storage: options.storage ?? DEFAULT_STORAGE,
    state: {
      workbench: state,
    },
    meta: {
      exportedBy: options.exportedBy ?? 'Parallx',
      exportedAt: nowIso,
      notes: options.notes,
    },
  };
}

export function manifestToWorkspaceState(manifest: WorkspaceManifest): WorkspaceState {
  const validation = validateWorkspaceManifest(manifest);
  if (!validation.valid) {
    throw new Error(`[WorkspaceManifest] Invalid manifest: ${validation.errors.join('; ')}`);
  }

  const workbenchState = manifest.state.workbench;

  const normalizedFolders = manifest.folders.map((folder) => {
    const uri = URI.parse(folder.uri);
    return {
      scheme: uri.scheme,
      path: uri.path,
      name: folder.name,
    } satisfies SerializedWorkspaceFolder;
  });

  return {
    ...workbenchState,
    identity: {
      ...workbenchState.identity,
      id: manifest.identity.id,
      name: manifest.identity.name,
      iconOrColor: manifest.identity.iconOrColor,
    } satisfies WorkspaceIdentity,
    metadata: {
      ...workbenchState.metadata,
      createdAt: manifest.identity.createdAt,
      lastAccessedAt: manifest.identity.updatedAt,
    } satisfies WorkspaceMetadata,
    folders: normalizedFolders,
  };
}

export function parseWorkspaceManifest(json: string): WorkspaceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`[WorkspaceManifest] Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const validation = validateWorkspaceManifest(parsed);
  if (!validation.valid) {
    throw new Error(`[WorkspaceManifest] Validation failed: ${validation.errors.join('; ')}`);
  }

  return parsed as WorkspaceManifest;
}

export function validateWorkspaceManifest(candidate: unknown): WorkspaceManifestValidationResult {
  const errors: string[] = [];

  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, errors: ['manifest must be an object'] };
  }

  const manifest = candidate as Record<string, unknown>;

  if (manifest.manifestVersion !== PARALLX_WORKSPACE_MANIFEST_VERSION) {
    errors.push(`manifestVersion must be ${PARALLX_WORKSPACE_MANIFEST_VERSION}`);
  }

  const identity = manifest.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity !== 'object') {
    errors.push('identity is required');
  } else {
    if (!identity.id || typeof identity.id !== 'string') errors.push('identity.id is required');
    if (!identity.name || typeof identity.name !== 'string') errors.push('identity.name is required');
    if (!identity.createdAt || typeof identity.createdAt !== 'string') errors.push('identity.createdAt is required');
    if (!identity.updatedAt || typeof identity.updatedAt !== 'string') errors.push('identity.updatedAt is required');
  }

  const folders = manifest.folders;
  if (!Array.isArray(folders)) {
    errors.push('folders must be an array');
  } else {
    folders.forEach((folder, i) => {
      if (!folder || typeof folder !== 'object') {
        errors.push(`folders[${i}] must be an object`);
        return;
      }
      const f = folder as Record<string, unknown>;
      if (!f.uri || typeof f.uri !== 'string') errors.push(`folders[${i}].uri is required`);
      if (!f.name || typeof f.name !== 'string') errors.push(`folders[${i}].name is required`);
      if (typeof f.index !== 'number') errors.push(`folders[${i}].index is required`);
    });
  }

  const boundary = manifest.boundary as Record<string, unknown> | undefined;
  if (!boundary || typeof boundary !== 'object') {
    errors.push('boundary is required');
  } else {
    if (boundary.mode !== 'strict') errors.push('boundary.mode must be "strict"');
    if (boundary.allowWorkspaceFoldersOnly !== true) errors.push('boundary.allowWorkspaceFoldersOnly must be true');
    if (boundary.defaultFileAccess !== 'deny') errors.push('boundary.defaultFileAccess must be "deny"');
  }

  const settings = manifest.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== 'object') {
    errors.push('settings is required');
  } else {
    if (!settings.global || typeof settings.global !== 'object') errors.push('settings.global is required');
    if (!settings.tools || typeof settings.tools !== 'object') errors.push('settings.tools is required');
  }

  const storage = manifest.storage as Record<string, unknown> | undefined;
  if (!storage || typeof storage !== 'object') {
    errors.push('storage is required');
  } else {
    const canvas = storage.canvas as Record<string, unknown> | undefined;
    if (!canvas || typeof canvas !== 'object') {
      errors.push('storage.canvas is required');
    } else {
      const database = canvas.database as Record<string, unknown> | undefined;
      if (!database || typeof database !== 'object') {
        errors.push('storage.canvas.database is required');
      } else {
        if (typeof database.relativePath !== 'string') errors.push('storage.canvas.database.relativePath is required');
        if (database.strategy !== 'workspace-root-relative') errors.push('storage.canvas.database.strategy must be "workspace-root-relative"');
      }
    }
  }

  const state = manifest.state as Record<string, unknown> | undefined;
  if (!state || typeof state !== 'object') {
    errors.push('state is required');
  } else {
    if (!state.workbench || typeof state.workbench !== 'object') errors.push('state.workbench is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
