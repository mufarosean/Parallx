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
]);

/**
 * Maximum file size for rich document extraction (10 MB).
 * PDFs and Office docs can be large; we cap to avoid memory issues.
 */
const MAX_RICH_DOC_SIZE = 10 * 1024 * 1024;

// ─── Lazy module loading ────────────────────────────────────────────────────
// We lazy-load the extraction libraries so they don't slow down app startup.

/** @type {import('pdf-parse') | null} */
let _pdfParse = null;
/** @type {typeof import('xlsx') | null} */
let _xlsx = null;
/** @type {typeof import('mammoth') | null} */
let _mammoth = null;

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
