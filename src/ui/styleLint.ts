// styleLint.ts — does a piece of AI-written UI read and look like Parallx?
//
// The house rules (docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md, UI design rules) as checks
// over source text: colours only as --px tokens, the type scale, no set
// fonts, no uppercase or letter-spaced labels, no emoji or browser dialogs,
// and actions in Title Case with no em dashes or three dots. Used by the
// extension checker (failures go back to the model) and by the model
// evaluation (a style score for mini-apps and extensions).
//
// Dependency-free on purpose: the evaluation script imports this file
// directly from Node.

export interface StyleIssue {
  readonly rule: string;
  readonly detail: string;
}

const SOURCE_RULES: readonly { rule: string; re: RegExp }[] = [
  // A hex colour is a value (after `:`, `(`, `,` or a quote), never an id selector like `#add`.
  { rule: 'Colours come from --px tokens', re: /(?<!var\(--[\w-]+,\s*)(?:(?<=[:(,'"`]\s*)#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(\s*\d|hsla?\(\s*\d)/g },
  { rule: 'Type sizes come from --px-text tokens', re: /font-size\s*:\s*\d+(?:\.\d+)?(?:px|pt|em|rem)\b|fontSize\s*=\s*['"`]\d/gi },
  { rule: 'The app font is inherited, never set', re: /font-family\s*:\s*(?!\s*(?:inherit|var\())[^;}"'`]+/gi },
  { rule: 'No uppercase or letter-spaced labels', re: /text-transform\s*:\s*uppercase|textTransform\s*=\s*['"`]uppercase|letter-spacing\s*:\s*(?!0\b|normal|-)/gi },
  { rule: 'No emoji', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu },
  { rule: 'No browser dialogs', re: /(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/g },
];

/** House-rule problems in CSS, HTML or script text, each rule once with its first example. */
export function lintStyleSource(text: string): StyleIssue[] {
  const out: StyleIssue[] = [];
  for (const r of SOURCE_RULES) {
    const hits = [...String(text ?? '').matchAll(r.re)].map((m) => m[0].trim());
    if (hits.length) out.push({ rule: r.rule, detail: `${hits.length}×, e.g. "${hits[0].slice(0, 40)}"` });
  }
  return out;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via', 'with']);

/** Whether an action label is Title Case: every word capitalised except small joining words after the first. */
export function isTitleCase(label: string): boolean {
  const words = String(label ?? '').trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  return words.every((w, i) => {
    const bare = w.replace(/[^A-Za-z'-].*$/, '');
    if (i > 0 && SMALL_WORDS.has(bare.toLowerCase()) && bare === bare.toLowerCase()) return true;
    return /^[A-Z]/.test(bare);
  });
}

/** Problems with action labels (buttons, menu items): Title Case, no em dashes, the ellipsis character. */
export function lintActionLabels(labels: readonly string[]): StyleIssue[] {
  const out: StyleIssue[] = [];
  const list = labels.map((l) => String(l ?? '').trim()).filter(Boolean);
  const notTitle = list.filter((l) => !isTitleCase(l));
  if (notTitle.length) out.push({ rule: 'Actions are in Title Case', detail: notTitle.slice(0, 4).map((l) => `"${l}"`).join(', ') });
  const dashes = list.filter((l) => l.includes('—'));
  if (dashes.length) out.push({ rule: 'No em dashes in labels', detail: dashes.slice(0, 3).map((l) => `"${l}"`).join(', ') });
  const dots = list.filter((l) => /\.\.\.\s*$/.test(l));
  if (dots.length) out.push({ rule: 'An action that opens a dialog ends with the … character', detail: dots.slice(0, 3).map((l) => `"${l}"`).join(', ') });
  return out;
}

/** The action labels an extension's code gives its kit buttons and menus (a `label` string in a create call). */
export function actionLabelsInCode(code: string): string[] {
  const out: string[] = [];
  const re = /(?:createButton|createPageHeader|createEmptyState|showContextMenu|createMenu)\s*\(([\s\S]{0,400}?)\)\s*[;,)]/g;
  for (const m of String(code ?? '').matchAll(re)) {
    for (const l of m[1].matchAll(/\blabel\s*:\s*(['"`])([^'"`$]+)\1/g)) out.push(l[2]);
  }
  return out;
}

/** The text of the plain buttons in a piece of HTML (a mini-app's markup). */
export function buttonLabelsInMarkup(html: string): string[] {
  return [...String(html ?? '').matchAll(/<button\b[^>]*>([^<]{1,60})<\/button>/gi)].map((m) => m[1].trim()).filter(Boolean);
}

/** Every style problem in a mini-app's source: its text and its button labels. */
export function lintMiniApp(src: string): StyleIssue[] {
  return [...lintStyleSource(src), ...lintActionLabels(buttonLabelsInMarkup(src))];
}
