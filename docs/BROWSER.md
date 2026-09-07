# Browser Charter

Started 2026-09-07 on branch `browser`. A private browser inside Parallx, so the
things Mufaro does on a computer live in one app with one boundary he owns:
documents, notes, the AI, and the web. Brave is the reference wherever it
applies, above all in how ads and trackers are blocked.

## What it is, and is not

It is a **private** browser: Electron's Chromium is the engine, so security
comes from isolation and hardening. It is **not an anonymous** browser. It
does not hide the IP address from the sites visited; that is Tor's job, and
Tor Browser's anonymity comes from years of fingerprint uniformity work that
will not be rebuilt here. If Tor is ever wanted it is a proxy toggle on top of
this, labelled for exactly what it hides.

Threat model, in order: documents leaving the machine through the AI; web
content steering the AI; a page attacking the app; the machine itself (disk
encryption, not the app's job, and said so).

## Guarantees the browser may claim

| Claim | Mechanism | Where |
| --- | --- | --- |
| Ads and trackers blocked | EasyList, EasyPrivacy, Peter Lowe and uBlock lists through the Ghostery adblocker engine (MPL-2.0), network filters in `webRequest`, cosmetic filters and scriptlets through the engine's own frame preload. Counted per tab, shown in the shield | `electron/browserBridge.cjs` |
| Third-party cookies blocked | `Cookie` stripped from third-party requests, `Set-Cookie` stripped from third-party responses; third-party = different registrable domain (tldts) from the tab's document | bridge, `browserPolicy.cjs` |
| HTTPS only | `http:` top-level navigations redirected to `https:` before any connection; local hosts and IP literals exempt; a site with no HTTPS gets an in-pane choice to load over HTTP once | bridge, policy |
| Generic fingerprint | Session user agent is a plain Chrome UA for the platform (no Electron, no app name), `Accept-Language` fixed, `Sec-GPC: 1` sent (Global Privacy Control, as Brave does) | bridge, policy |
| Popups contained | `setWindowOpenHandler` on every guest denies the window and hands the URL to the extension, which opens a tab or drops it | bridge |
| Permissions denied by default | Camera, microphone, location, notifications, clipboard read prompt through Parallx, remembered per site; device APIs (USB, HID, serial, MIDI, screen capture) denied outright | bridge |
| Storage isolated | Own persistent partition, separate from the app's session and from the agent's partition; one button clears it | bridge |
| Downloads contained | Only into the workspace `Downloads` folder (or the OS Downloads folder when no workspace is open), with progress in the sidebar | bridge |
| Nothing phones home | No telemetry, no sync, no accounts; filter lists refresh weekly from one fixed source, visible in the shield | bridge |
| Webview hardened | No Node, context isolated, sandboxed, no inherited preload (the existing `will-attach-webview` rule) | `electron/main.cjs` |

Not claimed: fingerprint defeat (Brave's farbling), script blocking per site,
IP anonymity.

## Two partitions

`persist:parallx-browser` is the user's: their logins, their history. 
`persist:parallx-browser-agent` is the agent's: empty, no cookies, no access to
the user's tabs. Agent browsing tools (a later phase) run only on the agent
partition, read pages only through the Web Research sanitizer, and act only
with per-action consent through the M90 consent model. The user's tabs feed
the AI through exactly one door, **Send Page To Chat**, which attaches the URL
and title so the model fetches through the sanitized chokepoint.

## Systems

- **Core bridge** (`electron/browserBridge.cjs`, `electron/browserPolicy.cjs`,
  preload `browser` namespace): sessions, blocking, cookies, HTTPS, UA,
  permissions, downloads, popup routing, per-site settings and permission
  decisions persisted under `userData/browser/`, filter engine cache and
  weekly refresh. `browserPolicy.cjs` is pure and unit tested.
- **Extension** (`ext/browser`): activity-bar container Browser with one
  sidebar (New Tab, Bookmarks, History, Downloads, Site Settings); one editor
  pane per page (each page is a workbench tab, so tabs, splits and drag are the
  workbench's own); the New Tab page rendered in-pane (no webview); toolbar
  with Back, Forward, Reload, address bar (URL or search, suggestions from
  history and bookmarks), shield with count and per-site panel, bookmark star,
  reader mode (vendored Mozilla Readability), find in page, zoom, page menu.
  Bookmarks, history and downloads in the extension's SQLite. Settings through
  the manifest: search engine, homepage, HTTPS only, shields default, cookie
  policy, clear on exit.
- **Keys** through the manifest keybindings with `activeEditor == 'browser.page'`,
  never a document keydown listener.

## Design rules

No AI slop: this is the workbench's own vocabulary. Theme tokens, the shared
dropdown, Title Case labels, no em dashes, no decorative chrome, no "AI"
badges. The shield panel reads like Brave's: what was blocked, on this site,
and a switch.

## Phases

1. Core bridge + policy + tests. Extension: pages, address bar, shields,
   history, bookmarks, downloads, permissions prompts, HTTPS fallback, New Tab.
2. Sealed workspace mode: a workspace flag that hard-blocks cloud models, web
   tools and extension egress, with a visible seal. Local model only.
3. Agent browsing tools on the agent partition.
4. Optional Tor proxy toggle, labelled.
