---
name: build-extension
description: "Read before calling extension_propose: how to build a Parallx extension that installs, starts and looks like part of the app. The exact API, the look and copy rules, a complete working example, and a self-check. Use whenever the person asks you to build an extension, a tool they can turn on and off, a command, a tab, a page block or a chat tool."
version: 1.0.0
author: parallx
kind: workflow
permission: auto-allow
user-invocable: false
tags: [workflow, extension, design]
---

# Building an extension

An extension is a tool the person turns on and off. It adds things to the
app (a command, a tab, a page block, a dashboard widget, a chat tool) and
nothing runs for it while it is off. You hand it over with
`extension_propose({ manifest, files })`; the app checks it, the person reviews
what it adds and what it can reach, and only their Install writes it. A failed
check comes back to you: fix exactly what it names and propose again.

Parallx is one app, not a federation of tools. The extension supplies content
and actions; the app supplies every piece of chrome (buttons, headers, empty
states, inputs, menus). If you are styling a button, stop: the kit has it.

## The manifest

```json
{
  "manifestVersion": 1,
  "id": "assistant.reading-list",
  "name": "Reading List",
  "version": "0.1.0",
  "publisher": "assistant",
  "description": "Keeps a short list of things to read, in a tab of its own.",
  "main": "main.js",
  "activationEvents": ["onStartupFinished"],
  "engines": { "parallx": ">=0.1.0" },
  "contributes": {
    "commands": [{ "id": "assistant.reading-list.open", "title": "Open Reading List" }],
    "editors": [{ "typeId": "assistant.reading-list.list", "displayName": "Reading List" }]
  }
}
```

The id is lowercase with exactly one dot. Every command, editor and block id
starts with it. Send `manifest` and `files` as objects.

## The API, exactly

`main.js` is an ES module: `export function activate(api, context)` and
`export function deactivate()`. Push every disposable into
`context.subscriptions`, so turning the extension off removes everything.

- `api.commands.registerCommand('<id>.open', (...args) => result)`
- `api.editors.registerEditorProvider('<typeId>', { createEditorPane(container, input) { ...; return { dispose() {} }; } })`
  and open it with `api.editors.openEditor({ typeId: '<typeId>', title: 'Reading List', instanceId: 'main' })`.
- `api.chat.registerTool('<name>', { description, parameters: { type: 'object', properties, required }, requiresConfirmation: false, handler: async (args) => ({ content: 'text' }) })`
- `api.canvas.registerBlock({ typeId: '<id>.<name>', label, description, icon, defaultConfig, settings: { title, fields: { key: { type: 'string' | 'number' | 'enum', label, options? } } }, render(body, ctx) { draw from ctx.config; return { update(config) {}, dispose() {} }; } })`.
  Settings fields are only `string`, `number` or `enum`; a date is a `string` like `2026-10-27`.
  A block sits in a page, whose text is larger: give your block's root `font-size: var(--px-text-base)`.
- `api.dashboard.registerWidgetType({ typeId: '<id>.<name>', displayName, description, icon, category: 'static', defaultSize: { colSpan: 4, rowSpan: 3 }, defaultConfig: {}, createWidget(container, ctx) { draw into container; return { dispose() {} }; } })`
- `api.database`: `await api.database.open()`, then `run(sql, params)`,
  `get(sql, params)` gives `{ row }`, `all(sql, params)` gives `{ rows }`. Every
  result can be `{ error }`: check it.
- The kit (`api.ui`), never your own versions:
  `createPageHeader(root, { title, subtitle, primary: { label, onClick } })`,
  `createButton(parent, { id, label, kind: 'primary' | 'secondary' | 'ghost' | 'danger', size: 'sm', onClick })`,
  `createIconButton(parent, { id, icon, title, onClick })`,
  `createInput(parent, { id, label, placeholder })` gives `{ element, value }`,
  `createEmptyState(parent, { icon, headline, hint, action })`,
  `createSectionLabel(parent, 'Text')`, `createSegmented`, `createToggle`,
  `createSlider`, `createDropdown(parent, { items, selected, ariaLabel })`.
  Confirmations: `api.window.showConfirmModal({ message, confirmLabel, danger })`.
- Control ids read `<extension id>.<name>`. A control repeated in every row
  takes `id: null`.

- Another of the person's tools: `const { content, data } = await api.chat.invokeTool('a_tool_from_your_list', args)`.
  Use your own tool names and their parameters. The person is asked the first
  time and may say no (it rejects with the reason): catch it and say so in the
  view. Never `api.commands.executeCommand` another tool's command.

A chat tool's name is snake_case (letters, digits, underscores), like `log_study_session`: no dots.

Anything not in this list does not exist. Do not guess a function.

## One extension, several parts, one set of data

An extension that adds a tab, a page block, a dashboard widget and a chat
tool keeps ONE store (its database) and lets every part read it. When any part
changes the data (the chat tool logs something, the tab adds a row), every
part that is open redraws:

```javascript
const views = new Set();                       // redraw functions of open parts
const changed = () => { for (const redraw of views) redraw(); };
// in each part: views.add(draw); ...; on dispose: views.delete(draw);
// after every write: changed();
```

Open the database once in `activate` (one `ready` promise every part awaits).
A chat tool returns what it did in one sentence (`{ content: 'Logged 30 minutes of statistics.' }`)
and the numbers the person asked for.

## The look

- Colours only as `--px-*` tokens: `--px-text`, `--px-text-secondary`,
  `--px-text-muted`, `--px-accent-text` (accent as text), `--px-bg`,
  `--px-bg-elevated`, `--px-bg-inset`, `--px-border`, `--px-divider`,
  `--px-accent` (fills), status `--px-success`, `--px-warning`, `--px-danger`.
  Never `#hex` or `rgb(` with numbers.
- Type only as `--px-text-xs`, `-sm`, `-base`, `-md`, `-lg`, `-xl`. Never
  `font-size` in pixels, never `font-family`, never uppercase or letter-spaced
  labels.
- Space `--px-space-1` 4px up to `-8` 32px; radius `--px-radius-sm` controls,
  `-md` cards.
- A tab starts with `createPageHeader`; content below it padded
  `--px-space-6` at the sides. One primary action per view. A view with nothing
  in it shows `createEmptyState`.
- Flat and flush: one 1px `--px-divider` line between parts, no nested boxes,
  no shadows. Stay inside your container: no `position: fixed`, no `vh`/`vw`,
  no z-index, nothing added to the page outside it (your styles go in a
  `<style>` inside your own root).
- No native dialogs or selects: no `alert`, `confirm`, `prompt`, `<select>`.

## The words

- Actions and titles in Title Case, small joining words lowercase:
  `Add to List`, `Open Reading List`, `Remove`. Never `add` or `Add to list`.
- Labels, hints, empty states and errors in sentence case; sentences end with
  a period. No em dashes in labels, no emoji, no exclamation marks. An action
  that opens a dialog ends with `…`.

## Everyone can use it

The kit names and focuses what it builds. Text you draw yourself is plain
text; anything the person can press is a kit control. Every input has a label.

## Complete example

`main.js` for the manifest above. Build from it.

```js
const ID = 'assistant.reading-list';

const CSS = `
.reading-list { padding: 0 var(--px-space-6) var(--px-space-6); display: flex; flex-direction: column; gap: var(--px-space-4); }
.reading-list__form { display: flex; align-items: flex-end; gap: var(--px-space-2); }
.reading-list__rows { list-style: none; margin: 0; padding: 0; }
.reading-list__rows li { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-3);
  padding: var(--px-space-2) 0; border-bottom: 1px solid var(--px-divider); color: var(--px-text); }
`;

export function activate(api, context) {
  const ready = (async () => {
    const opened = await api.database.open();
    if (opened.error) throw new Error(opened.error.message);
    await api.database.run('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, added INTEGER NOT NULL)');
  })();

  context.subscriptions.push(api.editors.registerEditorProvider(`${ID}.list`, {
    createEditorPane(container) {
      const root = document.createElement('div');
      container.appendChild(root);
      const draw = async () => {
        await ready;
        const res = await api.database.all('SELECT id, title FROM items ORDER BY added DESC');
        const rows = res.error ? [] : res.rows;
        root.replaceChildren();
        const style = document.createElement('style');
        style.textContent = CSS;
        root.appendChild(style);
        api.ui.createPageHeader(root, { title: 'Reading List', subtitle: `${rows.length} to read` });
        const body = document.createElement('div');
        body.className = 'reading-list';
        root.appendChild(body);
        const form = document.createElement('div');
        form.className = 'reading-list__form';
        body.appendChild(form);
        const title = api.ui.createInput(form, { id: `${ID}.title`, label: 'Title', placeholder: 'A book or an article' });
        api.ui.createButton(form, {
          id: `${ID}.add`, label: 'Add to List', kind: 'primary',
          onClick: async () => {
            const text = title.value.trim();
            if (!text) return;
            await api.database.run('INSERT INTO items (title, added) VALUES (?, ?)', [text, Date.now()]);
            draw();
          },
        });
        if (rows.length === 0) {
          api.ui.createEmptyState(body, { icon: 'book-open', headline: 'Nothing to read yet.', hint: 'Add a title above to start the list.' });
          return;
        }
        const list = document.createElement('ul');
        list.className = 'reading-list__rows';
        body.appendChild(list);
        for (const row of rows) {
          const li = document.createElement('li');
          const name = document.createElement('span');
          name.textContent = row.title;
          li.appendChild(name);
          api.ui.createButton(li, {
            id: null, label: 'Remove', kind: 'ghost', size: 'sm',
            onClick: async () => { await api.database.run('DELETE FROM items WHERE id = ?', [row.id]); draw(); },
          });
          list.appendChild(li);
        }
      };
      draw();
      return { dispose() { root.remove(); } };
    },
  }));

  context.subscriptions.push(api.commands.registerCommand(`${ID}.open`, () =>
    api.editors.openEditor({ typeId: `${ID}.list`, title: 'Reading List', instanceId: 'main' })));
}

export function deactivate() {}
```

## Before you propose it

1. Every `api.` call is in the list above, in that shape.
2. Every id starts with the extension id; every disposable is in
   `context.subscriptions`.
3. No `#` colour, `rgb(` number, pixel font size, `font-family`, uppercase,
   emoji, `alert`/`confirm`/`<select>`, timer, network call or `import`.
4. Every button is a kit button with Title Case words; one primary per view;
   every input has a label; an empty view shows an empty state.
5. Tell the person in one sentence what it adds and how to open it once
   installed.
