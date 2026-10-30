// past-choices.js — what the sync's categorizer knows of your own past calls.
//
// Before the model is asked to file a purchase, the rows whose category you
// set by hand for the same payee (normalised the way rules match it) are
// looked up. Two or more of your picks, with no hand-set row disagreeing,
// file it directly, like a rule: deterministic beats probabilistic. Anything
// less goes to the model as a few "past choices" lines. The AI's own earlier
// answers are not evidence: showing them back would only repeat its guesses.

/** Hand-set rows that agree before a payee is filed without the model. */
export const PAST_CHOICE_MIN_PICKS = 2;
/** At most this many past-choice lines go into the prompt. */
export const PAST_CHOICE_LINES = 5;
/** Recorded as the categorizer for a row filed from your past choices. */
export const PAST_CHOICE_MODEL = 'history';

// Payee text as the bank prints it carries a processor prefix, a store
// number and a city: "SQ *COFFEE SHOP 0042 DENVER CO". Rules and past
// choices match this normalised form, so one covers a chain and its stores.
export function normalizeMerchant(text) {
  let m = String(text || '').toLowerCase();
  m = m.replace(/^(sq|tst|pp|paypal|py|amzn mktp|amazon\.com|sp|dd|ig|ppl)\s*\*\s*/, '');
  m = m.replace(/\s*#\s*\d+\b/g, ' ').replace(/\b\d{3,}\b/g, ' ');
  m = m.replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = m.split(' ');
  if (parts.length >= 3 && /^[a-z]{2}$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ').trim();
}

// Groups hand-touched rows (newest first) by normalised payee. `source`
// 'manual' is a category you picked or confirmed; any other source on a row
// you edited (user_overridden) is a category you saw and kept, which counts
// for less: it shows in the prompt but never files a row on its own.
// `offPatterns` are rules you turned off: a payee one of them covers is
// never filed directly, only shown to the model.
export function buildPastChoiceIndex(rows, offPatterns = []) {
  const byKey = new Map();
  for (const r of rows || []) {
    const key = normalizeMerchant(r && r.merchant);
    if (!key || !r.category_id || !r.category_name) continue;
    const list = byKey.get(key) || [];
    list.push({ merchant: String(r.merchant).trim(), categoryId: r.category_id, categoryName: String(r.category_name), picked: r.source === 'manual' });
    byKey.set(key, list);
  }
  const offKeys = new Set((offPatterns || []).map(normalizeMerchant).filter(Boolean));
  return { byKey, offKeys };
}

// What your past says about one payee: `direct` when it decides the category,
// else up to PAST_CHOICE_LINES lines for the prompt (your picks first).
export function pastChoicesFor(index, merchant) {
  const key = normalizeMerchant(merchant);
  const rows = (index && key && index.byKey.get(key)) || [];
  const picks = rows.filter((r) => r.picked);
  const agreed = new Set(rows.map((r) => r.categoryId)).size === 1;
  if (picks.length >= PAST_CHOICE_MIN_PICKS && agreed && !index.offKeys.has(key)) {
    return { direct: { categoryId: picks[0].categoryId, categoryName: picks[0].categoryName, picks: picks.length }, lines: [] };
  }
  const groups = new Map();
  for (const r of [...picks, ...rows.filter((x) => !x.picked)]) {
    const g = `${r.merchant.toLowerCase()}\u0000${r.categoryId}\u0000${r.picked}`;
    const hit = groups.get(g);
    if (hit) hit.n++;
    else groups.set(g, { ...r, n: 1 });
  }
  const lines = [...groups.values()].slice(0, PAST_CHOICE_LINES).map((g) =>
    `${g.merchant} → ${g.categoryName} (${g.picked ? 'chosen' : 'kept'}${g.n > 1 ? `, ${g.n} times` : ''})`);
  return { direct: null, lines };
}

/** The prompt block for past-choice lines; empty when there are none. */
export function pastChoicesPrompt(lines) {
  if (!lines || !lines.length) return '';
  return `The user's past choices for this merchant, newest first:\n${lines.map((l) => '  • ' + l).join('\n')}\n`;
}

// Reads the hand-touched purchase rows and the rules you turned off. `db` is
// the extension's throwing wrapper; any failure leaves the model on its own.
export async function loadPastChoices(db) {
  try {
    const rows = await db.all(
      `SELECT t.merchant, t.category_id, c.name AS category_name, t.categorization_source AS source
         FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.merchant IS NOT NULL AND t.tx_type = 'purchase' AND t.status IN ('confirmed','review')
          AND c.archived = 0 AND c.kind = 'expense'
          AND (t.categorization_source = 'manual' OR t.user_overridden = 1)
        ORDER BY t.updated_at DESC, t.created_at DESC LIMIT 5000`,
    );
    const off = await db.all('SELECT pattern FROM categorization_rules WHERE active = 0');
    return buildPastChoiceIndex(rows, (off || []).map((r) => r.pattern));
  } catch { return buildPastChoiceIndex([]); }
}
