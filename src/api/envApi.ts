// envApi.ts — api.env: the app's name, version and time zone, the tool's own
// folder, and the data files it ships (readAsset).

import { assistantTimeZone } from '../services/localTime.js';
import { PARALLX_VERSION } from '../tools/toolValidator.js';
import { resolveToolAssetPath } from '../tools/toolAssetPath.js';

export interface ToolEnv {
  readonly appName: string;
  readonly appVersion: string;
  readonly toolPath: string;
  /** The app's time zone (IANA): the Time Zone setting, or this computer's when empty. Read it when you need it; it can change. */
  readonly timeZone: string;
  /** The bytes of a file inside the tool's own folder (a mesh, a model, an image it ships), by relative path. Rejects outside it. */
  readAsset(relativePath: string): Promise<ArrayBuffer>;
}

/** Base64 to bytes. */
function fromBase64(text: string): ArrayBuffer {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Read a file inside `toolPath` through the app's file bridge (which serves the app's folder, where tools live). */
export async function readToolAsset(toolPath: string, relativePath: string): Promise<ArrayBuffer> {
  const full = resolveToolAssetPath(toolPath, relativePath);
  if (!full) throw new Error(`"${relativePath}" is not a path inside the tool's folder.`);
  const fs = (globalThis as any).parallxElectron?.fs;
  if (!fs?.readFile) throw new Error('Reading tool files needs the desktop app.');
  const r = await fs.readFile(full, 'base64');
  if (!r || r.error) throw new Error(r?.error?.message || `Could not read "${relativePath}".`);
  if (r.encoding !== 'base64') return new TextEncoder().encode(String(r.content)).buffer as ArrayBuffer;
  return fromBase64(String(r.content));
}

export function createToolEnv(toolPath: string): ToolEnv {
  return Object.freeze({
    appName: 'Parallx',
    appVersion: PARALLX_VERSION,
    toolPath,
    get timeZone() { return assistantTimeZone(); },
    readAsset: (relativePath: string) => readToolAsset(toolPath, relativePath),
  });
}
