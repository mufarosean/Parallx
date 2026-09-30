# Media Organizer: why new, saved and deleted files were slow to show

Investigation of 2026-09-28. Status: six faults found and fixed, one likely
cause of the slow saves found and removed, **not yet confirmed on Mufaro's own
library**. Nothing here is committed.

## What was reported

- A file copied into a gallery folder appears at once.
- A file saved into it (from a website, or Save As Copy from the editor) takes
  ages to appear. This is old, not new.
- An upscaled copy and a delete are slow to show as well.

## How a new file reaches the view

1. The app core watches each gallery folder and tells Media Organizer about a
   change 0.1 s after it happens.
2. Media Organizer waits 0.5 s for more news, then takes the files one at a time.
3. For each file: is it finished and readable, read it (checksum), measure it
   (size, camera data), make its thumbnail, add it to the library.
4. The sidebar and the open view are told to reload; the view waits 0.2 s and
   reloads.

There is no periodic rescan. A folder is walked at launch and when Refresh is
pressed. Anything the watcher gets wrong stays wrong until then.

## What was measured

All in the real app, run hidden, on made-up libraries. Times are from "the file
is complete on disk" to "its tile is in the view".

| Case | Result |
| --- | --- |
| File copied in | 1.4 to 1.7 s |
| File saved the way a browser saves (temporary name, rename, marked as from the internet) | 1.8 to 2.2 s |
| Real Unsplash photos downloaded by the real Edge browser into the folder (JPEG 6000 px, WebP, AVIF, PNG) | 1.9 to 2.2 s |
| The same, library of 20,000 photos | copied 3.2 to 3.7 s, saved 3.7 to 4.0 s |
| A saved file that another program holds for 12 s (as antivirus can), before the fix | a tile with no picture at 2 s, **never repaired**, WebP left unconverted |
| The same, after the fix | appears whole, with its picture, once the file is let go |
| Delete with Eraser, before the fix | the photo **never left the view** (60 s) until Refresh |
| The same, after the fix | gone 2.8 s after Delete is pressed |
| Upscale from the library menu, before the fix | no visible change in the feed; two errors in the watcher |
| Save As Copy from the editor, before the fix | the copy was hidden under the original |

Timers in a window that is out of sight (Electron 40, measured outside Parallx;
the watcher's three waits add up to 1.1 s):

| Window out of sight for | Background slowdown on (Parallx until today) | Off (VS Code's setting) |
| --- | --- | --- |
| under a minute | 3.0 s | 1.1 s |
| over five minutes | did not finish in 90 s (one timer a minute) | 1.1 s |

## Faults found and fixed

1. **A saved file was treated as changed every time it was looked at.** Windows
   records a freshly written file's time to a ten-millionth of a second. The
   library stored it to 15 digits and compared for exact equality, so a saved
   file never matched its own record: it was read and measured again at every
   launch and on every touch. A copied file keeps its old, rounder time and
   matched. This is a real difference between copying and saving.
2. **Every update of a picture's size record failed** ("no such column:
   updated_at"): the update wrote a column those tables do not have.
3. **Parallx's own saves raced the watcher.** The editor and the watcher both
   added the file; one failed ("UNIQUE constraint failed"). Files now take
   turns, one path at a time.
4. **A delete with Eraser never refreshed the view.** The photo leaves the
   library when Delete is confirmed; its record is removed when the erase
   completes; if the erase fails it comes back.
5. **Parallx's copies were hidden.** Save As Copy and Upscale stacked the copy
   under the original and the feed showed no sign of a stack. Copies are now
   photos of their own. Later the same day stacks were retired altogether
   (docs/IMAGE_EDITOR.md, Stacks retired): a copy whose original was deleted
   had stayed hidden for good.
6. **A file that could not be read yet was added anyway**, as an item with no
   picture, no size and no checksum, and stayed that way until the next launch.
   One empty or unfinished file also held every file behind it for up to eight
   seconds at a time. A file that is not ready is now set aside and looked at
   again (after 0.5 s, 1 s, 1 s, 2 s ... for about four minutes) while the
   others go ahead.
7. **A file moved or renamed on disk** kept its old place in the views until
   something else refreshed them.

## The likely cause of the slow saves (not confirmed)

Parallx's window used Chromium's default: when the window is minimised or
wholly covered by another window, the page's timers are slowed to one a second,
and after five minutes to one a minute. The library's pipeline is three timers
long. A picture saved from a maximised browser arrives while Parallx is covered;
nothing is taken in until Parallx is brought back, and then the saved files are
worked through one at a time, the view reloading for each. A file copied in
Explorer usually arrives while Parallx is still in view and is taken in as it
lands.

Every test of mine ran with this slowdown switched off, because the hidden test
window needs it off to draw. That is why the tests showed two seconds.

The window now keeps its timers running out of sight
(`backgroundThrottling: false` in `electron/main.cjs`, as VS Code sets). This
also applies to chat, automations and the heartbeat, which run on the same
timers. The cost is a little more processor use while Parallx is minimised.

Not confirmed: that this is what Mufaro saw. It could not be reproduced inside
the hidden app, because the test driver makes the page count as in view.

## How to trace a slow save

Media Organizer now keeps a record of the last 200 new files in
`<workspace>/.parallx/extensions/media-organizer/import-log.json`: the file's
path, when the library first heard of it, how long it waited and why (empty,
still changing, unreadable), how long reading and adding took, and whether the
window was out of sight. The status bar says "Adding name" and "Waiting for N
new files to be readable" while it works.

After a save that was slow, that record says which stage was slow.

## Open

- With a made-up library of 20,000 photos the launch scan was still running
  after 15 minutes (at 600 photos it takes 4 s). Not explained. The made-up
  library had no thumbnails, which may be the whole of it.
- A reload of the feed returns it to the top.
- A saved file whose contents match a photo already in the library is counted
  as a duplicate and not shown. It is recorded in the import log.
- No periodic rescan. The watcher is the only thing between a change on disk
  and the view.

## Checks

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/moImageEdit.test.ts tests/unit/modelBridge.test.ts tests/unit/moPlan.test.ts tests/unit/moGridView.test.ts` | 86 of 86 pass |
| `node tests/probes/image-editor-probe.mjs <outDir>` (the whole editor, in the hidden app, after these changes) | every check passed, no renderer errors; saved copies unstacked |
| Held-file test (12 s hold; AVIF, WebP, JPEG) | all three appear whole after release |
| Real Edge downloads from Unsplash | four of four in 1.9 to 2.2 s |
