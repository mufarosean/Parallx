// electron/documentExtractor.cjs — Rich document text extraction for indexing
//
// Extracts plain text from binary/rich document formats so the indexing
// pipeline can chunk and embed them alongside regular text files.
//
// Supported formats:
//   PDF  (.pdf)      — via pdf-parse (pure JS, pdf.js-based)
//   Excel (.xlsx, .xls, .xlsm, .xlsb, .ods, .numbers) — via xlsx (SheetJS)
//   CSV   (.csv, .tsv) — via xlsx (SheetJS)
//   Word  (.docx)    — via mammoth
//   EPUB  (.epub)    - via adm-zip + spine-aware XHTML text extraction
//
// Design:
//   - Runs in Electron main process (full Node.js access)
//   - Each extractor returns { text, metadata } or throws
//   - Caller is the IPC handler in main.cjs
//   - MAX size guard is enforced by caller, not here

const path = require('path');
const fs = require('fs/promises');

// ─── Extension → Extractor mapping ──────────────────────────────────────────

/**
 * Set of extensions that this module can extract text from.
 * Lowercase, including the dot.
 */
const RICH_DOCUMENT_EXTENSIONS = new Set([
  // PDF
  '.pdf',
  // Excel / Spreadsheet
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers',
  // Delimited (handled by SheetJS for uniformity)
  '.csv', '.tsv',
  // Word
  '.docx',
  // E-books
  '.epub',
]);

/**
 * Maximum file size for rich document extraction (25 MB).
 * Study PDFs are often materially larger than lightweight notes; keep the
 * cap high enough for real workspaces while still guarding pathological files.
 */
const MAX_RICH_DOC_SIZE = 25 * 1024 * 1024;

// ─── Lazy module loading ────────────────────────────────────────────────────
// We lazy-load the extraction libraries so they don't slow down app startup.

/** @type {import('pdf-parse') | null} */
let _pdfParse = null;
/** @type {typeof import('xlsx') | null} */
let _xlsx = null;
/** @type {typeof import('mammoth') | null} */
let _mammoth = null;
/** @type {typeof import('adm-zip') | null} */
let _AdmZip = null;

function getPdfParse() {
  if (!_pdfParse) {
    _pdfParse = require('pdf-parse');
  }
  return _pdfParse;
}

function getXlsx() {
  if (!_xlsx) {
    _xlsx = require('xlsx');
  }
  return _xlsx;
}

function getMammoth() {
  if (!_mammoth) {
    _mammoth = require('mammoth');
  }
  return _mammoth;
}

function getAdmZip() {
  if (!_AdmZip) {
    _AdmZip = require('adm-zip');
  }
  return _AdmZip;
}

// ─── Extractors ─────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF file.
 * @param {Buffer} buffer
 * @param {string} filePath
 * @returns {Promise<{ text: string; pageCount: number }>}
 */
async function extractPdf(buffer, filePath) {
  const { PDFParse } = getPdfParse();
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result.text || '',
      pageCount: result.total || 0,
    };
  } finally {
    try { await parser.destroy(); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Extract text from a spreadsheet file (Excel, ODS, CSV, etc.).
 * Converts each sheet to a tab-separated text representation.
 * @param {Buffer} buffer
 * @param {string} filePath
 * @returns {{ text: string; sheetCount: number }}
 */
function extractSpreadsheet(buffer, filePath) {
  const XLSX = getXlsx();
  const ext = path.extname(filePath).toLowerCase();

  // SheetJS read options
  const readOpts = { type: 'buffer' };

  // For CSV/TSV, hint the parser
  if (ext === '.csv') {
    readOpts.raw = true;
  } else if (ext === '.tsv') {
    readOpts.raw = true;
    readOpts.FS = '\t';
  }

  const workbook = XLSX.read(buffer, readOpts);
  const sections = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Convert to CSV text (light, LLM-friendly)
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      if (workbook.SheetNames.length > 1) {
        sections.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      } else {
        sections.push(csv);
      }
    }
  }

  return {
    text: sections.join('\n\n'),
    sheetCount: workbook.SheetNames.length,
  };
}

/**
 * Extract text from a Word (.docx) file.
 * @param {Buffer} buffer
 * @param {string} filePath
 * @returns {Promise<{ text: string }>}
 */
async function extractDocx(buffer, filePath) {
  const mammoth = getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value || '',
  };
}

/**
 * Extract text from an EPUB file.
 * EPUB is a ZIP archive with an OPF package document that defines the
 * manifest and reading order. We follow the spine instead of scanning every
 * XHTML file so indexes and the reader match the book's intended order.
 * @param {Buffer} buffer
 * @param {string} filePath
 * @returns {{ text: string; chapterCount: number }}
 */
function extractEpub(buffer, filePath) {
  const epub = loadEpubPackage(buffer, filePath);

  const sections = [];
  for (const item of epub.contentItems) {
    const html = readZipEntryText(epub.zip, item.path);
    if (!html) continue;

    const title = extractHtmlTitle(html);
    const bodyText = htmlToPlainText(html);
    if (!bodyText) continue;

    if (title && !bodyText.toLowerCase().startsWith(title.toLowerCase())) {
      sections.push(`# ${title}\n\n${bodyText}`);
    } else {
      sections.push(bodyText);
    }
  }

  return {
    text: sections.join('\n\n').trim(),
    chapterCount: sections.length,
  };
}

function loadEpubPackage(buffer, filePath) {
  const AdmZip = getAdmZip();
  const zip = new AdmZip(buffer);
  const containerXml = readZipEntryText(zip, 'META-INF/container.xml');

  if (!containerXml) {
    throw new Error(`Invalid EPUB: missing META-INF/container.xml in ${path.basename(filePath)}`);
  }

  const rootfileMatch = containerXml.match(/<rootfile\b[^>]*\bfull-path=(["'])(.*?)\1/i);
  if (!rootfileMatch) {
    throw new Error(`Invalid EPUB: missing OPF rootfile in ${path.basename(filePath)}`);
  }

  const opfPath = normalizeZipPath(decodeHtmlEntities(rootfileMatch[2] ?? ''));
  const opfXml = readZipEntryText(zip, opfPath);
  if (!opfXml) {
    throw new Error(`Invalid EPUB: OPF package not found (${opfPath})`);
  }

  const opfDir = zipDirname(opfPath);
  const manifest = parseEpubManifest(opfXml, opfDir);
  const spineIds = parseEpubSpine(opfXml);
  const orderedItems = spineIds
    .map((idref) => manifest.get(idref))
    .filter((item) => item && isEpubHtmlItem(item));

  const contentItems = orderedItems.length > 0
    ? orderedItems
    : [...manifest.values()].filter(isEpubHtmlItem);

  return {
    zip,
    opfPath,
    opfDir,
    opfXml,
    title: extractEpubPackageTitle(opfXml),
    manifest,
    contentItems,
  };
}

function readZipEntryText(zip, entryPath) {
  const normalized = normalizeZipPath(entryPath);
  const entry = zip.getEntry(normalized);
  if (!entry) return '';
  const data = entry.getData();
  return data.toString('utf8');
}

function normalizeZipPath(entryPath) {
  return String(entryPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function zipDirname(entryPath) {
  const normalized = normalizeZipPath(entryPath);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
}

function resolveEpubPath(baseDir, href) {
  const cleanHref = safeDecodeUri(String(href || '').split('#')[0].split('?')[0]);
  const joined = baseDir ? `${baseDir}/${cleanHref}` : cleanHref;
  return normalizeZipPath(path.posix.normalize(joined));
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseEpubManifest(opfXml, opfDir) {
  const manifest = new Map();
  const itemRe = /<item\b[^>]*\/?>/gi;
  let match;
  while ((match = itemRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttributes(match[0]);
    if (!attrs.id || !attrs.href) continue;
    manifest.set(attrs.id, {
      id: attrs.id,
      href: attrs.href,
      mediaType: attrs['media-type'] || '',
      properties: attrs.properties || '',
      path: resolveEpubPath(opfDir, attrs.href),
    });
  }
  return manifest;
}

function parseEpubSpine(opfXml) {
  const ids = [];
  const itemrefRe = /<itemref\b[^>]*\/?>/gi;
  let match;
  while ((match = itemrefRe.exec(opfXml)) !== null) {
    const attrs = parseXmlAttributes(match[0]);
    if (attrs.idref) ids.push(attrs.idref);
  }
  return ids;
}

function extractEpubPackageTitle(opfXml) {
  const titleMatch = opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i) ||
    opfXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return '';
  return normalizeExtractedText(stripHtmlTags(titleMatch[1] ?? ''));
}

function parseXmlAttributes(tag) {
  const attrs = {};
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRe.exec(tag)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? '';
    attrs[key] = decodeHtmlEntities(value);
  }
  return attrs;
}

function isEpubHtmlItem(item) {
  const mediaType = String(item.mediaType || '').toLowerCase();
  const href = String(item.href || '').toLowerCase();
  if (String(item.properties || '').toLowerCase().split(/\s+/).includes('nav')) return false;
  return mediaType.includes('xhtml') ||
    mediaType.includes('html') ||
    href.endsWith('.xhtml') ||
    href.endsWith('.html') ||
    href.endsWith('.htm');
}

function extractHtmlTitle(html) {
  const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ||
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return '';
  return normalizeExtractedText(stripHtmlTags(titleMatch[1] ?? '')).trim();
}

function htmlToPlainText(html) {
  const withoutNoise = String(html || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '');

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ');

  return normalizeExtractedText(stripHtmlTags(withBreaks)).trim();
}

function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function normalizeExtractedText(value) {
  return decodeHtmlEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '-',
    mdash: '--',
    hellip: '...',
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
  };

  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, body) => {
    const lower = String(body).toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : entity;
  });
}

// ─── Main entry point ───────────────────────────────────────────────────────

// Safe structural XHTML subset used by the built-in EPUB reader.
const EPUB_RENDER_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre',
  'q', 'rp', 'rt', 'ruby', 's', 'section', 'small', 'span', 'strong', 'sub',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

const EPUB_RENDER_VOID_TAGS = new Set(['br', 'hr', 'img']);
const MAX_EPUB_INLINE_RESOURCE_SIZE = 2 * 1024 * 1024;

const EPUB_IMAGE_MIME_BY_EXT = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/**
 * Extract sanitized rendered EPUB chapters for the editor reader.
 *
 * This intentionally stays separate from extractText(): the indexing pipeline
 * wants compact plain text, while the editor wants safe semantic XHTML.
 * @param {string} filePath
 * @returns {Promise<{ format: 'epub'; title: string; chapters: Array<{ id: string; title: string; path: string; html: string; text: string }>; metadata: Record<string, unknown> }>}
 */
async function extractEpubReadingData(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.epub') {
    throw new Error(`Unsupported EPUB reader format: ${ext}`);
  }

  const stat = await fs.stat(filePath);
  if (stat.size > MAX_RICH_DOC_SIZE) {
    throw new Error(`File exceeds ${MAX_RICH_DOC_SIZE} byte limit (${stat.size} bytes)`);
  }

  const buffer = await fs.readFile(filePath);
  const epub = loadEpubPackage(buffer, filePath);
  const chapters = [];

  for (const item of epub.contentItems) {
    const rawHtml = readZipEntryText(epub.zip, item.path);
    if (!rawHtml) continue;

    const fragment = extractHtmlBody(rawHtml);
    const html = sanitizeEpubHtmlFragment(fragment, item.path, epub.zip, epub.manifest);
    const text = htmlToPlainText(rawHtml);
    if (!html.trim() && !text.trim()) continue;

    chapters.push({
      id: sanitizeDomToken(item.id || `chapter-${chapters.length + 1}`),
      title: extractHtmlTitle(rawHtml) || `Chapter ${chapters.length + 1}`,
      path: item.path,
      html,
      text,
    });
  }

  return {
    format: 'epub',
    title: epub.title || path.basename(filePath, path.extname(filePath)),
    chapters,
    metadata: {
      chapterCount: chapters.length,
      sourcePath: filePath,
    },
  };
}

function extractHtmlBody(html) {
  const bodyMatch = String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : String(html || '');
}

function sanitizeEpubHtmlFragment(fragment, chapterPath, zip, manifest) {
  const chapterDir = zipDirname(chapterPath);
  const withoutNoise = String(fragment || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '');

  return withoutNoise.replace(/<\/?([a-zA-Z][\w:.-]*)([^>]*)>/g, (full, rawTag) => {
    const tag = normalizeHtmlTagName(rawTag);
    if (!EPUB_RENDER_ALLOWED_TAGS.has(tag)) return '';
    if (/^<\s*\//.test(full)) return `</${tag}>`;

    const attrs = parseXmlAttributes(full);
    const attrText = sanitizeEpubAttributes(tag, attrs, chapterDir, zip, manifest);
    const closing = EPUB_RENDER_VOID_TAGS.has(tag) ? '' : '';
    return `<${tag}${attrText}${closing}>`;
  }).trim();
}

function normalizeHtmlTagName(tag) {
  const clean = String(tag || '').toLowerCase();
  const colon = clean.lastIndexOf(':');
  return colon >= 0 ? clean.slice(colon + 1) : clean;
}

function sanitizeEpubAttributes(tag, attrs, chapterDir, zip, manifest) {
  const safe = [];
  const id = sanitizeDomToken(attrs.id || '');
  const className = sanitizeClassList(attrs.class || '');
  const title = attrs.title ? escapeHtmlAttr(attrs.title) : '';

  if (id) safe.push(`id="${id}"`);
  if (className) safe.push(`class="${className}"`);
  if (title) safe.push(`title="${title}"`);

  if (tag === 'a') {
    const href = sanitizeEpubHref(attrs.href || '');
    if (href) safe.push(`href="${href}"`);
  }

  if (tag === 'img') {
    const src = inlineEpubImageSrc(zip, chapterDir, attrs.src || attrs['xlink:href'] || '', manifest);
    if (src) safe.push(`src="${src}"`);
    if (attrs.alt) safe.push(`alt="${escapeHtmlAttr(attrs.alt)}"`);
    safe.push('loading="lazy"');
    safe.push('decoding="async"');
  }

  return safe.length > 0 ? ` ${safe.join(' ')}` : '';
}

function sanitizeEpubHref(href) {
  const value = String(href || '').trim();
  if (!value || /^(?:javascript|data|file|http|https):/i.test(value)) return '';
  if (value.startsWith('#')) return escapeHtmlAttr(value);
  const hashIdx = value.indexOf('#');
  if (hashIdx >= 0 && hashIdx < value.length - 1) {
    return escapeHtmlAttr(`#${value.slice(hashIdx + 1)}`);
  }
  return '';
}

function inlineEpubImageSrc(zip, chapterDir, src, manifest) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif|apng);base64,/i.test(value)) return value;
  if (/^(?:javascript|data|file|http|https):/i.test(value)) return '';

  const imagePath = resolveEpubPath(chapterDir, value);
  const entry = zip.getEntry(imagePath);
  if (!entry) return '';

  const mime = getEpubImageMime(imagePath, manifest);
  if (!mime) return '';

  const data = entry.getData();
  if (!data || data.length > MAX_EPUB_INLINE_RESOURCE_SIZE) return '';
  return `data:${mime};base64,${data.toString('base64')}`;
}

function getEpubImageMime(entryPath, manifest) {
  const manifestItem = [...manifest.values()].find((item) => item.path === entryPath);
  const mediaType = String(manifestItem?.mediaType || '').toLowerCase();
  if (mediaType.startsWith('image/')) return mediaType;
  const ext = path.extname(entryPath).toLowerCase();
  return EPUB_IMAGE_MIME_BY_EXT[ext] || '';
}

function sanitizeDomToken(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sanitizeClassList(value) {
  return String(value || '')
    .split(/\s+/)
    .map(sanitizeDomToken)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
}

function escapeHtmlAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Check if a file extension is a supported rich document format.
 * @param {string} ext - lowercase extension including dot (e.g. '.pdf')
 * @returns {boolean}
 */
function isRichDocument(ext) {
  return RICH_DOCUMENT_EXTENSIONS.has(ext);
}

/**
 * Extract text from a rich document file.
 *
 * @param {string} filePath — absolute path to the file
 * @returns {Promise<{ text: string; format: string; metadata?: Record<string, unknown> }>}
 * @throws {Error} if unsupported format, file too large, or extraction fails
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (!RICH_DOCUMENT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported document format: ${ext}`);
  }

  // Size guard
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_RICH_DOC_SIZE) {
    throw new Error(`File exceeds ${MAX_RICH_DOC_SIZE} byte limit (${stat.size} bytes)`);
  }

  const buffer = await fs.readFile(filePath);

  switch (ext) {
    case '.pdf': {
      const result = await extractPdf(buffer, filePath);
      return { text: result.text, format: 'pdf', metadata: { pageCount: result.pageCount } };
    }

    case '.xlsx':
    case '.xls':
    case '.xlsm':
    case '.xlsb':
    case '.ods':
    case '.numbers':
    case '.csv':
    case '.tsv': {
      const result = extractSpreadsheet(buffer, filePath);
      return { text: result.text, format: 'spreadsheet', metadata: { sheetCount: result.sheetCount } };
    }

    case '.docx': {
      const result = await extractDocx(buffer, filePath);
      return { text: result.text, format: 'docx', metadata: {} };
    }

    case '.epub': {
      const result = extractEpub(buffer, filePath);
      return { text: result.text, format: 'epub', metadata: { chapterCount: result.chapterCount } };
    }

    default:
      throw new Error(`No extractor for format: ${ext}`);
  }
}

module.exports = {
  extractText,
  extractEpubReadingData,
  isRichDocument,
  RICH_DOCUMENT_EXTENSIONS,
  MAX_RICH_DOC_SIZE,
};
