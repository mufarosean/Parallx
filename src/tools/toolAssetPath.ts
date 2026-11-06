// toolAssetPath.ts — where api.env.readAsset may read: a file inside the
// calling tool's own folder, named by a relative path.

/**
 * The absolute path of `relativePath` inside `toolPath`, or null when the
 * path is empty, absolute, a URL, or climbs out of the folder (`..`).
 * Separators follow `toolPath` (backslashes on Windows).
 */
export function resolveToolAssetPath(toolPath: string, relativePath: string): string | null {
  if (typeof toolPath !== 'string' || !toolPath) return null;
  if (typeof relativePath !== 'string') return null;
  const rel = relativePath.trim();
  if (!rel || rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel) || /^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) return null;
  const parts = rel.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || p.includes('\0'))) return null;
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const base = toolPath.endsWith('/') || toolPath.endsWith('\\') ? toolPath.slice(0, -1) : toolPath;
  return base + sep + parts.join(sep);
}
