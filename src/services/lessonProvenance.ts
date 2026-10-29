// lessonProvenance.ts — where each memory lesson came from.
//
// docs/MEMORY_BRIEF.md step 1. A lesson used to carry no trace of the chat
// that taught it, so a wrong one could only be deleted and hoped about. Now
// memory_write stamps every lesson it writes with the chat and the day, in
// front matter the lesson file keeps:
//
//   ---
//   sources:
//     - YYYY-MM-DD <session id>
//   ---
//   (the lesson)
//
// The stamp is the tool's, never the model's, so a lesson cannot be written
// without one. A rewrite adds its own source and keeps the earlier ones.
// Lessons written before this read as having no recorded source.

import { appDayKey } from './localTime.js';

export interface ILessonSource {
  /** The day it was written (YYYY-MM-DD, the app's time zone). */
  readonly date: string;
  /** The chat it was written in, when known. */
  readonly session?: string;
}

const FRONT = /^---\n([\s\S]*?)\n---\n?/;

/** A lesson's sources and its body (the text after the front matter). */
export function readLesson(text: string): { sources: ILessonSource[]; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  const m = FRONT.exec(normalized);
  if (!m) return { sources: [], body: normalized };
  const sources: ILessonSource[] = [];
  let inSources = false;
  for (const line of m[1].split('\n')) {
    if (/^sources:\s*$/.test(line)) { inSources = true; continue; }
    if (!/^\s/.test(line)) inSources = false;
    const item = inSources ? /^\s+-\s+(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?\s*$/.exec(line) : null;
    if (item) sources.push(item[2] ? { date: item[1], session: item[2] } : { date: item[1] });
  }
  return { sources, body: normalized.slice(m[0].length) };
}

/**
 * The lesson file for `body`, stamped with this write's source and keeping
 * the sources of `previous` (the file being replaced, if any). The same chat
 * on the same day is recorded once.
 */
export function stampLesson(body: string, sessionId: string | undefined, previous = '', now = new Date()): string {
  const kept = readLesson(previous).sources;
  const fresh: ILessonSource = sessionId ? { date: appDayKey(now), session: sessionId } : { date: appDayKey(now) };
  const all = kept.some((s) => s.date === fresh.date && s.session === fresh.session) ? kept : [...kept, fresh];
  const text = readLesson(body).body.replace(/^\n+/, '');
  const lines = all.map((s) => `  - ${s.date}${s.session ? ` ${s.session}` : ''}`);
  return `---\nsources:\n${lines.join('\n')}\n---\n${text}`;
}
