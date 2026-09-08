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
| Ads and trackers blocked | EasyList, EasyPrivacy, Peter Lowe and uBlock lists through the Ghostery adblocker engine (MPL-2.0), network filters in `webRequest`; cosmetic CSS through the engine's frame preload; scriptlets (the YouTube-class defence) injected at document start in the main world through the devtools protocol, before any page script and immune to page CSP, chosen per destination when a navigation starts. Counted per tab, shown in the shield | `electron/browserBridge.cjs` |
| Third-party cookies blocked | `Cookie` stripped from third-party requests, `Set-Cookie` stripped from third-party responses; third-party = different registrable domain (tldts) from the tab's document | bridge, `browserPolicy.cjs` |
| HTTPS only | `http:` top-level navigations redirected to `https:` before any connection; local hosts and IP literals exempt; a site with no HTTPS gets an in-pane choice to load over HTTP once | bridge, policy |
| Generic fingerprint | Session user agent is a plain Chrome UA for the platform (no Electron, no app name), `Accept-Language` fixed, `Sec-GPC: 1` sent (Global Privacy Control, as Brave does) | bridge, policy |
| Popups blocked | Chromium's popup blocker is not in Electron, so `popupDecision` (policy) is the rule: a page may open one new window per user gesture in it (click or key, tracked from `input-event`), only within 5 seconds of the gesture, and never to a destination the lists would stop it embedding (the popunder networks). An allowed one becomes a tab; a blocked one counts in the shield and the tracker log as a popup; non-web schemes are dropped | bridge, policy |
| Permissions denied by default | Camera, microphone, location, notifications, clipboard read prompt through Parallx, remembered per site; device APIs (USB, HID, serial, MIDI, screen capture) denied outright | bridge |
| Storage isolated | Own persistent partition, separate from the app's session and from the agent's partition; one button clears it | bridge |
| Private stays private | Everything opened from a private tab is private: the plus button, Open Link or Image In New Tab, Search For, popups and target=_blank links the page opens (the opener's pane decides), Ctrl+T while a private tab is active. Only the sidebar's New Tab and the page menu's New Regular Tab open a regular tab on purpose. |
| Downloads contained | Only into the workspace `Downloads` folder (or the OS Downloads folder when no workspace is open), with progress in the sidebar | bridge |
| Nothing phones home | No telemetry, no sync, no accounts; filter lists (EasyList, EasyPrivacy, Peter Lowe, the uBlock filters including quick-fixes and unbreak, and by default the annoyance lists: EasyList Cookie and uBlock annoyances, `browser.blockAnnoyances`) refresh every 12 hours from one fixed source, visible in the shield. One engine cache per list set (`engine.bin`, `engine-full.bin`) | bridge |
| Page views hardened and durable | Each page is a main-process `WebContentsView`: no Node, context isolated, sandboxed, no preload of ours. It is positioned over the pane from bounds the renderer reports, so moving a tab, splitting, or evicting the pane never reloads the page; a view is destroyed only when its editor really closes | `electron/browserBridge.cjs` |
| Page views yield to the workbench | A native view sits above the whole DOM, so each frame the pane hit-tests a grid inside the page area: a foreign element there (dialog, menu, palette, tab-drop indicator) makes the view yield to a snapshot of itself until the way is clear; every drag (tab, file, sash) freezes all pages the same way so the document sees the mouse; the view stops short of the half-sash strip on each boundary and paints it in the page's own colour | `ext/browser/main.js` |
| No white flash between pages | Chromium paints a view's own background between two documents, white by default. The pane sets the app surface at creation and the page's own colour once read (the same read that paints the sash strips), so the gap matches what was on screen. |
| Deleted means gone | History, bookmarks and the download list are rows in the extension database, a file that stays open, so the database overwrites them itself: secure_delete zeroes a deleted row at once, the write-ahead log is checkpointed and truncated after every deletion, and a bulk clear ends in VACUUM. Downloaded files deleted from the sidebar go to Eraser first (core secure delete, path in Settings under Security) and are deleted permanently when Eraser is missing. Clear Browsing Data uses Chromium's thorough clearData plus cache, code cache, shared dictionary, auth and DNS caches. Nothing the browser deletes touches the Recycle Bin | `ext/browser/main.js`, `electron/main.cjs` |

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
  workbench's own; the page itself is a main-process view over the pane, so a
  move never reloads it); overlays that would sit under the native view (shield
  panel, menus, address suggestions) hide it behind a snapshot; the link
  preview lives in the status bar; the New Tab page rendered in-pane; toolbar
  with Back, Forward, Reload, address bar (URL or search, suggestions from
  history and bookmarks), shield with count and per-site panel, bookmark star,
  reader mode (vendored Mozilla Readability), find in page, zoom, page menu.
  Private tabs (Ctrl+Shift+N) run on an in-memory partition that is cleared when
  the last one closes and never write history. Internal pages: about:newtab,
  about:bookmarks, about:history, about:shields (the blocked-tracker log with
  lifetime totals, kept by the bridge). A plus button and a bookmarks bar in
  the toolbar; page theme (prefers-color-scheme per tab through the devtools
  protocol) as a setting.
  Bookmarks, history and downloads in the extension's SQLite. Settings through
  the manifest: search engine, homepage, HTTPS only, shields default, cookie
  policy, clear on exit.
- **Keys** through the manifest keybindings with `activeEditor == 'browser.page'`,
  never a document keydown listener.

## Deleting data

Deleting in the browser is a security act, not housekeeping.

- **Rows.** History, bookmarks and the download list live in the extension
  database at `<workspace>/.parallx/extensions/parallx.browser/data.db`. The
  file stays open while Parallx runs, so no file eraser can be pointed at it;
  the database overwrites instead. `PRAGMA secure_delete = ON` is set on the
  connection at activation, every deletion is followed by
  `PRAGMA wal_checkpoint(TRUNCATE)` (the log is folded back and cut to zero
  bytes), and Clear History and Clear Browsing Data end in `VACUUM`. Verified
  with a fixture: a deleted URL is no longer anywhere in the file.
- **Files.** Delete File on a download asks the core delete for
  `secure: true`. Main hands the path to Eraser (`addtask /quiet
  /schedule=now file=...`), which overwrites and removes it; the file is on
  disk until Eraser finishes. Without Eraser the delete is permanent. The
  Recycle Bin is never used for a secure delete.
- **Chromium's files.** Cookies, HTTP cache, site storage, code caches and
  the bounce-tracking and interest-group databases are Chromium's own; Clear
  Browsing Data asks Chromium to remove them (`clearData` and the specific
  clears). Those are ordinary deletes inside the partition folder, the same as
  Brave's. Private tabs write nothing to disk in the first place.
- **Recycle Bin policy.** `files.deleteToRecycleBin` (Settings, Security,
  per workspace) off makes every deletion Parallx performs in that workspace
  permanent, whatever the caller asked. Files on a different drive than the
  user profile never reach the Recycle Bin either way. `files.eraserPath` is
  where the secure delete looks for Eraser.

What remains: the disk clusters a truncated log or a vacuumed file gave back
still hold their old bytes until something overwrites them. Eraser's Erase
Unused Space on the drive is the mop-up for that, run by hand now and then.

## Design rules

No AI slop: this is the workbench's own vocabulary. Theme tokens, the shared
dropdown, Title Case labels, no em dashes, no decorative chrome, no "AI"
badges. The shield panel reads like Brave's: what was blocked, on this site,
and a switch.

## Phases

1. **Built.** Core bridge + policy + tests. Extension: pages, address bar,
   shields, history, bookmarks, downloads, permission prompts, HTTPS fallback,
   New Tab, reader mode, find, zoom.
2. **Built.** Sealed workspace mode (`workspace.sealed`, Security): no cloud
   providers, network tools hidden and refused, egress chokepoint refuses,
   a Sealed chip in the title bar. `src/services/sealedWorkspace.ts`.
3. **Built.** Agent browsing on the agent partition: the Assistant Browser
   tab (banner says whose it is and what it is doing) and five chat tools:
   `browserOpen`, `browserRead`, `browserBack` (free), `browserClick`,
   `browserType` (each confirmed by the user). Pages come back as
   `<untrusted_web_content>` with numbered links, buttons and inputs; the
   session has no logins; the tools vanish in a sealed workspace.
4. **Not built, by decision.** A Tor proxy toggle would hide the IP address
   from sites and nothing more; it is a day's work on top of this if ever
   wanted, and it must be labelled for exactly that.

## Verified so far

- Cosmetic filtering end to end in a sandboxed page: tests/probes/browser-cosmetics-probe.cjs (hidden window, local page, real engine cache).

Unit tests: `browserPolicy` (8), `sealedWorkspace` (4); the full suite
passes; `tsc` is clean; the extension parses as an ES module. Not yet run
in the app. First run: open the Browser container, open a tab, load a site
with trackers, check the shield count, try a permission prompt, download a
file, seal a workspace and confirm the cloud model and web tools disappear,
then ask the assistant to open a page and watch the Assistant Browser tab.
