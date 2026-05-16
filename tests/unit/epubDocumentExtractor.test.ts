// tests/unit/epubDocumentExtractor.test.ts - EPUB fallback extraction coverage

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const {
  extractText,
  isRichDocument,
  RICH_DOCUMENT_EXTENSIONS,
} = require('../../electron/documentExtractor.cjs');

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('EPUB document extraction', () => {
  it('registers .epub as a rich document format', () => {
    expect(RICH_DOCUMENT_EXTENSIONS.has('.epub')).toBe(true);
    expect(isRichDocument('.epub')).toBe(true);
  });

  it('extracts XHTML text in EPUB spine order', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'parallx-epub-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'book.epub');
    await writeFile(filePath, createMinimalEpub());

    const result = await extractText(filePath);

    expect(result.format).toBe('epub');
    expect(result.metadata.chapterCount).toBe(2);
    expect(result.text).toContain('Chapter One');
    expect(result.text).toContain('A line with emphasis & meaning.');
    expect(result.text).toContain('Chapter Two');
    expect(result.text).toContain('Another idea -- connected.');
    expect(result.text.indexOf('Chapter One')).toBeLessThan(result.text.indexOf('Chapter Two'));
    expect(result.text).not.toContain('<p>');
    expect(result.text).not.toContain('console.log');
  });
});

function createMinimalEpub(): Buffer {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf8'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, 'utf8'));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <manifest>
    <item id="chapter2" href="Text/chapter%20two.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`, 'utf8'));
  zip.addFile('OEBPS/Text/chapter1.xhtml', Buffer.from(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Book Title</title><script>console.log('skip me')</script></head>
  <body><h1>Chapter One</h1><p>A line with <em>emphasis</em> &amp; meaning.</p></body>
</html>`, 'utf8'));
  zip.addFile('OEBPS/Text/chapter two.xhtml', Buffer.from(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><h2>Chapter Two</h2><p>Another idea &mdash; connected.</p></body>
</html>`, 'utf8'));
  zip.addFile('OEBPS/nav.xhtml', Buffer.from('<html><body><nav>skip navigation</nav></body></html>', 'utf8'));
  return zip.toBuffer();
}
