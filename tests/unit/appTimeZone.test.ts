// One time zone for the whole app: the Time Zone setting (chat.timeZone), or
// this computer's zone when empty. Tools read it as api.env.timeZone; none
// hardcodes a zone of its own.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assistantTimeZone, machineTimeZone, setAssistantTimeZone } from '../../src/services/localTime';

afterEach(() => setAssistantTimeZone(''));

describe('the app time zone', () => {
  it('is the computer\'s zone when the setting is empty, the setting when it is a real zone', () => {
    setAssistantTimeZone('');
    expect(assistantTimeZone()).toBe(machineTimeZone());
    setAssistantTimeZone('Asia/Tokyo');
    expect(assistantTimeZone()).toBe('Asia/Tokyo');
    setAssistantTimeZone('Not/AZone');
    expect(assistantTimeZone()).toBe(machineTimeZone());
  });

  it('no tool hardcodes a time zone', () => {
    const roots = ['ext', 'src/built-in'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|ts|mjs|cjs)$/.test(name) && /timeZone:\s*['"][A-Z][A-Za-z_]+\/[A-Za-z_]+['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });
});
