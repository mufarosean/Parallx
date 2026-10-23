// @vitest-environment jsdom
// Creations AI: Test Drive (ext/creations-ai/drive.js). Three scenes
// written from the sheet, the reply to each heard through Try A Line's own
// call, and the three replies read together: what repeats, what is
// announced, what slips out, what ends on a slogan. Mechanical, no judge.

import { describe, it, expect } from 'vitest';
import {
  SITUATION_KINDS, buildSituationsMessages, parseSituations, buildDriveMessages,
  readTestDrive, summarizeFindings, renderTestDriveMarkdown, mountTestDrive, abstractSubjects, runLiveTestDrive,
// @ts-expect-error — JS module with no types
} from '../../ext/creations-ai/drive.js';

const SHEET = {
  name: 'Ada Lovelace', description: 'Ada counts everything.', personality: 'Dry and exact.', voice: 'Short lines.',
  drives: 'Wants: the ledger balanced.\nFears: being found out.\nIn the way: her brother.',
  secrets: 'She cannot add in her head and hides the abacus under the counter.',
  relationships: 'Babbage: strained.', exampleDialogue: '', reminder: '',
};

describe('the three scenes', () => {
  it('asks for work, pressure and idle lines from this sheet, as JSON', () => {
    const [system, user] = buildSituationsMessages(SHEET);
    expect(SITUATION_KINDS.map((s: any) => s.kind)).toEqual(['work', 'pressure', 'idle']);
    expect(system.content).toContain('"work"');
    expect(system.content).toContain('"pressure"');
    expect(system.content).toContain('"idle"');
    expect(system.content).toContain('addressed to Ada Lovelace');
    expect(user.content).toContain('Secrets:\nShe cannot add');
  });
  it('reads the reply, dashes stripped, and fills a missing scene with its fallback line', () => {
    const out = parseSituations('{"situations":[{"kind":"work","line":"The ledger again — how far along are you?"},{"kind":"idle","line":"Did you eat?"}]}');
    expect(out.map((s: any) => s.kind)).toEqual(['work', 'pressure', 'idle']);
    expect(out[0].line).toBe('The ledger again, how far along are you?');
    expect(out[1].line).toBe('You went quiet just now. What was that about?');
    expect(out[2].line).toBe('Did you eat?');
    expect(parseSituations('nonsense')).toHaveLength(3);
  });
  it('hears each reply through Try A Line\'s own call', () => {
    const [system, user] = buildDriveMessages(SHEET, { kind: 'idle', line: 'Did you eat?' });
    expect(system.content).toContain('You are Ada Lovelace. Stay in character.');
    expect(user.content).toBe('Did you eat?');
  });
});

describe('the reading', () => {
  const situations = parseSituations('');

  it('finds a phrase said in two replies, the longest form only, never the name', () => {
    const findings = readTestDrive(SHEET, situations, [
      'The column never lies. Pass the ledger.',
      'As I said, the column never lies, and Ada Lovelace keeps it so.',
      'Fine.',
    ]);
    const repeats = findings.filter((f: any) => f.kind === 'repeat');
    expect(repeats).toHaveLength(1);
    expect(repeats[0].detail).toContain('"column never lies"');
    expect(repeats[0].scenes).toEqual([0, 1]);
  });

  it('flags a value named as a subject, a secret said out loud, a slogan ending and dashes', () => {
    const findings = readTestDrive(SHEET, situations, [
      'Loyalty is everything to me. Pass the ledger.',
      'I cannot add in my head, so I keep the abacus hidden under the counter.',
      'We could eat. The soup is on — it is enough. That is enough.',
    ]);
    const kinds = findings.map((f: any) => `${f.kind}:${f.scenes.join(',')}`);
    expect(kinds).toContain('abstract:0');
    expect(kinds).toContain('secret:1');
    expect(kinds).toContain('mug:2');
    expect(kinds).toContain('dash:2');
    expect(abstractSubjects('Trust is a thing you earn.')).toEqual(['Trust is a thing you earn.']);
    expect(abstractSubjects('I trust the ledger.')).toEqual([]);
  });

  it('three plain replies read clean, and a question is never a slogan', () => {
    const findings = readTestDrive(SHEET, situations, [
      'Nearly there. Two columns left and the totals still disagree by a shilling.',
      'Nothing. I was thinking about the bread.',
      'Not yet. Is there any of the soup left, or did Tom finish it?',
    ]);
    expect(findings).toEqual([]);
    expect(summarizeFindings([])).toContain('Nothing repeated');
    expect(summarizeFindings([{ kind: 'mug' }])).toBe('1 thing to look at.');
  });

  it('renders each scene with its line, the reply and its findings as Markdown', () => {
    const replies = ['Nearly there.', 'Nothing.', 'Not yet. That is enough.'];
    const md = renderTestDriveMarkdown(situations, replies, readTestDrive(SHEET, situations, replies));
    expect(md).toContain('**The work**');
    expect(md).toContain('> How is the work going?');
    expect(md).toContain('Nearly there.');
    expect(md).toContain('- Ends on a slogan: "That is enough."');
  });
});

describe('the Studio section', () => {
  it('runs the four calls, paints the reading and reports through the meta line', async () => {
    const host = document.createElement('div');
    const calls: string[] = [];
    const metas: string[] = [];
    let busy = false;
    const ui = {
      createButton: (c: HTMLElement, o: any) => { const b = document.createElement('button'); b.textContent = o.label; b.dataset.command = o.command; c.appendChild(b); return b; },
      renderMarkdown: (md: string) => { const d = document.createElement('div'); d.className = 'px-markdown'; d.textContent = md; return d; },
    };
    async function* chunks(parts: string[]) { for (const p of parts) yield { content: p }; }
    const lm = {
      sendChatRequest: (_m: string, messages: any[], _o: any) => {
        calls.push(messages[0].content.slice(0, 30));
        if (messages[0].content.startsWith('You write three short opening')) return chunks(['{"situations":[{"kind":"work","line":"Ledger?"},{"kind":"pressure","line":"Why so quiet?"},{"kind":"idle","line":"Soup?"}]}']);
        return chunks(['Two columns left. ', 'That is enough.']);
      },
    };
    const drive = mountTestDrive(host, { ui, lm, sheet: () => SHEET, resolveModel: async () => ({ modelId: 'm1', numCtx: 0 }), setMeta: (t: string) => metas.push(t), isBusy: () => busy, setBusy: (b: boolean) => { busy = b; } });
    expect(host.querySelector('button')!.textContent).toBe('Drive');
    expect(host.querySelector('button')!.dataset.command).toBe('textGenerator.studio.testDrive');
    await runLiveTestDrive();
    void drive;
    expect(calls).toHaveLength(4);
    expect(host.querySelector('button')!.textContent).toBe('Drive Again');
    const md = host.querySelector('.px-markdown')!.textContent!;
    expect(md).toContain('> Ledger?');
    expect(md).toContain('Said again');
    expect(metas.at(-1)).toMatch(/things? to look at/);
    expect(busy).toBe(false);
  });
});
