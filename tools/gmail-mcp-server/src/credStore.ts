// credStore.ts — On-disk credential store for the Gmail MCP server.
//
// Path: ~/.parallx/gmail-mcp/credentials.json
// Permissions: chmod 600 on POSIX. (On Windows, NTFS ACLs default to
// the user's profile being inaccessible to other users; we still try
// to set restrictive perms but tolerate failure.)
//
// File shape:
//   {
//     "version": 1,
//     "client_id": "...",
//     "client_secret": "...",
//     "refresh_token": "...",
//     "scope": "https://www.googleapis.com/auth/gmail.readonly",
//     "obtained_at": "2025-01-01T00:00:00.000Z"
//   }
//
// Atomic write: write to .tmp then rename.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredCredentials {
  readonly version: 1;
  readonly client_id: string;
  readonly client_secret: string;
  readonly refresh_token: string;
  readonly scope: string;
  readonly obtained_at: string;
}

export function defaultCredPath(): string {
  // When spawned by Parallx, PARALLX_GMAIL_CRED_PATH points to the
  // app-data directory so credentials stay within the portable install root.
  const envPath = process.env['PARALLX_GMAIL_CRED_PATH'];
  if (envPath && typeof envPath === 'string') return envPath;
  return join(homedir(), '.parallx', 'gmail-mcp', 'credentials.json');
}

export async function readCredentials(path = defaultCredPath()): Promise<StoredCredentials | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`credentials file is not valid JSON: ${path}`);
  }
  const c = parsed as Partial<StoredCredentials>;
  if (
    c?.version !== 1 ||
    typeof c.client_id !== 'string' ||
    typeof c.client_secret !== 'string' ||
    typeof c.refresh_token !== 'string' ||
    typeof c.scope !== 'string' ||
    typeof c.obtained_at !== 'string'
  ) {
    throw new Error(`credentials file has unexpected shape: ${path}`);
  }
  return c as StoredCredentials;
}

export async function writeCredentials(
  creds: StoredCredentials,
  path = defaultCredPath(),
): Promise<void> {
  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // Best-effort chmod (Windows ignores non-owner bits, that's fine).
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    /* tolerate Windows permission model */
  }
  await fs.rename(tmp, path);
}
