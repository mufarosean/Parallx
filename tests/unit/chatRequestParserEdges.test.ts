/**
 * Pin-the-invariant: chatRequestParser — edges not covered by
 * tests/unit/chatRequestParser.test.ts.
 *
 * Pins:
 *  - Newlines survive (Shift+Enter paragraph breaks must not be flattened).
 *  - Horizontal-whitespace collapse: 2+ runs of space/tab → single space,
 *    trailing horizontal whitespace per line trimmed, but \n preserved.
 *  - #variable: \w+ pattern → underscores OK, digits OK, hyphens act as
 *    word boundary; ASCII-only (\w semantics).
 *  - Repeated #variable occurrences are each captured (not deduped) and
 *    each occurrence is stripped from the cleaned text.
 *  - @participant only matches at the start; mid-sentence @id is NOT
 *    extracted as a participant (it stays in the text).
 *  - /command only fires immediately after the optional participant or at
 *    the very start. Mid-sentence /foo stays in the text.
 *  - VARIABLE_RE state isolation: parser must reset lastIndex between
 *    calls so the second call to parseChatRequest returns the same result.
 */

import { describe, expect, it } from 'vitest';
import { parseChatRequest } from '../../src/built-in/chat/input/chatRequestParser';

describe('parseChatRequest — newline & whitespace preservation', () => {
  it('preserves \\n between paragraphs', () => {
    const result = parseChatRequest('first paragraph\nsecond paragraph');
    expect(result.text).toBe('first paragraph\nsecond paragraph');
  });

  it('preserves a blank line (\\n\\n) between paragraphs', () => {
    const result = parseChatRequest('one\n\ntwo');
    expect(result.text).toBe('one\n\ntwo');
  });

  it('collapses runs of horizontal whitespace within a line but keeps newlines', () => {
    const result = parseChatRequest('a    b\nc\t\td');
    expect(result.text).toBe('a b\nc d');
  });

  it('trims trailing horizontal whitespace per line', () => {
    const result = parseChatRequest('hello   \nworld\t');
    expect(result.text).toBe('hello\nworld');
  });
});

describe('parseChatRequest — variables', () => {
  it('captures repeated occurrences of the same #variable separately', () => {
    const result = parseChatRequest('see #foo then #foo again');
    expect(result.variables.map((v) => v.name)).toEqual(['foo', 'foo']);
    // Both occurrences scrubbed from text.
    expect(result.text).not.toContain('#foo');
  });

  it('treats a hyphen as a word boundary — #my-var only captures #my', () => {
    const result = parseChatRequest('use #my-var');
    expect(result.variables.map((v) => v.name)).toEqual(['my']);
  });

  it('captures underscores and digits in variable names', () => {
    const result = parseChatRequest('use #foo_bar2 and #v1');
    expect(result.variables.map((v) => v.name).sort()).toEqual(['foo_bar2', 'v1']);
  });

  it('extracts variables that span across newlines', () => {
    const result = parseChatRequest('first\n#x\nsecond #y');
    expect(result.variables.map((v) => v.name).sort()).toEqual(['x', 'y']);
  });

  it('does not double-count between calls (regex lastIndex reset)', () => {
    const a = parseChatRequest('use #foo');
    const b = parseChatRequest('use #foo');
    expect(a.variables.map((v) => v.name)).toEqual(['foo']);
    expect(b.variables.map((v) => v.name)).toEqual(['foo']);
  });
});

describe('parseChatRequest — participant & command boundaries', () => {
  it('mid-sentence @id is NOT extracted as a participant', () => {
    const result = parseChatRequest('please ask @workspace about this');
    expect(result.participantId).toBeUndefined();
    expect(result.text).toBe('please ask @workspace about this');
  });

  it('mid-sentence /cmd is NOT extracted as a command', () => {
    const result = parseChatRequest('do not run /search here');
    expect(result.command).toBeUndefined();
    expect(result.text).toBe('do not run /search here');
  });

  it('/command without @participant fires at the start', () => {
    const result = parseChatRequest('/clear');
    expect(result.command).toBe('clear');
    expect(result.participantId).toBeUndefined();
  });

  it('@participant followed by another @id leaves the second @id in text', () => {
    const result = parseChatRequest('@workspace mention @other agent');
    expect(result.participantId).toBe('workspace');
    expect(result.text).toBe('mention @other agent');
  });

  it('escaped \\@ at the start blocks participant extraction', () => {
    const result = parseChatRequest('\\@workspace plain text');
    expect(result.participantId).toBeUndefined();
  });

  it('participant with command and a variable in the body', () => {
    const result = parseChatRequest('@workspace /search find #foo here');
    expect(result.participantId).toBe('workspace');
    expect(result.command).toBe('search');
    expect(result.variables.map((v) => v.name)).toEqual(['foo']);
    expect(result.text).toBe('find here');
  });
});
