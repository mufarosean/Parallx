/**
 * E2E: flashcards study session mechanics (M98 follow-up fixes).
 *
 * Covers the two user-reported gaps:
 * 1. "Again 1m" must MEAN something: a learning card graded Again stays in
 *    the session and the session waits for it (countdown + Show Now) instead
 *    of ending or serving it at queue-tail whim.
 * 2. In-study Edit and Delete on the card toolbar ("fix it right there").
 *
 * The flashcards ext uses its ISOLATED per-extension DB (no page-context
 * bridge), so the deck/card seed goes through the real UI: New deck →
 * Add card → Study. Cleanup deletes the deck through the UI too.
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';
import path from 'path';
import fs from 'fs/promises';

const SHOT_DIR = path.join('test-results', 'flashcards');
const DECK = 'E2E Study Deck';

test.beforeAll(async () => {
  await fs.mkdir(SHOT_DIR, { recursive: true });
});

test('grade Again → countdown wait → Show Now re-serves; in-study Edit/Delete', async ({ window, electronApp, workspacePath }) => {
  await openFolderViaMenu(electronApp, window, workspacePath);

  // Open the flashcards pane.
  await window.locator('[data-part-id="workbench.parts.statusbar"]').click();
  await window.keyboard.press('Control+Shift+P');
  await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
  await window.locator('.command-palette-input').fill('>Open Flashcards');
  await window.locator('.command-palette-item', { hasText: 'Open Flashcards' }).first().click();
  await expect(window.locator('.fc-pane')).toBeVisible({ timeout: 10_000 });

  // Idempotence: a leftover deck from a prior run is deleted via its row.
  const confirmButton = (label: string) =>
    window.locator('.parallx-modal-box button, .parallx-notification button', { hasText: label }).first();

  const leftover = window.locator('.fc-deck-card', { hasText: DECK }).first();
  if (await leftover.isVisible().catch(() => false)) {
    await leftover.locator('button', { hasText: 'Delete' }).click();
    await confirmButton('Delete').click();
    await expect(leftover).not.toBeVisible({ timeout: 5_000 });
  }

  // Seed: New deck → name it → Enter. _cmdNewDeck lands directly in the
  // new deck's Browse view.
  await window.locator('.fc-pane button', { hasText: 'New deck' }).click();
  const nameIn = window.locator('.parallx-modal-box input');
  await expect(nameIn).toBeVisible({ timeout: 3_000 });
  await nameIn.fill(DECK);
  await nameIn.press('Enter');
  await expect(window.locator('.fc-view__title', { hasText: DECK })).toBeVisible({ timeout: 5_000 });

  // Add one card via Browse's inline form ("Add card" toggles the form
  // open; "Add Card" submits it — exact-match the toggle).
  await window.getByRole('button', { name: 'Add card', exact: true }).click();
  const fronts = window.locator('.fc-form .fc-textarea');
  await fronts.nth(0).fill('E2E-STUDY-FRONT what is 2+2?');
  await fronts.nth(1).fill('E2E-STUDY-BACK 4');
  await window.locator('.fc-form button', { hasText: 'Add Card' }).click();
  await expect(window.locator('.fc-cardrow', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 5_000 });

  // Study this deck.
  await window.locator('.fc-pane button', { hasText: 'Study This Deck' }).click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 10_000 });

  // In-study card actions exist (the "fix it right there and then" ask).
  await expect(window.locator('.fc-study__cardactions button', { hasText: 'Edit' })).toBeVisible();
  await expect(window.locator('.fc-study__cardactions button', { hasText: 'Delete' })).toBeVisible();

  // In-study EDIT round-trip: fix the back, save, still on the same card.
  await window.locator('.fc-study__cardactions button', { hasText: 'Edit' }).click();
  const editBacks = window.locator('.fc-study__edit .fc-textarea');
  await expect(editBacks.nth(1)).toBeVisible({ timeout: 3_000 });
  await editBacks.nth(1).fill('E2E-STUDY-BACK four (edited)');
  await window.locator('.fc-study__edit button', { hasText: 'Save' }).click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 5_000 });

  // Reveal → the edited back shows → grade Again (1m learning step).
  await window.locator('button', { hasText: 'Show Answer' }).click();
  await expect(window.locator('.fc-study__back', { hasText: 'four (edited)' })).toBeVisible({ timeout: 5_000 });
  await window.locator('.fc-grade--again').click();

  // OLD bug: the card re-served instantly (queue tail) or the session ended.
  // NEW contract: a wait screen counts down to the 1-minute dueAt.
  const wait = window.locator('.fc-study__done', { hasText: 'still in learning' });
  await expect(wait).toBeVisible({ timeout: 5_000 });
  await expect(wait).toContainText(/Next card in 0:\d\d/);
  await window.screenshot({ path: path.join(SHOT_DIR, 'study-wait-countdown.png') });

  // Show Now = learn-ahead: the card serves immediately.
  await wait.locator('button', { hasText: 'Show Now' }).click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 5_000 });

  // In-study DELETE finishes the loop (confirm modal → session complete).
  await window.locator('.fc-study__cardactions button', { hasText: 'Delete' }).click();
  const confirmDel = confirmButton('Delete Card');
  await expect(confirmDel).toBeVisible({ timeout: 3_000 });
  await confirmDel.click();
  await expect(window.locator('.fc-study__done', { hasText: 'Session complete' })).toBeVisible({ timeout: 5_000 });

  // Cleanup: back to decks, delete the seed deck through its row.
  await window.locator('.fc-study__done button', { hasText: 'View Stats' }).waitFor({ state: 'visible' });
  await window.locator('.fc-pane .fc-tab, .fc-pane button', { hasText: 'Decks' }).first().click();
  const doneDeck = window.locator('.fc-deck-card', { hasText: DECK }).first();
  await expect(doneDeck).toBeVisible({ timeout: 5_000 });
  await doneDeck.locator('button', { hasText: 'Delete' }).click();
  await confirmButton('Delete').click();
  await expect(doneDeck).not.toBeVisible({ timeout: 5_000 });
});
