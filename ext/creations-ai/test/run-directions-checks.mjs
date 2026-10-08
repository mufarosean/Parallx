// run-directions-checks.mjs — Part 3 of docs/CREATIONS_QUALITY_TESTING.md:
// does Directions work, and is each option right. Calls the pure
// buildDirectorPrompt and parseDirections from director.js on fixed scenes
// (scenarios.mjs), with the app's own options (temperature 0.9, at most 1200
// tokens, streamed). Whether a pick works, and whether Directions makes the
// story better, need the real chat: run-roleplay-sessions.mjs measures those.
//
//   node ext/creations-ai/test/run-directions-checks.mjs --mock
//   node ext/creations-ai/test/run-directions-checks.mjs --pass play
//   node ext/creations-ai/test/run-directions-checks.mjs --pass judge
//   --asks <n>   asks per scene (5)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDirectorPrompt, parseDirections, DIRECTION_KINDS } from '../director.js';
import { DIRECTOR_SCENES } from './scenarios.mjs';
import {
  parseArgs, createGateway, createReport, judgeJson, ollamaPs, SkipCase,
  contentWords, jaccard, pairwiseOverlap, pairwiseCosine, median,
} from './harness-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv, { name: 'directions-checks', report: path.join(__dirname, 'last-directions-checks.md'), samples: 1 });
const argv = process.argv.slice(2);
const ASKS = Math.max(1, Number(argv.includes('--asks') ? argv[argv.indexOf('--asks') + 1] : 5) || 5);
const KIND_KEYS = DIRECTION_KINDS.map((k) => k.key);

function mockRespond(label, messages, { role }) {
  if (role === 'judge') {
    const n = (messages[1].content.match(/^\d+\./gm) || []).length;
    return JSON.stringify({ options: Array.from({ length: n }, (_, i) => ({ kind: KIND_KEYS[i % 4], decides_other: false, contradicts_memory: false })) });
  }
  const names = (/Write the options for: (.+)\./.exec(messages[1].content) || [])[1]?.split(', ') || [];
  const ask = Number((/ask (\d+)/.exec(label) || [])[1] || 1);
  return names.map((n, ci) => `## ${n}\n${[
    `Deepen: Straightens the twelve rolls on the counter without a word ${ask}${ci}.`,
    `Push: Asks Sam to drive her to the area manager's office tonight ${ask}${ci}.`,
    `Complicate: Finds the forged prescription slip in the rain-soaked crate ${ask}${ci}.`,
    `Move: Locks the pharmacy door and walks out to Kemal's kebab shop ${ask}${ci}.`,
  ].join('\n')}`).join('\n\n');
}

const gw = createGateway(opts, { mockRespond });
const report = createReport('Creations: Directions checks', opts);
const psBefore = ollamaPs(opts);
await gw.load();

const totals = { calls: 0, wellFormed: 0, kindAgree: 0, kindN: 0, grounded: 0, groundedN: 0, decides: 0, contradicts: 0, judgedN: 0, stale: 0, staleN: 0, echo: 0, echoN: 0 };
const firstMs = [];
const lastMs = [];
const withinOverlap = [];
const withinCos = [];

for (const sc of DIRECTOR_SCENES) {
  report.section(`Scene: ${sc.id}`);
  const cast = sc.cast.map((c) => ({ name: c.name, tagline: c.tagline, drives: c.drives, secrets: c.secrets, relationships: c.relationships }));
  const names = cast.map((c) => c.name);
  const messages = buildDirectorPrompt({ cast, others: sc.others || [], scene: sc.scene, memory: sc.memory, transcript: sc.transcript, recentNotes: sc.recentNotes || [] });
  const context = messages[1].content;
  const ctxWords = new Set(contentWords(context));
  const byCharKind = new Map(); // `${name}|${kind}` -> option texts across asks

  for (let a = 1; a <= ASKS; a++) {
    const label = `${sc.id} ask ${a}`;
    let groups;
    try {
      let first = -1;
      const raw = await gw.call(label, messages, {
        temperature: 0.9, maxTokens: 1200,
        onText: (text, ms) => { if (first < 0 && parseDirections(text, names, { complete: false }).some((g) => g.options.length)) first = ms; },
      });
      const last = gw.calls[gw.calls.length - 1];
      if (!last.cached && last.ms) { lastMs.push(last.ms); if (first >= 0) firstMs.push(first); }
      groups = parseDirections(raw, names);
      if (a === 1) report.sample(`${sc.id} ask 1`, raw);
    } catch (err) {
      if (err instanceof SkipCase) { report.skip(label, err.message); continue; }
      throw err;
    }
    totals.calls++;
    const ok = names.every((n) => {
      const g = groups.find((x) => x.name === n);
      return g && g.options.length === 4 && KIND_KEYS.every((k) => g.options.some((o) => o.kind === k));
    });
    if (ok) totals.wellFormed++;
    report.check(`${label}.format`, 'reads into four options per character, one of each kind', ok, groups.map((g) => `${g.name}: ${g.options.map((o) => o.kind).join(',')}`).join(' | '));

    const all = groups.flatMap((g) => g.options.map((o) => ({ name: g.name, ...o })));
    for (const o of all) {
      // Grounded: shares a content word with the scene, the memory or the sheet.
      totals.groundedN++;
      if (contentWords(o.text).some((w) => ctxWords.has(w))) totals.grounded++;
      // Fresh: no restatement of a note the last turns were written with.
      for (const n of sc.recentNotes || []) { totals.staleN++; if (jaccard(o.text, n) > 0.5) totals.stale++; }
      // Echo across asks: the same idea back for the same character and kind.
      const key = `${o.name}|${o.kind}`;
      const prev = byCharKind.get(key) || [];
      if (prev.length) { totals.echoN++; if (prev.some((p) => jaccard(p, o.text) > 0.4)) totals.echo++; }
      byCharKind.set(key, [...prev, o.text]);
    }
    for (const g of groups) {
      const ov = pairwiseOverlap(g.options.map((o) => o.text));
      withinOverlap.push(ov.mean);
      const vecs = await gw.embed(g.options.map((o) => o.text));
      if (vecs) withinCos.push(pairwiseCosine(vecs).mean);
    }

    // Judge on the first two asks: kind without its label, other people's moves, memory.
    if (a <= 2 && all.length) {
      try {
        const listed = all.map((o, i) => `${i + 1}. (${o.name}) ${o.text}`).join('\n');
        const v = await judgeJson(gw, `${label} judge options`,
          `You classify suggestions for a character's next move in a roleplay. The kinds:\n${DIRECTION_KINDS.map((k) => `- ${k.key}: ${k.rule}`).join('\n')}\nFor each numbered option say which kind it is (judge by what it does, not by any wording), whether it decides how ANOTHER person answers or acts ("decides_other"), and whether it contradicts the memory below ("contradicts_memory"). Reply as JSON: {"options": [{"kind": "deepen|push|complicate|move", "decides_other": false, "contradicts_memory": false}]} in the same order.`,
          `MEMORY:\n${(sc.memory.facts || []).map((f) => `- ${f.text}`).join('\n')}\n\nOPTIONS:\n${listed}`);
        const verdicts = Array.isArray(v?.options) ? v.options : [];
        all.forEach((o, i) => {
          const x = verdicts[i];
          if (!x) return;
          totals.judgedN++;
          totals.kindN++;
          if (String(x.kind || '').toLowerCase() === o.kind) totals.kindAgree++;
          if (x.decides_other === true) totals.decides++;
          if (x.contradicts_memory === true) totals.contradicts++;
        });
      } catch (err) {
        if (err instanceof SkipCase) report.skip(`${label}.judge`, err.message); else throw err;
      }
    }
  }
}

report.section('Totals');
const share = (n, d) => (d ? n / d : 0);
if (totals.calls) {
  report.metric('format', 'calls read into four per character with all four kinds', share(totals.wellFormed, totals.calls), '0.95 or more');
  report.check('format', 'format rate at or above 95 percent', share(totals.wellFormed, totals.calls) >= 0.95, `${totals.wellFormed}/${totals.calls}`);
}
if (firstMs.length) report.metric('latency.first', 'seconds to the first option (median)', median(firstMs) / 1000);
if (lastMs.length) report.metric('latency.last', 'seconds to the last option (median)', median(lastMs) / 1000);
if (totals.kindN) {
  report.metric('kind', 'kind agreement with the judge', share(totals.kindAgree, totals.kindN), '0.8 or more');
  report.check('kind', 'kind agreement at or above 80 percent (judge)', share(totals.kindAgree, totals.kindN) >= 0.8, `${totals.kindAgree}/${totals.kindN}`);
  report.metric('decides', 'options deciding someone else\'s move (judge)', share(totals.decides, totals.judgedN));
  report.metric('contradicts', 'options contradicting the memory (judge)', share(totals.contradicts, totals.judgedN));
}
if (withinOverlap.length) report.metric('different.words', 'within a character, pairwise word overlap of the four (mean)', withinOverlap.reduce((a, b) => a + b, 0) / withinOverlap.length);
if (withinCos.length) report.metric('different.cosine', 'within a character, pairwise embedding similarity (mean)', withinCos.reduce((a, b) => a + b, 0) / withinCos.length);
if (totals.echoN) report.metric('echo', 'across asks, options repeating an earlier one (same character and kind)', share(totals.echo, totals.echoN));
if (totals.groundedN) {
  report.metric('grounded', 'options naming something from the scene, memory or sheet', share(totals.grounded, totals.groundedN));
  report.check('grounded', 'nine in ten options grounded', share(totals.grounded, totals.groundedN) >= 0.9, `${totals.grounded}/${totals.groundedN}`);
}
if (totals.staleN) report.check('fresh', 'no option restates a recent note', totals.stale === 0, `${totals.stale} restated`);

const failures = await report.write(gw, `\`\`\`text\nollama ps before:\n${psBefore}\n\nollama ps after:\n${ollamaPs(opts)}\n\`\`\``);
process.exitCode = opts.mock && failures ? 1 : 0;
