// transcriptFormat.test.ts — pin transcript JSONL parser + renderers.
//
// Pins:
//   - Only type='message' lines included; other types dropped.
//   - Only role='user' | 'assistant' included (system / unknown dropped).
//   - Empty text after collapseWhitespace dropped.
//   - Whitespace collapsed (\s+ → ' ', trim).
//   - Multi-part content joined by single space, only type='text' parts contribute.
//   - Missing/null part.text → empty string.
//   - JSON parse errors swallowed (line skipped).
//   - CRLF + blank lines tolerated.
//   - Timestamp preserved verbatim when present; undefined otherwise.
//   - renderForIndexing: 'Role: text' lines joined by '\n', no timestamps.
//   - renderForDisplay: '[ts] Role\ntext' (when ts) or 'Role\ntext' (no ts); blocks joined by '\n\n'.

import { describe, it, expect } from 'vitest';
import {
  parseTranscriptJsonl,
  renderTranscriptForIndexing,
  renderTranscriptForDisplay,
} from '../../src/services/transcriptFormat';

const mk = (obj: any) => JSON.stringify(obj);

describe('parseTranscriptJsonl', () => {
  it('parses user + assistant messages and preserves timestamps', () => {
    const raw = [
      mk({ type: 'message', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      mk({ type: 'message', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } }),
    ].join('\n');
    const out = parseTranscriptJsonl(raw);
    expect(out).toEqual([
      { role: 'user', timestamp: 't1', text: 'hi' },
      { role: 'assistant', timestamp: 't2', text: 'yo' },
    ]);
  });

  it('skips non-message types', () => {
    const raw = [
      mk({ type: 'summary', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }),
      mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'y' }] } }),
    ].join('\n');
    expect(parseTranscriptJsonl(raw)).toEqual([
      { role: 'user', timestamp: undefined, text: 'y' },
    ]);
  });

  it('skips system / unknown roles', () => {
    const raw = [
      mk({ type: 'message', message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }),
      mk({ type: 'message', message: { role: 'tool', content: [{ type: 'text', text: 'tool' }] } }),
      mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'u' }] } }),
    ].join('\n');
    expect(parseTranscriptJsonl(raw).map(l => l.role)).toEqual(['user']);
  });

  it('drops messages whose collapsed text is empty', () => {
    const raw = mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: '   \n  ' }] } });
    expect(parseTranscriptJsonl(raw)).toEqual([]);
  });

  it('collapses whitespace and joins multi-part text with a single space', () => {
    const raw = mk({
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: ' a  b\nc ' },
          { type: 'text', text: ' d\te ' },
        ],
      },
    });
    expect(parseTranscriptJsonl(raw)[0].text).toBe('a b c d e');
  });

  it('non-text parts contribute empty string; missing text defaults to empty', () => {
    const raw = mk({
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'image', text: 'IGNORED' },
          { type: 'text' }, // missing text
          { type: 'text', text: 'only' },
        ],
      },
    });
    expect(parseTranscriptJsonl(raw)[0].text).toBe('only');
  });

  it('skips lines that fail JSON.parse', () => {
    const raw = ['not-json', mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'ok' }] } })].join('\n');
    expect(parseTranscriptJsonl(raw).map(l => l.text)).toEqual(['ok']);
  });

  it('tolerates CRLF, blank lines, and surrounding whitespace', () => {
    const raw = [
      '',
      '   ',
      mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'a' }] } }),
      '',
    ].join('\r\n');
    expect(parseTranscriptJsonl(raw).map(l => l.text)).toEqual(['a']);
  });

  it('timestamp undefined when omitted', () => {
    const raw = mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'a' }] } });
    expect(parseTranscriptJsonl(raw)[0].timestamp).toBeUndefined();
  });

  it('missing content array defaults to empty text (line dropped)', () => {
    const raw = mk({ type: 'message', message: { role: 'user' } });
    expect(parseTranscriptJsonl(raw)).toEqual([]);
  });
});

describe('renderTranscriptForIndexing', () => {
  it('formats as "Role: text" joined by single newline; no timestamps', () => {
    const raw = [
      mk({ type: 'message', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      mk({ type: 'message', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } }),
    ].join('\n');
    expect(renderTranscriptForIndexing(raw)).toBe('User: hi\nAssistant: yo');
  });

  it('empty input → empty string', () => {
    expect(renderTranscriptForIndexing('')).toBe('');
  });
});

describe('renderTranscriptForDisplay', () => {
  it('includes timestamp prefix when present and joins blocks with blank line', () => {
    const raw = [
      mk({ type: 'message', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      mk({ type: 'message', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } }),
    ].join('\n');
    expect(renderTranscriptForDisplay(raw)).toBe('[t1] User\nhi\n\n[t2] Assistant\nyo');
  });

  it('omits brackets when timestamp missing', () => {
    const raw = mk({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
    expect(renderTranscriptForDisplay(raw)).toBe('User\nhi');
  });
});
