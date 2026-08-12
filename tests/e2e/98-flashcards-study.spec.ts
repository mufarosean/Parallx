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
  // Open Flashcards no longer forces a route (no-reset fix) — the pane may
  // surface wherever it was left. Navigate to Decks explicitly.
  await window.locator('.fc-pane__tabs', { hasText: 'Decks' }).getByText('Decks', { exact: true }).click();

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

  // Add one card via Browse's inline form ("Add Card" toggles the form
  // open; "Save Card" submits it).
  await window.getByRole('button', { name: 'Add Card', exact: true }).click();
  const fronts = window.locator('.fc-form .fc-textarea');
  await fronts.nth(0).fill('E2E-STUDY-FRONT what is 2+2?');
  await fronts.nth(1).fill('E2E-STUDY-BACK 4');
  await window.locator('.fc-form button', { hasText: 'Save Card' }).click();
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

  // UNDO from the wait screen: the grade reverts and the card comes back.
  await wait.locator('button', { hasText: 'Undo Last Grade' }).click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 5_000 });
  await expect(window.locator('.fc-study__cardactions button', { hasText: 'Undo' })).toBeDisabled();

  // Grade Again once more → wait screen → Show Now serves it early.
  await window.locator('button', { hasText: 'Show Answer' }).click();
  await window.locator('.fc-grade--again').click();
  await expect(wait).toBeVisible({ timeout: 5_000 });
  await wait.locator('button', { hasText: 'Show Now' }).click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 5_000 });

  // PANE-REBUILD SURVIVAL: switching editor tabs destroys the pane (the
  // source-link round trip). Coming back must RESUME the session mid-card,
  // not reset to a fresh queue ("loses place" report).
  await window.keyboard.press('Control+Shift+P');
  await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
  await window.locator('.command-palette-input').fill('>Worksheets: Open Scratch Sheet');
  await window.locator('.command-palette-item', { hasText: 'Open Scratch Sheet' }).first().click();
  await window.waitForFunction(() =>
    !!document.querySelector('.ws-pane__sheet canvas'), { timeout: 30_000 });
  await window.locator('.ui-tab', { hasText: 'Flashcards' }).first().click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' }),
    'session did not survive the pane rebuild').toBeVisible({ timeout: 10_000 });

  // NO-RESET: running the generic open command while studying must surface
  // the pane untouched, not reroute it to Decks (focus-not-reopen fix).
  await window.keyboard.press('Control+Shift+P');
  await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
  await window.locator('.command-palette-input').fill('>Open Flashcards');
  await window.locator('.command-palette-item', { hasText: 'Open Flashcards' }).first().click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' }),
    'Open Flashcards reset the study view').toBeVisible({ timeout: 5_000 });

  // PER-CARD NOTES: reveal → type a note → blur saves it. It must survive a
  // full pane rebuild (tab away and back) — the persistence the user asked
  // for ("take persisting notes on different cards").
  await window.locator('button', { hasText: 'Show Answer' }).click();
  const notesIn = window.locator('.fc-study__notes-input');
  await expect(notesIn).toBeVisible({ timeout: 5_000 });
  await notesIn.fill('E2E note: watch the tail factor.');
  await notesIn.blur();
  await window.waitForTimeout(400); // debounce + write
  await window.locator('.ui-tab', { hasText: 'Practice Sheet' }).first().click();
  await window.waitForTimeout(400);
  await window.locator('.ui-tab', { hasText: 'Flashcards' }).first().click();
  await expect(window.locator('.fc-study__front', { hasText: 'E2E-STUDY-FRONT' })).toBeVisible({ timeout: 10_000 });
  await window.locator('button', { hasText: 'Show Answer' }).click();
  await expect(window.locator('.fc-study__notes-input')).toHaveValue('E2E note: watch the tail factor.', { timeout: 5_000 });

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

test('deck-wide Find Duplicates: scan → group → staged delete → apply', async ({ window }) => {
  // Two near-identical cards + one distinct; the sweep must group the twins
  // (trigram path needs no model; an unreachable AI judge degrades to
  // similarity-only groups) and the staged delete must apply.
  await expect(window.locator('.fc-pane')).toBeVisible({ timeout: 10_000 });
  const confirmButton = (label: string) =>
    window.locator('.parallx-modal-box button, .parallx-notification button', { hasText: label }).first();

  await window.locator('.fc-pane .fc-tab, .fc-pane button', { hasText: 'Decks' }).first().click();
  const leftover = window.locator('.fc-deck-card', { hasText: 'E2E Dedup Deck' }).first();
  if (await leftover.isVisible().catch(() => false)) {
    await leftover.locator('button', { hasText: 'Delete' }).click();
    await confirmButton('Delete').click();
    await expect(leftover).not.toBeVisible({ timeout: 5_000 });
  }
  await window.locator('.fc-pane button', { hasText: 'New deck' }).click();
  const nameIn = window.locator('.parallx-modal-box input');
  await nameIn.fill('E2E Dedup Deck');
  await nameIn.press('Enter');
  await expect(window.locator('.fc-view__title', { hasText: 'E2E Dedup Deck' })).toBeVisible({ timeout: 5_000 });

  const addCard = async (front: string, back: string) => {
    const form = window.locator('.fc-form');
    if (!(await form.isVisible().catch(() => false))) {
      await window.getByRole('button', { name: 'Add Card', exact: true }).first().click();
    }
    const tas = window.locator('.fc-form .fc-textarea');
    await tas.nth(0).fill(front);
    await tas.nth(1).fill(back);
    await window.locator('.fc-form button', { hasText: 'Save Card' }).click();
    // .first(): the twin cards share a 30-char prefix by design.
    await expect(window.locator('.fc-cardrow', { hasText: front.slice(0, 30) }).first()).toBeVisible({ timeout: 5_000 });
  };
  await addCard('What does the Mack chain ladder assume about accident years?', 'They are independent of one another.');
  await addCard('What does the Mack chain ladder method assume about the accident years?', 'That they are independent of one another.');
  await addCard('E2E-DISTINCT What is IBNR?', 'Incurred but not reported claims.');

  // Browse header ⋯ menu → Find Duplicates.
  await window.locator('.fc-pane button[aria-label="Deck actions"]').click();
  await window.getByText('Find Duplicates', { exact: true }).click();
  await expect(window.locator('.fc-view__title', { hasText: 'Find Duplicates' })).toBeVisible({ timeout: 5_000 });

  // The twins group appears (AI judge optional; generous timeout in case a
  // local model answers slowly).
  const group = window.locator('.fc-dupgroup').first();
  await expect(group).toBeVisible({ timeout: 120_000 });
  await expect(group).toContainText('Mack chain ladder');
  await expect(group).not.toContainText('E2E-DISTINCT');

  // Stage one deletion (check it if the AI did not pre-stage), then apply.
  const firstCheck = group.locator('.fc-duprow input[type="checkbox"]').first();
  const anyChecked = await group.locator('.fc-duprow input[type="checkbox"]:checked').count();
  if (anyChecked === 0) await firstCheck.check();
  const applyBtn = window.locator('button', { hasText: 'Apply Changes' });
  await expect(applyBtn).toBeEnabled();
  await applyBtn.click();
  await confirmButton('Delete Cards').click();

  // Lands back in BROWSE (Study This Deck is browse-only — the dedup view's
  // title also contains the deck name, so the title alone can't distinguish)
  // with one twin gone.
  await expect(window.locator('.fc-pane button', { hasText: 'Study This Deck' })).toBeVisible({ timeout: 10_000 });
  await expect(window.locator('.fc-cardrow')).toHaveCount(2, { timeout: 5_000 });

  // Cleanup.
  await window.locator('.fc-pane .fc-tab, .fc-pane button', { hasText: 'Decks' }).first().click();
  const deck = window.locator('.fc-deck-card', { hasText: 'E2E Dedup Deck' }).first();
  await deck.locator('button', { hasText: 'Delete' }).click();
  await confirmButton('Delete').click();
  await expect(deck).not.toBeVisible({ timeout: 5_000 });
});

test('dropdown selects by mouse (core ui regression: focusout killed item clicks)', async ({ window }) => {
  // The Create view's "Into deck" dropdown: with at least one deck, the
  // default selection is a deck, and picking "+ New Deck…" by MOUSE must
  // register (the focusout handler used to close the list on mousedown,
  // before the item's click could fire — every dropdown in the app).
  await expect(window.locator('.fc-pane')).toBeVisible({ timeout: 10_000 });

  const confirmButton = (label: string) =>
    window.locator('.parallx-modal-box button, .parallx-notification button', { hasText: label }).first();

  // Ensure at least one deck exists so the default selection is NOT "+ New Deck…".
  await window.locator('.fc-pane .fc-tab, .fc-pane button', { hasText: 'Decks' }).first().click();
  await window.locator('.fc-pane button', { hasText: 'New deck' }).click();
  const nameIn = window.locator('.parallx-modal-box input');
  await expect(nameIn).toBeVisible({ timeout: 3_000 });
  await nameIn.fill('E2E Dropdown Deck');
  await nameIn.press('Enter');
  await expect(window.locator('.fc-view__title', { hasText: 'E2E Dropdown Deck' })).toBeVisible({ timeout: 5_000 });

  await window.locator('.fc-pane__tabs', { hasText: 'Create' }).getByText('Create', { exact: true }).click();
  const trigger = window.locator('.fc-pane .ui-dropdown__button').first();
  await expect(trigger).toBeVisible({ timeout: 5_000 });
  const before = (await trigger.textContent()) ?? '';
  expect(before).not.toContain('New Deck');

  await trigger.click();
  const option = window.locator('.ui-dropdown__list .ui-dropdown__item', { hasText: '+ New Deck…' }).first();
  await expect(option).toBeVisible({ timeout: 3_000 });
  await option.click();
  await expect(trigger, 'mouse selection did not register on the dropdown').toContainText('New Deck', { timeout: 3_000 });

  // Cleanup the deck.
  await window.locator('.fc-pane .fc-tab, .fc-pane button', { hasText: 'Decks' }).first().click();
  const deck = window.locator('.fc-deck-card', { hasText: 'E2E Dropdown Deck' }).first();
  await expect(deck).toBeVisible({ timeout: 5_000 });
  await deck.locator('button', { hasText: 'Delete' }).click();
  await confirmButton('Delete').click();
  await expect(deck).not.toBeVisible({ timeout: 5_000 });
});

