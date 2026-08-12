/**
 * E2E: mechanical import of a front/back flashcard PDF (user report:
 * "import process for pdfs that are themselves flashcards does not work").
 *
 * Generates a REAL 4-page PDF (odd pages fronts, even pages backs) with no
 * dependencies, stubs the native open-file dialog, and drives the Import
 * view end to end: load → pairing preview → import into a new deck →
 * browse shows the cards. Cleanup deletes the deck through the UI.
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const SHOT_DIR = path.join('test-results', 'flashcards');
const DECK = 'E2E Import Deck';
const PDF_PATH = path.join(os.tmpdir(), 'parallx-e2e-import.pdf');

/** Minimal valid multi-page text PDF (Helvetica, one line per page). */
function buildPdf(pageTexts: string[]): string {
  const objects: string[] = [];
  const n = pageTexts.length;
  const kids = Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`);
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>\nendobj\n`);
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  for (let i = 0; i < n; i++) {
    const text = pageTexts[i].replace(/[()\\]/g, '');
    const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(`${4 + 2 * i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>\nendobj\n`);
    objects.push(`${5 + 2 * i} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const o of objects) { offsets.push(pdf.length); pdf += o; }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return pdf;
}

test.beforeAll(async () => {
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await fs.writeFile(PDF_PATH, buildPdf([
    'E2EIMP FRONT ONE what is the loss ratio formula',
    'E2EIMP BACK ONE losses divided by premium',
    'E2EIMP FRONT TWO what is IBNR',
    'E2EIMP BACK TWO incurred but not reported',
  ]), 'latin1');
});

test('front/back PDF imports: load → pair → preview → commit → browse', async ({ window, electronApp, workspacePath }) => {
  await openFolderViaMenu(electronApp, window, workspacePath);

  // Open Flashcards → Import tab.
  await window.locator('[data-part-id="workbench.parts.statusbar"]').click();
  await window.keyboard.press('Control+Shift+P');
  await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
  await window.locator('.command-palette-input').fill('>Open Flashcards');
  await window.locator('.command-palette-item', { hasText: 'Open Flashcards' }).first().click();
  await expect(window.locator('.fc-pane')).toBeVisible({ timeout: 10_000 });

  const confirmButton = (label: string) =>
    window.locator('.parallx-modal-box button, .parallx-notification button', { hasText: label }).first();

  // Idempotence: remove a leftover deck from a prior run.
  const leftover = window.locator('.fc-deck-card', { hasText: DECK }).first();
  if (await leftover.isVisible().catch(() => false)) {
    await leftover.locator('button', { hasText: 'Delete' }).click();
    await confirmButton('Delete').click();
    await expect(leftover).not.toBeVisible({ timeout: 5_000 });
  }

  await window.locator('.fc-pane__tabs', { hasText: 'Import' }).getByText('Import', { exact: true }).click();
  await expect(window.locator('.fc-dropzone', { hasText: 'Drop a .apkg' })).toBeVisible({ timeout: 5_000 });

  // Stub the native open dialog to return the generated PDF.
  await electronApp.evaluate(({ ipcMain }, pdfPath) => {
    ipcMain.removeHandler('dialog:openFile');
    ipcMain.handle('dialog:openFile', () => [pdfPath]);
  }, PDF_PATH);

  await window.locator('.fc-pane button', { hasText: 'Browse Device' }).click();

  // Load + pairing preview: 4 pages → 2 cards, fronts/backs visible.
  await expect(window.locator('.fc-pane', { hasText: '4 pages' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(window.getByText(/Preview — 2 cards/)).toBeVisible({ timeout: 5_000 });
  await expect(window.locator('.fc-import-sample__front', { hasText: 'FRONT ONE' })).toBeVisible();
  await expect(window.locator('.fc-import-sample__back', { hasText: 'BACK ONE' })).toBeVisible();
  await window.screenshot({ path: path.join(SHOT_DIR, 'import-pdf-preview.png') });

  // Import into a new deck (default destination is "+ New Deck…").
  await window.locator('button', { hasText: 'Import 2 Cards' }).click();
  const nameIn = window.locator('.parallx-modal-box input');
  await expect(nameIn).toBeVisible({ timeout: 3_000 });
  await nameIn.fill(DECK);
  await nameIn.press('Enter');

  // Success routes to Browse with both cards present, sources stamped.
  await expect(window.locator('.fc-view__title', { hasText: DECK })).toBeVisible({ timeout: 10_000 });
  await expect(window.locator('.fc-cardrow', { hasText: 'FRONT ONE' })).toBeVisible({ timeout: 5_000 });
  await expect(window.locator('.fc-cardrow', { hasText: 'FRONT TWO' })).toBeVisible();
  await window.screenshot({ path: path.join(SHOT_DIR, 'import-pdf-browse.png') });

  // Cleanup through the UI.
  await window.locator('.fc-pane button', { hasText: 'Decks' }).first().click();
  const doneDeck = window.locator('.fc-deck-card', { hasText: DECK }).first();
  await expect(doneDeck).toBeVisible({ timeout: 5_000 });
  await doneDeck.locator('button', { hasText: 'Delete' }).click();
  await confirmButton('Delete').click();
  await expect(doneDeck).not.toBeVisible({ timeout: 5_000 });
});
