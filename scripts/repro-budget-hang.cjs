// Reproduction test for the budget-sync hang on qwen3.5:4b.
//
// Hits the user's local Ollama with the EXACT Stage 1 and Stage 2 prompts
// from ext/budget/main.js, using the same options (temperature:0,
// format:'json', num_ctx:4096), against a realistic Chase bank-email body.
//
// Outcome categories we're trying to distinguish:
//   A) Stream never emits done:true → confirms the hang is in Ollama+format:json
//   B) Stream emits done but JSON is garbage → hang is downstream (parsing/loop)
//   C) Stream emits done with valid JSON → hang is NOT in the LLM call
//
// Run:   node scripts/repro-budget-hang.cjs
// Override model:  MODEL=qwen3.5:4b node scripts/repro-budget-hang.cjs
// Override host:   OLLAMA_HOST=http://localhost:11434 node scripts/repro-budget-hang.cjs

const http = require('http');

const HOST   = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL  = process.env.MODEL       || 'qwen3.5:4b';
const TIMEOUT_MS = 90_000;

// ─── Representative bank-email body ────────────────────────────────────────
// Modeled on Chase "Your credit card payment is scheduled" — the exact subject
// that hung on 2026-05-21 10:53 according to email_imports. Format mirrors
// what truncateBody() in main.js would feed the model after HTML-strip.
const sampleMsg = {
  subject: 'Your credit card payment is scheduled',
  snippet: 'You scheduled a $1,200.15 payment to your Chase Visa ending in 6307 from your Total Checking account ending in 9821.',
  body: [
    'You scheduled a payment',
    '',
    'Hi Mufaro,',
    '',
    'You scheduled a payment for your Chase Visa account ending in 6307.',
    '',
    'Payment amount: $1,200.15',
    'Pay from: Total Checking (...9821)',
    'Pay to: Chase Visa (...6307)',
    'Scheduled for: 05/21/2026',
    '',
    'View this payment in chase.com.',
    '',
    'Thank you for being our customer.',
  ].join('\n'),
};

// ─── Prompts copied verbatim from ext/budget/main.js ───────────────────────

const STAGE1_SYS = 'You classify Chase bank emails. Respond with a single JSON object and nothing else.';
const STAGE1_USR = (msg) =>
  `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${msg.body}\n\n` +
  `Classify the email as exactly one of these event types:\n` +
  `  • "purchase"        — a real charge on a debit or credit card (gas, restaurant, subscription) OR a return/credit on a card. Refunds are purchases with a negative amount; do NOT use a separate refund type.\n` +
  `  • "deposit"         — money INTO a bank account from outside (paycheck, direct deposit, external transfer-IN).\n` +
  `  • "transfer"        — INTERNAL movement between this user's own accounts. THIS INCLUDES paying a credit card from checking.\n` +
  `  • "fee"             — bank fee, overdraft, ATM fee, late fee.\n` +
  `  • "balance_summary" — daily / periodic summary that lists ACCOUNT BALANCES (typical subjects: "Your daily account summary", "Account balance alert").\n` +
  `  • "other"           — statement-ready notice, marketing, security alerts, password resets, etc. (no money moved).\n\n` +
  `Account-kind hint should reflect which kind of account the event hits (use the body text — credit-card emails usually mention "Visa", "Mastercard", or a card name; bank emails mention "Total Checking", "Savings").\n\n` +
  `Return:\n{\n  "event_type":         <one of the strings above>,\n  "account_kind_hint":  <"checking" | "savings" | "credit_card" | "other">\n}`;

const STAGE2_SYS = 'You extract financial transaction data from emails. Respond with a single JSON object and nothing else. Money is reported in dollars; if you see cents, divide by 100. If multiple transactions are mentioned, return them in the "items" array.';
const STAGE2_USR = (msg) =>
  `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${msg.body}\n\n` +
  `Return:\n{\n  "items": [\n    {\n      "merchant":          <string or null — the payee for purchases, or "Chase Checking" / "Chase Savings" / "Chase Visa" for transfers/payments/deposits>,\n      "amount":            <number — positive for spend/charge/transfer-out, negative for refund/credit/deposit-in>,\n      "card_last_four":    <string of 4 digits or null — the account or card last four digits this hit>,\n      "account_kind_hint": <"checking" | "savings" | "credit_card" | "other">,\n      "transaction_date":  <"YYYY-MM-DD">,\n      "confidence":        <"high" | "medium" | "low">\n    }\n  ]\n}`;

// Options mirror budgetLmOptions('extract') for the hardest case.
const OPTIONS_BY_STAGE = {
  classify: { num_predict: 160, num_ctx: 4096, temperature: 0 },
  extract:  { num_predict: 768, num_ctx: 4096, temperature: 0 },
};

// ─── Ollama streaming client (raw HTTP, no SDK) ────────────────────────────

function callOllama({ system, user, stage }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
      stream: true,
      format: 'json',
      think: false,
      options: OPTIONS_BY_STAGE[stage],
    });

    const url = new URL('/api/chat', HOST);
    const t0 = Date.now();
    let chunks = 0;
    let lastChunkAt = t0;
    let sawDone = false;
    let acc = '';
    let firstTokenAt = null;
    let bytesIn = 0;

    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (data) => {
        bytesIn += data.length;
        buf += data;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line); } catch { continue; }
          chunks++;
          lastChunkAt = Date.now();
          if (evt.message && typeof evt.message.content === 'string') {
            if (!firstTokenAt && evt.message.content.length > 0) firstTokenAt = Date.now();
            acc += evt.message.content;
          }
          // Inspect non-content fields (thinking, etc.)
          if (chunks <= 3 || evt.done) {
            console.log(`    chunk #${chunks} keys=${JSON.stringify(Object.keys(evt))} msg=${JSON.stringify(evt.message || null)} done=${!!evt.done} done_reason=${evt.done_reason || '-'} total_dur=${evt.total_duration || '-'}`);
          }
          if (evt.done) { sawDone = true; }
        }
      });
      res.on('end', () => {
        resolve({
          ok: true, stage, sawDone, chunks, bytesIn,
          totalMs: Date.now() - t0,
          firstTokenMs: firstTokenAt ? firstTokenAt - t0 : null,
          lastChunkMs: lastChunkAt - t0,
          contentLen: acc.length,
          contentPreview: acc.slice(0, 400),
          parsed: tryParse(acc),
        });
      });
      res.on('error', (e) => reject(e));
    });
    req.on('error', reject);

    const watchdog = setInterval(() => {
      const idle = Date.now() - lastChunkAt;
      if (Date.now() - t0 > TIMEOUT_MS) {
        clearInterval(watchdog);
        req.destroy(new Error('timeout'));
        resolve({
          ok: false, stage, reason: 'TIMEOUT', sawDone, chunks, bytesIn,
          totalMs: Date.now() - t0, idleMs: idle,
          contentPreview: acc.slice(0, 400),
        });
      }
    }, 1000);

    req.write(body);
    req.end();
  });
}

function tryParse(raw) {
  if (!raw || !raw.trim()) return { ok: false, why: 'empty' };
  try { return { ok: true, value: JSON.parse(raw.trim()) }; }
  catch (e) { return { ok: false, why: 'invalid', err: String(e.message).slice(0, 120) }; }
}

// ─── Run all combinations ──────────────────────────────────────────────────

(async () => {
  console.log(`Ollama: ${HOST}   Model: ${MODEL}   Timeout: ${TIMEOUT_MS}ms`);
  console.log(`Sample: "${sampleMsg.subject}"\n`);

  for (const stage of ['classify', 'extract']) {
    const sys = stage === 'classify' ? STAGE1_SYS : STAGE2_SYS;
    const usr = stage === 'classify' ? STAGE1_USR(sampleMsg) : STAGE2_USR(sampleMsg);
    process.stdout.write(`[${stage}] sending… `);
    const r = await callOllama({ system: sys, user: usr, stage });
    if (r.ok) {
      console.log(
        `done=${r.sawDone} chunks=${r.chunks} bytesIn=${r.bytesIn} ` +
        `firstToken=${r.firstTokenMs}ms total=${r.totalMs}ms contentLen=${r.contentLen}`,
      );
      console.log('  parsed:', JSON.stringify(r.parsed));
      console.log('  preview:', r.contentPreview.replace(/\n/g, '\\n').slice(0, 200));
    } else {
      console.log(`FAIL reason=${r.reason} sawDone=${r.sawDone} chunks=${r.chunks} bytesIn=${r.bytesIn} idleMs=${r.idleMs} total=${r.totalMs}ms`);
      console.log('  preview:', (r.contentPreview || '').replace(/\n/g, '\\n').slice(0, 200));
    }
    console.log('');
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
