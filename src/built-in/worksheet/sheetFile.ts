// sheetFile.ts — a sheet of one's own, kept as a file in the workspace.
//
// A `.sheet` file is the engine's saved workbook inside a small envelope, as
// JSON. It is the general spreadsheet: every function, a grid that grows,
// nothing of any exam. Pure, so the format is tested without the engine.

import type { IWorkbookData } from '@univerjs/core';

export const SHEET_FILE_EXTENSION = '.sheet';
export const SHEET_FILE_FORMAT = 'parallx-sheet';
export const SHEET_FILE_VERSION = 1;
/** A file-backed pane's instance id is this prefix and the file's path (the core's `registerFileEditor`). */
const FILE_INSTANCE_PREFIX = 'file:';

export interface ParsedSheetFile {
  /** The saved workbook; null for a new, empty sheet. */
  readonly workbook: IWorkbookData | null;
  /** Why the file cannot be opened as a sheet; absent when it can. */
  readonly error?: string;
}

/** The text a sheet file holds. */
export function serializeSheetFile(workbook: IWorkbookData | null): string {
  return `${JSON.stringify({ format: SHEET_FILE_FORMAT, version: SHEET_FILE_VERSION, workbook })}\n`;
}

/**
 * Read a sheet file's text. An empty file is a new sheet. Anything that is
 * not this format is refused with a reason, so the pane never saves a blank
 * sheet over a file it could not read.
 */
export function parseSheetFile(text: string): ParsedSheetFile {
  if (!text.trim()) return { workbook: null };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { workbook: null, error: 'It is not a sheet file: its contents could not be read.' }; }
  const file = data as { format?: unknown; version?: unknown; workbook?: unknown } | null;
  if (!file || typeof file !== 'object' || file.format !== SHEET_FILE_FORMAT) return { workbook: null, error: 'It is not a sheet file.' };
  if (typeof file.version !== 'number' || file.version > SHEET_FILE_VERSION) return { workbook: null, error: 'It was saved by a newer version of Parallx.' };
  const workbook = file.workbook as IWorkbookData | null | undefined;
  if (workbook == null) return { workbook: null };
  if (typeof workbook !== 'object' || !Array.isArray(workbook.sheetOrder) || !workbook.sheets || typeof workbook.sheets !== 'object') {
    return { workbook: null, error: 'Its workbook is damaged.' };
  }
  return { workbook };
}

/** The file path behind a pane's instance id, or null when the pane is not a file's. */
export function sheetFilePathOf(instanceId: string): string | null {
  return instanceId.startsWith(FILE_INSTANCE_PREFIX) ? instanceId.slice(FILE_INSTANCE_PREFIX.length) : null;
}

/** A file path's name without its folder or the sheet extension. */
export function sheetTitle(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.toLowerCase().endsWith(SHEET_FILE_EXTENSION) ? base.slice(0, -SHEET_FILE_EXTENSION.length) : base;
}

/** A typed name made safe for a file: no folders, none of the characters a file name may not hold. */
export function cleanSheetName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const withoutExt = cleaned.toLowerCase().endsWith(SHEET_FILE_EXTENSION) ? cleaned.slice(0, -SHEET_FILE_EXTENSION.length).trim() : cleaned;
  return withoutExt || 'Untitled';
}

/** The first free file name for a sheet called `name`: "Budget.sheet", then "Budget 2.sheet". Names compare without case. */
export function uniqueSheetFileName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const base = cleanSheetName(name);
  let candidate = `${base}${SHEET_FILE_EXTENSION}`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} ${n}${SHEET_FILE_EXTENSION}`;
  return candidate;
}
