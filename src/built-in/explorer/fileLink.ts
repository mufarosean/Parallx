// fileLink.ts — the `parallx://explorer/file` link: what file it means, whether
// it is there, and where in the file it lands.
//
// A link's `path` is the workspace-relative path the AI's file tools show
// ("Exam Source Material/Clark.pdf"), resolved against the open workspace
// when the link is used, so the AI never has to know (or guess) where the
// workspace sits on disk and a moved workspace keeps its links. Absolute
// paths and `uri=file:///…` still work, so older links keep opening.
//
// Checking a link (link_create, and the chat marking dead links) confirms the
// file exists. A thorough check also finds the quote in the file and sets the
// page, line or cell from where it actually is, so a citation's location
// comes from the file, never from arithmetic.

import { URI } from '../../platform/uri.js';
import { mintParallxUri } from '../../links/parallxUri.js';
import type { LinksApiCheck, LinksApiParsedLink } from '../../links/linksApi.js';
import type { IFileLocateResult, IFileSpot } from '../../services/fileLocator.js';
import type { IFileRevealTarget } from '../../editor/fileReveal.js';

/** FileType.Directory, as the workspace fs API reports it. */
const FILE_TYPE_DIRECTORY = 2;

export interface IFileLinkHost {
  /** The workspace's first folder, or undefined when none is open. */
  workspaceRoot(): URI | undefined;
  /** Throws when the path does not exist. */
  stat(uri: string): Promise<{ type: number }>;
  locate(uri: string, quote?: string): Promise<IFileLocateResult>;
}

/** A file a link's path may mean. */
export interface IFileLinkCandidate {
  readonly uri: URI;
  /** Path relative to the workspace root, when the file is inside it. */
  readonly relative?: string;
}

function normalizeSlashes(p: string): string {
  return p.trim().replace(/\\/g, '/');
}

/** Workspace-relative path of `uri`, or undefined when it is outside `root`. */
export function relativeToRoot(root: URI | undefined, uri: URI): string | undefined {
  if (!root) return undefined;
  const base = root.path.replace(/\/+$/, '');
  const full = uri.path;
  // Windows paths compare without regard to case.
  const caseless = /^\/[a-zA-Z]:/.test(base);
  const a = caseless ? base.toLowerCase() : base;
  const b = caseless ? full.toLowerCase() : full;
  if (b.length > a.length + 1 && b.startsWith(a + '/')) return full.slice(base.length + 1);
  return undefined;
}

/**
 * The files a link's `path` (or `uri`) may mean, most likely first. Empty
 * when it names nothing usable (no path, or `..` climbing out of the
 * workspace).
 */
export function fileLinkCandidates(params: Readonly<Record<string, string>>, root: URI | undefined): IFileLinkCandidate[] {
  const explicit = params['uri'];
  if (explicit && explicit.startsWith('file:')) {
    const uri = URI.parse(explicit);
    return [{ uri, relative: relativeToRoot(root, uri) }];
  }
  const raw = normalizeSlashes(params['path'] ?? '');
  if (!raw) return [];

  // Windows absolute: C:/…
  if (/^[a-zA-Z]:\//.test(raw)) {
    const uri = URI.file(raw);
    return [{ uri, relative: relativeToRoot(root, uri) }];
  }

  const rel = raw.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const segments = rel.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) return [];

  const out: IFileLinkCandidate[] = [];
  // A leading slash is usually a workspace path written with one; on
  // macOS/Linux it may also be a real absolute path, tried second.
  if (root && segments.length > 0) {
    const uri = root.joinPath(segments.join('/'));
    out.push({ uri, relative: segments.join('/') });
  }
  if (raw.startsWith('/')) {
    const uri = URI.file(raw);
    out.push({ uri, relative: relativeToRoot(root, uri) });
  }
  return out;
}

function positiveInt(v: string | undefined): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The reveal a link asks for, from its query parameters. */
export function revealTargetOf(params: Readonly<Record<string, string>>): IFileRevealTarget {
  const quote = params['quote']?.trim();
  return {
    ...(positiveInt(params['page']) ? { page: positiveInt(params['page']) } : {}),
    ...(positiveInt(params['line']) ? { line: positiveInt(params['line']) } : {}),
    ...(positiveInt(params['endLine']) ? { endLine: positiveInt(params['endLine']) } : {}),
    ...(params['sheet'] ? { sheet: params['sheet'] } : {}),
    ...(params['cell'] ? { cell: params['cell'].trim().toUpperCase() } : {}),
    ...(quote ? { quote } : {}),
  };
}

/** The first candidate that exists as a file, or why none does. */
export async function findLinkedFile(
  host: IFileLinkHost,
  params: Readonly<Record<string, string>>,
): Promise<{ file: IFileLinkCandidate } | { error: string }> {
  const shown = params['path'] ?? params['uri'] ?? '';
  const candidates = fileLinkCandidates(params, host.workspaceRoot());
  if (candidates.length === 0) {
    if (!shown.trim()) return { error: 'The link has no path. Give the file\'s path as the file tools show it (relative to the workspace).' };
    if (!host.workspaceRoot()) return { error: 'No workspace folder is open, so a workspace path cannot be resolved.' };
    return { error: `"${shown}" climbs out of the workspace ("..") and cannot be linked.` };
  }
  for (const candidate of candidates) {
    let stat: { type: number };
    try {
      stat = await host.stat(candidate.uri.toString());
    } catch {
      continue;
    }
    if (stat.type === FILE_TYPE_DIRECTORY) {
      return { error: `"${shown}" is a folder, not a file.` };
    }
    // A file, or a link to one.
    return { file: candidate };
  }
  return {
    error: `No file at "${shown}" in this workspace. Use the path exactly as the file tools show it, relative to the workspace (e.g. "Papers/Clark.pdf"); do not add a drive or folder in front of it.`,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function spotLocation(spot: IFileSpot, result: IFileLocateResult): string {
  if (spot.page) {
    const total = result.pageCount ?? 0;
    return spot.endPage
      ? `pages ${spot.page} to ${spot.endPage} of ${total}`
      : `page ${spot.page} of ${total}`;
  }
  if (spot.line) {
    return spot.endLine ? `lines ${spot.line} to ${spot.endLine}` : `line ${spot.line}`;
  }
  if (spot.sheet && spot.cell) return `sheet "${spot.sheet}", cell ${spot.cell}`;
  return '';
}

/** Pick the spot a link means: the one at the location it gave, else the first. */
function pickSpot(spots: readonly IFileSpot[], asked: IFileRevealTarget): IFileSpot {
  const atPage = asked.page ? spots.find((s) => s.page !== undefined && asked.page! >= s.page && asked.page! <= (s.endPage ?? s.page)) : undefined;
  const atLine = asked.line ? spots.find((s) => s.line !== undefined && asked.line! >= s.line && asked.line! <= (s.endLine ?? s.line)) : undefined;
  const atCell = asked.cell ? spots.find((s) => s.cell === asked.cell && (!asked.sheet || s.sheet?.toLowerCase() === asked.sheet.toLowerCase())) : undefined;
  return atPage ?? atLine ?? atCell ?? spots[0];
}

function otherSpots(spots: readonly IFileSpot[], chosen: IFileSpot, result: IFileLocateResult): string {
  const others = spots.filter((s) => s !== chosen).map((s) => spotLocation(s, result).replace(/ of \d+$/, '')).filter(Boolean);
  if (others.length === 0) return '';
  const shown = others.slice(0, 5).join('; ');
  return ` The same words also appear at ${shown}${others.length > 5 ? ` and ${others.length - 5} more` : ''}; pass that location to pick another.`;
}

/**
 * Check a file link. Always: the file exists in the workspace. With
 * `thorough`: the quote is in the file, and the page, line or cell is set
 * from where it is (a page, line or cell given without a quote is checked
 * against the file's size). Returns the canonical link: the workspace path,
 * the location found, and the quote in the file's own wording.
 */
export async function checkFileLink(
  host: IFileLinkHost,
  parsed: LinksApiParsedLink,
  options: { readonly thorough?: boolean },
): Promise<LinksApiCheck> {
  const found = await findLinkedFile(host, parsed.params);
  if ('error' in found) return { ok: false, error: found.error };
  const { file } = found;
  const path = file.relative ?? file.uri.fsPath;
  const name = path.split('/').pop() || path;
  const asked = revealTargetOf(parsed.params);
  const mint = (anchors: Record<string, string | number | undefined>) =>
    mintParallxUri('explorer', 'file', { path, ...anchors });

  if (!options.thorough) {
    return { ok: true, uri: mint({ page: asked.page, line: asked.line, endLine: asked.endLine, sheet: asked.sheet, cell: asked.cell, quote: asked.quote }), checked: `"${name}" exists.` };
  }

  let result: IFileLocateResult;
  try {
    result = await host.locate(file.uri.toString(), asked.quote);
  } catch (err) {
    return { ok: false, error: `"${name}" exists but could not be read to check the link: ${err instanceof Error ? err.message : String(err)}` };
  }

  const dropped: string[] = [];
  const keep = (key: 'page' | 'line' | 'cell', applies: boolean) => {
    if (!applies && asked[key] !== undefined) dropped.push(key);
    return applies;
  };
  const droppedNote = () => dropped.length
    ? ` (${dropped.join(', ')} ${dropped.length === 1 ? 'does' : 'do'} not apply to this kind of file and ${dropped.length === 1 ? 'was' : 'were'} left out)`
    : '';

  if (asked.quote) {
    if (result.quoteTooShort) {
      return { ok: false, error: 'The quote is too short to find reliably. Quote a full phrase from the file, at least a few words.' };
    }
    if (result.spots.length === 0) {
      return {
        ok: false,
        error: `The quote was not found in "${name}". Quote the passage exactly as the file has it (copy it from what the file tools returned), or leave the quote out and link the file only.`,
      };
    }
    const spot = pickSpot(result.spots, asked);
    const location = spotLocation(spot, result);
    keep('page', result.addressing === 'page');
    keep('line', result.addressing === 'line');
    keep('cell', result.addressing === 'cell');
    const moved = asked.page && spot.page && (asked.page < spot.page || asked.page > (spot.endPage ?? spot.page))
      ? ` Page ${asked.page} was given; the quote is on page ${spot.page}, so the link uses that.`
      : asked.line && spot.line && (asked.line < spot.line || asked.line > (spot.endLine ?? spot.line))
        ? ` Line ${asked.line} was given; the quote is on line ${spot.line}, so the link uses that.`
        : '';
    const uri = mint({
      page: spot.page,
      line: spot.line,
      endLine: spot.endLine,
      sheet: spot.sheet,
      cell: spot.cell,
      quote: spot.text,
    });
    const where = location ? `on ${location}` : 'in it (this kind of file has no pages or lines, so the link opens the file)';
    return {
      ok: true,
      uri,
      checked: `"${name}" exists and the quote was found ${where}${droppedNote()}.${moved}${otherSpots(result.spots, spot, result)}`,
      ...(location ? { location } : {}),
    };
  }

  // No quote: check what was given against the file's size.
  if (result.addressing === 'page' && keep('page', true) && asked.page !== undefined) {
    const total = result.pageCount ?? 0;
    if (asked.page > total) return { ok: false, error: `"${name}" has ${plural(total, 'page', 'pages')}; page ${asked.page} is past the end.` };
    keep('line', false); keep('cell', false);
    return {
      ok: true,
      uri: mint({ page: asked.page }),
      checked: `"${name}" exists and has page ${asked.page} of ${total}${droppedNote()}. No quote was given, so nothing on the page was checked; pass the quoted words to confirm the page.`,
      location: `page ${asked.page} of ${total}`,
    };
  }
  if (result.addressing === 'line' && keep('line', true) && asked.line !== undefined) {
    const total = result.lineCount ?? 0;
    if (asked.line > total) return { ok: false, error: `"${name}" has ${plural(total, 'line', 'lines')}; line ${asked.line} is past the end.` };
    const endLine = asked.endLine && asked.endLine > asked.line ? Math.min(asked.endLine, total) : undefined;
    keep('page', false); keep('cell', false);
    const location = endLine ? `lines ${asked.line} to ${endLine}` : `line ${asked.line}`;
    return {
      ok: true,
      uri: mint({ line: asked.line, endLine }),
      checked: `"${name}" exists and has ${location}${droppedNote()}. No quote was given, so the text there was not checked; pass the quoted words to confirm the line.`,
      location,
    };
  }
  if (result.addressing === 'cell' && keep('cell', true) && (asked.cell || asked.sheet)) {
    const sheets = result.sheets ?? [];
    const sheet = asked.sheet ? sheets.find((s) => s.toLowerCase() === asked.sheet!.toLowerCase()) : sheets[0];
    if (asked.sheet && !sheet) return { ok: false, error: `"${name}" has no sheet "${asked.sheet}". Its sheets: ${sheets.join(', ') || '(none)'}.` };
    if (asked.cell && !/^[A-Z]{1,3}\d{1,7}$/.test(asked.cell)) return { ok: false, error: `"${asked.cell}" is not a cell reference (use the A1 style, e.g. B206).` };
    keep('page', false); keep('line', false);
    const location = asked.cell ? `sheet "${sheet}", cell ${asked.cell}` : `sheet "${sheet}"`;
    return {
      ok: true,
      uri: mint({ sheet, cell: asked.cell }),
      checked: `"${name}" exists and has ${asked.cell ? `sheet "${sheet}"` : location}${droppedNote()}. No quote was given, so the cell's text was not checked; pass the quoted words to find the exact cell.`,
      location,
    };
  }
  keep('page', result.addressing === 'page');
  keep('line', result.addressing === 'line');
  keep('cell', result.addressing === 'cell');
  return { ok: true, uri: mint({}), checked: `"${name}" exists${droppedNote()}. The link opens the file.` };
}
