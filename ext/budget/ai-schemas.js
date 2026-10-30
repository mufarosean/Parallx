// ai-schemas.js — the shape of each Budget AI stage's answer.
//
// Each stage asked for `format: 'json'`, any JSON at all; a model could name
// its fields its own way and the stage read nothing. The stages now send
// their JSON schema as the format, and Ollama and OpenAI-compatible servers
// hold the answer to it. The prompts still spell the shape out, and the
// parsers still check every field, for providers that ignore the schema.

const str = { type: 'string' };
const num = { type: 'number' };
const strOrNull = { type: ['string', 'null'] };
const accountKind = { type: 'string', enum: ['checking', 'savings', 'credit_card', 'other'] };

function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties) };
}

/** The schema for a stage; `categoryNames` for the categorize stage. Undefined for a stage without one. */
export function budgetStageSchema(stage, { eventTypes = [], categoryNames = [] } = {}) {
  switch (stage) {
    case 'classify':
      return object({
        event_type: eventTypes.length ? { type: 'string', enum: [...eventTypes] } : str,
        account_kind_hint: accountKind,
      });
    case 'extract':
      return object({
        items: {
          type: 'array',
          items: object({
            merchant: strOrNull, amount: num, card_last_four: strOrNull, account_kind_hint: accountKind,
            transaction_date: str, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          }),
        },
      });
    case 'categorize': {
      const names = [...new Set([...categoryNames, 'Other'])];
      return object({ category: { type: 'string', enum: names } });
    }
    case 'snapshot':
      return object({
        snapshot_date: str,
        accounts: { type: 'array', items: object({ account_kind: accountKind, account_last_four: strOrNull, balance: num }) },
      });
    default:
      return undefined;
  }
}
