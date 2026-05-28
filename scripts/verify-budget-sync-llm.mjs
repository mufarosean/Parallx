// Faithful end-to-end check of the budget sync LLM pipeline against the REAL
// model the user runs (api.lm.getActiveModel() -> qwen3.6:latest), using the
// EXACT request options budgetLmOptions() produces and the EXACT Stage 1/2/3
// prompts from ext/budget/main.js. No paraphrasing.
//
// The Ollama provider (src/built-in/chat/providers/ollamaProvider.ts) builds:
//   options = { temperature, num_ctx }   (no num_predict because maxTokens unset)
//   body.format = 'json'
//   thinking left at the model default (NOT suppressed)
// We replicate that exactly via POST /api/chat (stream:false for simplicity).

const BASE = 'http://localhost:11434';
const MODEL = 'qwen3.6:latest';
const NUM_CTX = 16384; // BUDGET_LM_NUM_CTX

async function chatJson(system, user) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    format: 'json',
    options: { temperature: 0, num_ctx: NUM_CTX }, // exactly what budgetLmOptions yields
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json?.message?.content ?? '';
  return { content, ms: Date.now() - t0, evalCount: json?.eval_count };
}

function tryParseModelJson(raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch {}
  const s = trimmed.indexOf('{'), e = trimmed.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(trimmed.slice(s, e + 1)); } catch {} }
  return undefined;
}

// ── EXACT prompts copied from ext/budget/main.js ──
const S1_SYS = 'You classify bank and credit-card emails. Respond with a single JSON object and nothing else.';
function s1User(msg) {
  return `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${msg.body}\n\n` +
    `Classify the email as exactly one of these event types:\n` +
    `  • "purchase"        — a real charge on a debit or credit card (gas, restaurant, subscription) OR a return/credit on a card. Refunds are purchases with a negative amount; do NOT use a separate refund type.\n` +
    `  • "deposit"         — money INTO a bank account from outside (paycheck, direct deposit, external transfer-IN).\n` +
    `  • "transfer"        — INTERNAL movement between this user's own accounts. THIS INCLUDES paying a credit card from checking.\n` +
    `  • "fee"             — bank fee, overdraft, ATM fee, late fee.\n` +
    `  • "balance_summary" — daily / periodic summary that lists ACCOUNT BALANCES (typical subjects: "Your daily account summary", "Account balance alert").\n` +
    `  • "other"           — statement-ready notice, marketing, security alerts, password resets, etc. (no money moved).\n\n` +
    `Account-kind hint should reflect which kind of account the event hits (use the body text — credit-card emails usually mention "Visa", "Mastercard", or a card name; bank emails mention "Total Checking", "Savings").\n\n` +
    `Return:\n{\n  "event_type":         <one of the strings above>,\n  "account_kind_hint":  <"checking" | "savings" | "credit_card" | "other">\n}`;
}

const S2_SYS = 'You extract financial transaction data from emails. Respond with a single JSON object and nothing else. Money is reported in dollars; if you see cents, divide by 100. If multiple transactions are mentioned, return them in the "items" array.';
function s2User(msg) {
  return `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${msg.body}\n\n` +
    `Return:\n{\n  "items": [\n    {\n      "merchant":          <string or null — the payee for purchases, or "Checking" / "Savings" / "Visa" for transfers/payments/deposits>,\n      "amount":            <number — positive for spend/charge/transfer-out, negative for refund/credit/deposit-in>,\n      "card_last_four":    <string of 4 digits or null — the account or card last four digits this hit>,\n      "account_kind_hint": <"checking" | "savings" | "credit_card" | "other">,\n      "transaction_date":  <"YYYY-MM-DD">,\n      "confidence":        <"high" | "medium" | "low">\n    }\n  ]\n}`;
}

const S3_SYS = 'You pick the best-fitting budget category for a transaction. Respond with a single JSON object and nothing else. The category MUST be one of the listed names (case-insensitive); if none fits, pick "Other".';
function s3User(tx, cats) {
  return `Merchant: ${tx.merchant ?? ''}\nAmount:   ${tx.amount} USD\nCategories: ${cats.join(', ')}\n\nReturn:\n{ "category": <one of the listed category names> }`;
}

const S1B_SYS = 'You extract account balance data from a daily account summary email. The email may list MULTIPLE accounts (Total Checking, Savings, Credit Card, etc.). Respond with a single JSON object and nothing else.';
function s1bUser(msg) {
  return `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${msg.body}\n\n` +
    `Return:\n{\n  "snapshot_date": <"YYYY-MM-DD">,\n  "accounts": [\n    {\n      "account_kind":      <"checking" | "savings" | "credit_card" | "other">,\n      "account_last_four": <string of 4 digits or null>,\n      "balance":           <number, in dollars — POSITIVE for cash on hand, NEGATIVE for credit card amount owed>\n    }\n  ]\n}`;
}

// ── Realistic test emails ──
const purchaseEmail = {
  subject: 'Your Single Transaction Alert from Chase',
  snippet: 'You made a $42.17 transaction with WHOLE FOODS MARKET',
  body: `Account ending in 4821\nMerchant: WHOLE FOODS MARKET #1043\nAmount: $42.17\nDate: May 26, 2026\nThis transaction was made with your Chase Freedom Visa card.`,
};
const balanceEmail = {
  subject: 'Your daily account summary',
  snippet: 'Here are your account balances as of May 27, 2026',
  body: `As of May 27, 2026:\nChase Total Checking (...4821): $3,204.55\nChase Savings (...9912): $12,860.10\nChase Freedom Visa (...3007): -$842.19 (amount owed)`,
};

async function main() {
  let pass = 0, fail = 0;
  const fails = [];

  // Stage 1 — classify purchase
  {
    const { content, ms } = await chatJson(S1_SYS, s1User(purchaseEmail));
    const p = tryParseModelJson(content);
    const ok = p && p.event_type === 'purchase';
    console.log(`\n[Stage1 purchase] ${ms}ms parsed=${!!p} event_type=${p?.event_type} kind=${p?.account_kind_hint}`);
    if (!ok) { fail++; fails.push('Stage1 purchase'); console.log('  RAW:', content.slice(0, 500)); } else pass++;
  }

  // Stage 2 — extract purchase
  {
    const { content, ms } = await chatJson(S2_SYS, s2User(purchaseEmail));
    const p = tryParseModelJson(content);
    const item = p?.items?.[0];
    const ok = item && Number.isFinite(Number(item.amount)) && Math.abs(Number(item.amount) - 42.17) < 0.01;
    console.log(`[Stage2 purchase] ${ms}ms parsed=${!!p} items=${p?.items?.length} merchant=${item?.merchant} amount=${item?.amount} last4=${item?.card_last_four} date=${item?.transaction_date}`);
    if (!ok) { fail++; fails.push('Stage2 purchase'); console.log('  RAW:', content.slice(0, 500)); } else pass++;
  }

  // Stage 3 — categorize
  {
    const cats = ['Groceries', 'Dining', 'Gas', 'Subscriptions', 'Other'];
    const { content, ms } = await chatJson(S3_SYS, s3User({ merchant: 'WHOLE FOODS MARKET #1043', amount: 42.17 }, cats));
    const p = tryParseModelJson(content);
    const ok = p && typeof p.category === 'string' && cats.map(c => c.toLowerCase()).includes(p.category.toLowerCase());
    console.log(`[Stage3 categorize] ${ms}ms parsed=${!!p} category=${p?.category}`);
    if (!ok) { fail++; fails.push('Stage3 categorize'); console.log('  RAW:', content.slice(0, 500)); } else pass++;
  }

  // Stage 1 — classify balance summary
  {
    const { content, ms } = await chatJson(S1_SYS, s1User(balanceEmail));
    const p = tryParseModelJson(content);
    const ok = p && p.event_type === 'balance_summary';
    console.log(`[Stage1 balance] ${ms}ms parsed=${!!p} event_type=${p?.event_type}`);
    if (!ok) { fail++; fails.push('Stage1 balance'); console.log('  RAW:', content.slice(0, 500)); } else pass++;
  }

  // Stage 1b — extract balances
  {
    const { content, ms } = await chatJson(S1B_SYS, s1bUser(balanceEmail));
    const p = tryParseModelJson(content);
    const ok = p && Array.isArray(p.accounts) && p.accounts.length >= 2;
    console.log(`[Stage1b balance] ${ms}ms parsed=${!!p} accounts=${p?.accounts?.length}`);
    if (p?.accounts) for (const a of p.accounts) console.log(`    ${a.account_kind} ...${a.account_last_four} = ${a.balance}`);
    if (!ok) { fail++; fails.push('Stage1b balance'); console.log('  RAW:', content.slice(0, 500)); } else pass++;
  }

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  console.log('All stages produced valid, parseable, correct JSON with the real model.');
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
