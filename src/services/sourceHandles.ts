// sourceHandles.ts — per-session source labels for citations.
//
// A citation is right only when it points at the text the claim came from.
// Models get that wrong when they write links themselves: a page off by one,
// the right PDF but the wrong page, a file they never opened. So the tools
// that hand the model text from a real source (a file on disk, a canvas
// page) label every block they return with a short handle — "[S3]" — and
// record here where that block is and what it said. The model cites with the
// handle; the turn loop checks each citation against the recorded text and
// turns the handle into the link (openclawCitationCheck.ts). The model never
// writes a path, page or URI for anything it read.
//
// Lives in the services layer, like toolResourceRegistry, so the chat and
// canvas built-ins can both label what they read. Fail-open: a call without
// a session (heartbeat, tests) gets no handle and the block goes out with
// its plain header.

const MAX_SESSIONS = 64;
const MAX_HANDLES_PER_SESSION = 1024;
/** Text kept per block for checking: enough for a long PDF page. */
const MAX_BLOCK_TEXT_CHARS = 24_000;

export interface ISourceBlock {
  /** Same key → same handle: a block read twice keeps its label. */
  readonly key: string;
  /** Where the block is, as the model sees it: "Papers/Clark.pdf · page 13 of 30". */
  readonly location: string;
  /** Link text in the finished answer: "Clark.pdf, page 13". */
  readonly title: string;
  /** The checked `parallx://` link the handle becomes. */
  readonly uri: string;
  /** The block's text exactly as the model was shown it. */
  readonly text: string;
  /**
   * True for reading material (documents, notes, pages): an answer that uses
   * it must cite it. False for source code and data the model reads to work
   * on, which an answer need not cite.
   */
  readonly document: boolean;
}

export interface ISourceHandle extends ISourceBlock {
  /** "S3". */
  readonly id: string;
  /** Order of issue within the session (1 = first). */
  readonly serial: number;
}

interface SessionHandles {
  /** Next serial (order of issue, bumped on every label). */
  next: number;
  /** Next handle number: ids only count up, so a label never changes meaning. */
  nextId: number;
  readonly byId: Map<string, ISourceHandle>;
  readonly byKey: Map<string, ISourceHandle>;
}

const _sessions = new Map<string, SessionHandles>();
/** `parallx://` links link_create minted (and so checked) per session. */
const _minted = new Map<string, Set<string>>();

function sessionOf(sessionId: string): SessionHandles {
  let s = _sessions.get(sessionId);
  if (!s) {
    if (_sessions.size >= MAX_SESSIONS) {
      const oldest = _sessions.keys().next().value;
      if (oldest !== undefined) { _sessions.delete(oldest); _minted.delete(oldest); }
    }
    s = { next: 1, nextId: 1, byId: new Map(), byKey: new Map() };
    _sessions.set(sessionId, s);
  }
  return s;
}

/**
 * Label a block the model is about to be shown. Returns its handle id
 * ("S3"), the same one when this block was labelled before in the session.
 */
export function citeSource(sessionId: string, block: ISourceBlock): string {
  const s = sessionOf(sessionId);
  const text = block.text.length > MAX_BLOCK_TEXT_CHARS ? block.text.slice(0, MAX_BLOCK_TEXT_CHARS) : block.text;
  const existing = s.byKey.get(block.key);
  if (existing) {
    // Same spot read again: keep the label, refresh what it says.
    const refreshed: ISourceHandle = { ...existing, ...block, text, id: existing.id, serial: s.next++ };
    s.byId.set(existing.id, refreshed);
    s.byKey.set(block.key, refreshed);
    return existing.id;
  }
  if (s.byId.size >= MAX_HANDLES_PER_SESSION) {
    const oldest = s.byId.values().next().value;
    if (oldest) { s.byId.delete(oldest.id); s.byKey.delete(oldest.key); }
  }
  const serial = s.next++;
  const handle: ISourceHandle = { ...block, text, id: `S${s.nextId++}`, serial };
  s.byId.set(handle.id, handle);
  s.byKey.set(block.key, handle);
  return handle.id;
}

/** The handle with this id ("S3" or "s3"), if the session issued it. */
export function getSourceHandle(sessionId: string, id: string): ISourceHandle | undefined {
  return _sessions.get(sessionId)?.byId.get(id.toUpperCase());
}

/** Every handle the session holds, oldest first. */
export function sessionSourceHandles(sessionId: string): ISourceHandle[] {
  const s = _sessions.get(sessionId);
  return s ? [...s.byId.values()].sort((a, b) => a.serial - b.serial) : [];
}

/** A mark to take before a turn: handles issued after it are the turn's. */
export function sourceHandleMark(sessionId: string): number {
  return (_sessions.get(sessionId)?.next ?? 1) - 1;
}

/** Handles issued (or read again) since `mark`. */
export function sourceHandlesSince(sessionId: string, mark: number): ISourceHandle[] {
  return sessionSourceHandles(sessionId).filter((h) => h.serial > mark);
}

/** Record a link link_create made (it checked the target). */
export function recordMintedLink(sessionId: string, uri: string): void {
  sessionOf(sessionId);
  let set = _minted.get(sessionId);
  if (!set) { set = new Set(); _minted.set(sessionId, set); }
  set.add(uri);
}

/** Whether link_create made this link in the session. */
export function wasLinkMinted(sessionId: string, uri: string): boolean {
  return _minted.get(sessionId)?.has(uri) ?? false;
}

/** Drop a session's handles (call on session delete). */
export function clearSourceHandles(sessionId: string): void {
  _sessions.delete(sessionId);
  _minted.delete(sessionId);
}

/** Test-only: reset all state. */
export function _resetSourceHandlesForTest(): void {
  _sessions.clear();
  _minted.clear();
}

/**
 * The header line a labelled block starts with. With a handle:
 * "===== [S3] Papers/Clark.pdf · page 13 of 30 =====". Without one (no
 * session) the same line without the label.
 */
export function sourceBlockHeader(id: string | undefined, location: string): string {
  return id ? `===== [${id}] ${location} =====` : `===== ${location} =====`;
}

/** Label a block (when there is a session) and return its header line. */
export function labelSourceBlock(sessionId: string | undefined, block: ISourceBlock): string {
  return sourceBlockHeader(sessionId ? citeSource(sessionId, block) : undefined, block.location);
}

/** The "Source label" line for a whole-resource read (a canvas page), or null without a session. */
export function sourceLabelLine(sessionId: string | undefined, block: ISourceBlock): string | null {
  return sessionId ? `**Source label:** [${citeSource(sessionId, block)}] (cite what this says with it)` : null;
}

/**
 * The note that goes with labelled blocks, telling the model how to cite.
 * One sentence per rule; small models follow short rules.
 */
export const SOURCE_LABEL_GUIDE =
  '*Each block starts with its source label, like [S3]. To cite what a block says, write its label right after the sentence: "The tail factor is 1.05 [S3]." '
  + 'The app turns each label into a checked link to that exact spot. Never write a page number, line number or link for these blocks yourself.*';
