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

  const sections = [];
  for (const item of contentItems) {
    const html = readZipEntryText(zip, item.path);
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

/**
 * Check if a file extension is a supported rich document format.
 * @param {string} ext — lowercase extension including dot (e.g. '.pdf')
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
  isRichDocument,
  RICH_DOCUMENT_EXTENSIONS,
  MAX_RICH_DOC_SIZE,
};
