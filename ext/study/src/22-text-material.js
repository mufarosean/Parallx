// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 22: NOTES FILES AS MATERIAL (.md, .markdown, .txt)
// ═══════════════════════════════════════════════════════════════════════════════
//
// A notes file in the workspace is studied as a PDF is: the same concept map,
// questions, checks and Show Source. It has no pages, so it is cut into parts
// that play their role: a part starts at each Markdown heading and holds at
// most about ST_TEXT_PART_CHARS characters, cut where a paragraph ends. The
// prompts tag the parts [Page N] as they tag a PDF's pages, the anchor check
// finds a quote on its part, and Show Source opens the file in its own editor
// at the quote (the core text and code editors find a revealed quote and
// scroll to it). The headings are the chapters, nested as a PDF outline is.
// The file is read through api.workspace.fs each time its text is needed
// (cached in memory by content hash, like a PDF's extraction).

/** File kinds studied as notes. */
const ST_TEXT_EXTS = ['.md', '.markdown', '.txt'];
/** Every file kind Add Material… and Study This Document… offer. */
const ST_DOCUMENT_EXTS = ['.pdf', ...ST_TEXT_EXTS];
/** About a printed page of prose: enough for a concept or two, small enough to quote from. */
const ST_TEXT_PART_CHARS = 3000;
/** Shorter than this is not worth a session (a PDF's floor is 200 characters of text). */
const ST_TEXT_MIN_CHARS = 120;

function stIsTextPath(p) {
  const s = String(p || '').toLowerCase();
  return ST_TEXT_EXTS.some((e) => s.endsWith(e));
}

/** Does the material have chapters to choose from (a PDF's outline, a notes file's headings)? */
function stHasSections(material) {
  return !!material && (material.kind === 'pdf' || material.kind === 'text');
}

/**
 * A notes file cut into parts: { parts, outline }. A Markdown heading (outside
 * a fenced code block) starts a part and is an outline entry { title, page,
 * level } (level 0 for the top heading level used); a part longer than the
 * limit ends at the next blank line, or at a line once it is twice the limit.
 */
function stTextParts(text, markdown) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const parts = [];
  const heads = [];
  let cur = [];
  let size = 0;
  let fenced = false;
  const flush = () => {
    const body = cur.join('\n').replace(/^\n+|\s+$/g, '');
    if (body.trim()) parts.push(body);
    cur = [];
    size = 0;
  };
  for (const line of lines) {
    if (markdown && /^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const head = markdown && !fenced ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (head && head[2]) {
      flush();
      heads.push({ title: head[2], page: parts.length + 1, depth: head[1].length });
    } else if (size > ST_TEXT_PART_CHARS && (!line.trim() || size > 2 * ST_TEXT_PART_CHARS)) {
      flush();
    }
    cur.push(line);
    size += line.length + 1;
  }
  flush();
  const top = heads.length ? Math.min(...heads.map((h) => h.depth)) : 1;
  const outline = heads.filter((h) => h.page <= parts.length).map((h) => ({ title: h.title, page: h.page, level: h.depth - top }));
  return { parts, outline };
}

/** A notes file's text as Study reads every material's: { pageTexts, text, pageCount, outline, title }. */
async function stReadTextMaterial(fsPath) {
  const raw = await stReadWorkspaceFile(fsPath);
  const text = String(raw || '').trim();
  if (text.length < ST_TEXT_MIN_CHARS) {
    throw new Error(text.length === 0 ? 'That file is empty.' : `That file holds only ${text.length} characters of text, too little to study.`);
  }
  const markdown = /\.(md|markdown)$/i.test(String(fsPath));
  const { parts, outline } = stTextParts(text, markdown);
  const first = outline.find((o) => o.level === 0);
  return { pageTexts: parts, text, pageCount: parts.length, outline, title: first ? first.title : '' };
}

/** stMaterialText for a notes file (20-data.js asks here for kind 'text'). A file whose hash changed is brought up to date first (24-text-edits.js). */
async function stTextMaterialText(material) {
  const r = await stReadTextMaterial(stFsPathOf(material.uri));
  if (material.id && stHashText(r.text) !== material.contentHash) await stTextEdited(material.id, r);
  return { pageTexts: r.pageTexts, text: r.text, pageCount: r.pageCount };
}

/** Ingest a notes file: its parts, its headings as chapters, the material. An edited one keeps what did not change (stTextEdited). Returns the material. */
async function stIngestTextFile(fsPath) {
  const path = stFsPathOf(fsPath);
  const r = await stReadTextMaterial(path);
  // No headings: one chapter, the whole file (a PDF's fallback names pages, which a notes file has none of).
  const sections = stTextSections(r);
  const uri = stUriOf(path);
  const prior = await db.get("SELECT id, label, content_hash FROM st_materials WHERE kind = 'text' AND uri = ?", [uri]);
  if (prior && prior.content_hash !== stHashText(r.text)) await stTextEdited(prior.id, r);
  const material = await stUpsertMaterial({
    kind: 'text',
    uri,
    label: prior && prior.label ? prior.label : stMaterialLabelFor(stFileNameOf(path), r.title),
    pageCount: r.pageCount,
    contentHash: stHashText(r.text),
    outline: sections,
  });
  await stEnsureSections(material.id, sections);
  stTextCachePut(stTextCacheKey(material), { pageTexts: r.pageTexts, text: r.text, pageCount: r.pageCount });
  return material;
}

/** Ingest a PDF or a notes file, by its extension. */
async function stIngestDocument(fsPath) {
  return stIsTextPath(fsPath) ? stIngestTextFile(fsPath) : stIngestPdf(fsPath);
}

/** The workspace's PDFs and notes files in one quick pick; the chosen fsPath, or null. */
async function stPickWorkspaceDocument() {
  return stPickWorkspaceFile(ST_DOCUMENT_EXTS, 'Study which document? (PDF, Markdown or text)');
}
