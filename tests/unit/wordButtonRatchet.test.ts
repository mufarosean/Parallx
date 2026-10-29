// wordButtonRatchet.test.ts — kit buttons with words and no icon can only
// become fewer.
//
// The owner reads a row of word-only buttons as made by AI (Oct 28). The
// rule (PARALLX_EXTENSION_AUTHORING_FOR_AI.md §6.3): a button in a toolbar,
// a row or a card leads with an icon; the words that answer a dialog (Cancel,
// Close, Done...) stay words; a state is a switch, not a button whose word
// flips. This counts, per file, the kit buttons (createButton) with no icon
// and a label that is not a dialog answer, and fails when a count rises.
//
// UPDATE_WORD_BUTTON_BASELINE=1 refreshes word-button-baseline.json; refresh
// only in a commit whose message names the counts that fell.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { withoutComments } from './fixtures/sourceText.js';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'word-button-baseline.json');

const SOURCE_GLOBS = ['src/**/*.ts', 'ext/**/*.js'];
const NOT_COUNTED = [
  '**/node_modules/**', '**/*.generated.ts', '**/*.d.ts',
  'ext/study/main.js', 'ext/**/readability.js', 'ext/**/test/**',
  'src/ui/kit.ts', 'src/ui/scene.ts',
];
/** A dialog's answers: words are the clearest there. */
const ANSWERS = /^(Cancel|Close|Done|OK|Not Now|Keep|Skip|Back|Confirm|Don't Allow|Save)$/;

type Counts = Record<string, number>;

/** The text of each createButton( ... ) call: its options. */
function buttonCalls(text: string): string[] {
  const calls: string[] = [];
  const re = /\bcreateButton\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    calls.push(text.slice(m.index + m[0].length, i - 1));
  }
  return calls;
}

function measure(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const text = withoutComments(readFileSync(resolve(ROOT, f), 'utf8'));
    let n = 0;
    for (const call of buttonCalls(text)) {
      if (/\bicon\s*[:,}]/.test(call)) continue; // icon: 'x', or a shorthand { icon }
      const label = /\blabel:\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(call)?.[2]?.replace(/\\'/g, "'");
      if (label !== undefined && ANSWERS.test(label)) continue;
      n++;
    }
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('word-only buttons (ratchet)', () => {
  const now = measure();
  if (process.env.UPDATE_WORD_BUTTON_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file has more word-only buttons than it did', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A file gained buttons with words and no icon. Lead with an icon (dialog answers like Cancel excepted), or use a switch for a state.').toEqual([]);
  });

  it('counts what it should', () => {
    const calls = buttonCalls("createButton(bar, { label: 'Run', icon: 'play' }); createButton(bar, { label: 'Cancel' }); createButton(bar, { label: f(x) });");
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('f(x)');
  });
});
