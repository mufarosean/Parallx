---
name: build-mini-app
description: "Read before writing a mini-app (an app block in your answer): how a Parallx mini-app must look, read and behave, with a starter to build from. Use whenever the person asks for a mini-app, a small interactive tool, a simulator, a calculator with several steps, or anything they should play with."
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: false
tags: [workflow, mini-app, interactive, design]
---

# Building a mini-app

A mini-app is a small HTML app inside your answer. It must look like part of
Parallx, not like a web page: calm, dense, dark-first, one accent colour, quiet
secondary text. The person judges the whole app by how it looks, so the rules
below are not optional.

## How it is written

One `app` block. First the lines `title: Name In Title Case` and, when it needs
more than 320 pixels, `height: 480`. Then the HTML: markup, one `<style>`, one
`<script>` at the end. Nothing is loaded from outside and nothing reaches the
network, files or the rest of Parallx: it runs locked down.

Do not explain the code in your answer, and do not show it twice. One sentence
before the app says what it lets the person do; one or two after say what to
try first.

## What the frame gives you

Plain controls already look right: `button`, `input`, `textarea`, `label`,
`table`, headings and focus rings are styled to match the app. Use them as they
are and only lay them out. Do not restyle a button, an input or a table.

- A button that is the one main action of the app gets `class="primary"`. At
  most one per app.
- Theme colours, only as CSS variables:
  - text: `--px-text`, `--px-text-secondary` (labels), `--px-text-muted`
    (hints, captions)
  - surfaces: `--px-bg`, `--px-bg-elevated` (a card), `--px-bg-inset` (a well)
  - lines: `--px-border`, `--px-divider`
  - accent: `--px-accent` for fills (a bar, a slider), `--px-accent-text` for
    accent-coloured text
  - status, sparingly: `--px-success`, `--px-warning`, `--px-danger`
- Type sizes, only these: `--px-text-xs` (captions), `--px-text-sm` (labels,
  secondary text), `--px-text-base` (body), `--px-text-md` (a card title),
  `--px-text-lg` (the one headline number). Weights 400 and 600 only.
- Space: `--px-space-1` 4px, `-2` 8, `-3` 12, `-4` 16, `-6` 24.
- Radius: `--px-radius-sm` for controls, `--px-radius-md` for a card.

## The look

- Never a colour literal: no `#hex`, no `rgb(` with numbers. Data colours on a
  chart are the one exception, and even then prefer the accent and
  `--px-text-muted`.
- Never `font-size` in pixels, never `font-family`, never
  `text-transform: uppercase` or letter-spaced labels.
- Flat and flush: separate parts with one 1px `--px-divider` line or with
  space, not with nested boxes, shadows or gradients. At most one card level.
- Numbers that change use `font-variant-numeric: tabular-nums`, so they do not
  jump while the person drags a slider.
- One thing stands out: the result the person is playing for, in
  `--px-text-lg`, weight 600. Everything else is quiet.
- Lay out with flex or grid and `gap`. Labels sit above or beside their
  control, aligned. Nothing wider than the frame; it must work at 400 pixels.

## The words

- Buttons are actions in Title Case: `Add Row`, `Reset`, `Start`, `Pause`.
  Never `add`, `Add row` or `ADD`.
- Labels and hints are sentence case: `Tail factor`, `Monthly payment`. Hints
  end with a period. No em dashes in labels, no emoji, no exclamation marks.
- Say each thing once. A control that is obvious needs no hint.

## Everyone can use it

- Every input, slider, checkbox and text area has a `<label>` (wrap the
  control, or `for=` its id). A control with no visible label gets
  `aria-label`.
- Every button has words, or an `aria-label` when it is only an icon.
- Everything works from the keyboard: use real buttons and inputs, never a
  clickable `div`.
- A result that changes as the person types or drags sits in an element with
  `aria-live="polite"`.

## Starter

Build from this. It already follows every rule above.

```app
title: Savings Goal
<div class="app">
  <div class="controls">
    <label>Saved each month
      <input id="monthly" type="range" min="50" max="2000" step="50" value="500">
    </label>
    <label>Months
      <input id="months" type="number" min="1" max="120" value="18">
    </label>
  </div>
  <div class="result" aria-live="polite">
    <span class="caption">Saved</span>
    <span id="saved" class="big"></span>
    <span id="left" class="caption"></span>
  </div>
  <button id="reset" type="button">Reset</button>
</div>
<style>
  .app { display: flex; flex-direction: column; gap: var(--px-space-4); }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--px-space-3); }
  .controls label { display: flex; flex-direction: column; gap: var(--px-space-1); }
  .result { display: flex; flex-direction: column; gap: 2px; padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
  .big { font-size: var(--px-text-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
  .caption { font-size: var(--px-text-sm); color: var(--px-text-muted); }
  #reset { align-self: flex-start; }
</style>
<script>
  const goal = 12000;
  const monthly = document.getElementById('monthly');
  const months = document.getElementById('months');
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  function show() {
    const saved = Number(monthly.value) * Number(months.value);
    document.getElementById('saved').textContent = money(saved);
    document.getElementById('left').textContent = saved >= goal
      ? 'Goal of ' + money(goal) + ' reached.'
      : money(goal - saved) + ' still to save for ' + money(goal) + '.';
  }
  monthly.addEventListener('input', show);
  months.addEventListener('input', show);
  document.getElementById('reset').addEventListener('click', () => { monthly.value = 500; months.value = 18; show(); });
  show();
</script>
```

## Before you send it

Check the app against this list, and fix it rather than explain it:

1. No `#` colour, `rgb(` number, pixel font size, `font-family` or uppercase.
2. Every control has a label; every button has Title Case words.
3. One result stands out; everything else is quiet and sentence case.
4. Works at 400 pixels wide, from the keyboard alone.
5. The numbers are right: check one case by hand.
