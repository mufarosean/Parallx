// doclingReadings.test.ts — a document's reading is kept beside the app's
// data and handed out only while the document is the one that was read.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const readings = require('../../electron/doclingReadings.cjs');

let appRoot = '';
let doc = '';
const reading = { version: 1, ocr: true, pages: [{ page: 1, width: 600, height: 800, lines: [{ text: 'a line', box: [1, 2, 3, 4] }] }], blocks: [], tables: [] };

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), 'px-readings-'));
  doc = join(appRoot, 'scan.pdf');
  writeFileSync(doc, 'pdf bytes');
});
afterEach(() => { rmSync(appRoot, { recursive: true, force: true }); });

describe('kept readings', () => {
  it('keeps the reading and hands the rest of the result on without it', async () => {
    const rest = await readings.keep(appRoot, doc, { markdown: '# text', page_count: 1, reading });
    expect(rest).toEqual({ markdown: '# text', page_count: 1 });
    expect(await readings.get(appRoot, doc)).toEqual(reading);
    expect(readdirSync(join(appRoot, 'data', 'readings')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('finds the reading whatever the case or form of the path', async () => {
    await readings.keep(appRoot, doc, { markdown: '', reading });
    expect(await readings.get(appRoot, process.platform === 'win32' ? doc.toUpperCase() : doc)).toEqual(reading);
    expect(await readings.get(appRoot, join(appRoot, '.', 'scan.pdf'))).toEqual(reading);
  });

  it('gives nothing once the document has changed', async () => {
    await readings.keep(appRoot, doc, { markdown: '', reading });
    writeFileSync(doc, 'different pdf bytes, a different size');
    expect(await readings.get(appRoot, doc)).toBeNull();
  });

  it('gives nothing when only the modified time moved', async () => {
    await readings.keep(appRoot, doc, { markdown: '', reading });
    const later = new Date(Date.now() + 60_000);
    utimesSync(doc, later, later);
    expect(await readings.get(appRoot, doc)).toBeNull();
  });

  it('gives nothing for a document never read, and passes a result with no reading through', async () => {
    expect(await readings.get(appRoot, doc)).toBeNull();
    const plain = { markdown: 'x' };
    expect(await readings.keep(appRoot, doc, plain)).toBe(plain);
    expect(await readings.keep(appRoot, doc, { markdown: 'x', reading: null })).toEqual({ markdown: 'x' });
    expect(await readings.get(appRoot, doc)).toBeNull();
  });
});
