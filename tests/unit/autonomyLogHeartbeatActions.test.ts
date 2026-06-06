import { describe, expect, it } from 'vitest';

import { _isActionableHeartbeat, _heartbeatSeedPrompt } from '../../src/built-in/autonomy-log/main';

type Entry = Parameters<typeof _isActionableHeartbeat>[0];

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    origin: 'heartbeat',
    content: 'A test file is failing to parse.',
    metadata: undefined,
    ...over,
  } as Entry;
}

describe('_isActionableHeartbeat', () => {
  const none = new Set<string>();

  it('is actionable for a heartbeat entry with content', () => {
    expect(_isActionableHeartbeat(entry(), none)).toBe(true);
  });

  it('is not actionable for non-heartbeat origins', () => {
    expect(_isActionableHeartbeat(entry({ origin: 'cron' }), none)).toBe(false);
    expect(_isActionableHeartbeat(entry({ origin: 'agent' }), none)).toBe(false);
  });

  it('is not actionable when content is empty/whitespace', () => {
    expect(_isActionableHeartbeat(entry({ content: '   ' }), none)).toBe(false);
  });

  it('is not actionable for error deliveries', () => {
    expect(_isActionableHeartbeat(entry({ metadata: { error: true } }), none)).toBe(false);
  });

  it('is not actionable once handled this session', () => {
    expect(_isActionableHeartbeat(entry({ id: 'x' }), new Set(['x']))).toBe(false);
  });
});

describe('_heartbeatSeedPrompt', () => {
  it('frames the finding and appends the instruction', () => {
    const p = _heartbeatSeedPrompt('  Build is broken.  ', 'Please go ahead and handle it.');
    expect(p).toContain('background heartbeat check');
    expect(p).toContain('Build is broken.');        // trimmed
    expect(p).not.toContain('  Build is broken.  '); // not the untrimmed form
    expect(p.endsWith('Please go ahead and handle it.')).toBe(true);
  });
});
