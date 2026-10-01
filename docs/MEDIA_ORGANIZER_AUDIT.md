# Media Organizer: features, navigation and menus, as they are

Status: written 2026-10-01 to open the discussion. Nothing in it has been
changed yet.

## How this was done

- **Read the code.** Every entry point in `ext/media-organizer/main.js` was
  traced to the function it calls. That covers the sidebar, the library page
  header, toolbar and View popover, the right-click menus, the selection bar,
  the detail page, the album page, the Duplicate Finder, the shortcuts sheet,
  and all 31 commands in `parallx-manifest.json`. Line numbers below are as of
  commit `68754574`.
- **Ran it.** A probe scene (`node tests/probes/ui-screenshot-probe.mjs <out>
  moaudit`) was run against a library of three JPEGs, a GIF and an MP4. It:
  - recorded every menu's items;
  - pressed the Delete key on a selection;
  - moved a photo to Trash, opened Trash and right-clicked in it;
  - ran commands from the palette with no arguments and recorded every message
    the app showed;
  - backdated a trashed photo, restarted the tool and rescanned.

  Each item below says whether it was **seen in the app** or **read in the
  code**.
- **What it cannot say.** Media Organizer keeps no record of what is used or
  how often. Nothing here claims a feature is unused, only what each one does
  and how it is reached.

## 1. Broken

**1.1 Empty Trash crashes, and so do three other confirmations (seen in the app).**

- Running Empty Trash fails with "Cannot read properties of undefined (reading
  'trim')", and nothing appears on screen.
- The cause: `moEmptyTrash` passes its buttons as plain strings
  (`'Empty Trash', 'Cancel'`, main.js:30055). The notification service reads
  `action.title` on each button (`src/api/notificationService.ts:309`), so a
  string has no `title` and the call throws before the prompt is drawn.
- Three more calls use the same pattern and fail the same way:
  - the Duplicate Finder's Send Others to OS Trash (28966);
  - the clip editor's Delete Preset (25828) and Overwrite Preset (25880).
- In practice: Trash can never be emptied by hand, the Duplicate Finder cannot
  remove anything, and a clip export preset cannot be deleted or overwritten.

**1.2 Trash that empties itself brings the photos back (seen in the app).**

- On start-up, `moAutoEmptyTrashIfStale` (30085) deletes library rows that have
  been in Trash longer than 30 days.
- It leaves the files on disk. The folder watcher then re-imports them at once.
- In the run, the trashed `three.jpg` (photo id 2) came back as a new photo
  (id 4), not in Trash, with "Media auto-scan: 1 new".
- Its tags, rating, albums and edits would not come back with it.

**1.3 Trash is a one-way door (seen in the app and read in the code).**

- Nothing in the interface puts anything into Trash. Only the palette's Move
  Selected to Trash does, plus Upscale's "delete the original" option (28257).
- Nothing takes anything out:
  - `moRestoreFromTrash` (30024) exists but nothing calls it.
  - The Trash view has the same right-click menu as everywhere else: no
    Restore, no Empty Trash.
  - Its header still offers Add Folder….

**1.4 Delete is permanent everywhere, and deletes the files by default (seen in the app).**

- Delete… in the right-click menus, Delete… on the selection bar and the Delete
  key all open `showBulkDeleteDialog` (18711).
- That dialog says "Delete 4 items? This permanently removes the selected items
  and all of their metadata". Its "Also delete source files" box is ticked by
  default.
- The shortcuts sheet says the opposite: "Delete: Move selected to Trash"
  (10306).
- There are four ways to delete, with four different results:

  | Where | What it does |
  | --- | --- |
  | Delete… (menus, selection bar, Delete key) | Removed from the library for good; files deleted too, unless unticked (through Eraser when it is set up) |
  | Duplicate Finder, Send Others to OS Trash | Files to the OS recycle bin and the rows deleted directly (28959). It skips `moPurgeMedia`, so it skips Eraser (read in the code; it also crashes first, see 1.1) |
  | Upscale, delete the original | Into the app's Trash (28257) |
  | Palette, Move Selected to Trash | Into the app's Trash |

**1.5 Edit Image from the palette opened a photo that was in Trash (seen in the app).**

- After `three.jpg` was moved to Trash, the library's selection still held it.
- The palette's Edit Image then opened it in the editor.

**1.6 Palette commands that cannot work from the palette (seen in the app).**

- **Reveal in Media Organizer** needs a file path, and nothing in Parallx passes
  one. From the palette it always says "Reveal in Media Organizer: no path
  provided."
- **Open Clip Editor** needs a path too. Its message tells you to "choose Trim /
  Export Clip", a label that exists nowhere in the app.
- **Open Smart Album**, when there are none, says to use "Save Smart Album". The
  button is called Save As Smart Album.

## 2. Missing

**2.1 A folder, once added, cannot be removed (read in the code).**

- Nothing deletes from `mo_scan_roots`.
- `FolderQueries.destroy` is never called.
- The folder keeps being watched and re-imported for good.

**2.2 Folder rows have no right-click menu (seen in the app).**

- There is no Rescan, no Show in Folder, no Remove From Library.
- Tags and albums both have right-click menus.

**2.3 The single-video clip editor is reachable only from an unlabelled icon (read in the code).**

- The only way in is an icon on the video player's rail on the detail page.
  Its tooltip is "Trim → export clip / GIF" (15600).
- A video's right-click menu offers Add to Clip Project, but nothing to trim or
  export that one video.

**2.4 The album page is an older, separate interface (read in the code).**

- `renderAlbumEditor` (16729) shows its own small cards.
- It has no selection, no right-click menu, no lightbox, no sort, filter or
  layouts.
- A single click opens the detail page. In the library, a single click only
  focuses.
- Its buttons are bare HTML, not the kit's.
- Delete has no "…" although it asks first.

## 3. Duplicated or inconsistent

**3.1 Two different "Duplicates".**

- The sidebar's **Duplicates** is a library view of byte-identical files
  (md5, 12874).
- The page ⋯ menu's **Find Duplicates** opens the Duplicate Finder (28837). It
  shows those same exact groups **and** look-alike groups, but only once
  perceptual hashes have been built, which is a separate palette command.
- They share a name and partly the same results, in two places.

**3.2 The same action twice on one page (seen in the app).**

- Save As Smart Album is both in the page ⋯ menu and in the View popover.

**3.3 Two things called Keyboard Shortcuts.**

- The library ⋯ menu's opens Media Organizer's own sheet.
- The gear menu's opens the app's keybindings editor.

**3.4 Two meanings of "Favorite".**

- **Favorites** in the sidebar means items rated 5 stars (12844).
- **Mark Favorite** on a tag pins that tag to the top of the list.
- There is no way to favourite a photo other than rating it 5.

**3.5 Click does different things by layout (read in the code).**

- In Grid and List, a click focuses and a double-click opens the detail page.
- In Feed, a click opens the lightbox and a double-click opens the detail page.
- All Media opens as Feed (seen in the app); every other view opens as Grid.

**3.6 One action, several names.**

| Action | Names it goes by |
| --- | --- |
| Add a folder | Scan Directory (palette), Add Folder… (page header, sidebar) |
| New album | Create Album (palette), New Album… (sidebar) |
| Remove | Delete… (menus), Move Selected to Trash (palette) |
| Show the file | Open File Location (menu), Show in Folder (editors' notices), "Reveal focused item in file explorer" (shortcuts sheet, Ctrl+Shift+E) |

**3.7 What each surface offers (seen in the app).**

"✓" means present. Video and selection columns come from the menus as they
appeared.

| Action | Photo menu | GIF menu | Video menu | Selection menu | Selection bar | Detail page |
| --- | --- | --- | --- | --- | --- | --- |
| View Full Size | ✓ | ✓ | ✓ | | | |
| Edit Details | ✓ | ✓ | ✓ | | | (is the page) |
| Edit Image | ✓ | ✓ (a GIF) | | | | ✓ |
| Select Similar Photos | ✓ | ✓ (a GIF) | | | | similar strip |
| Tag… | ✓ | ✓ | ✓ | ✓ | ✓ | tags field |
| Tag With AI / Retag With AI | ✓ | ✓ | | ✓ | ✓ (one button, menu) | |
| Rate | ✓ | ✓ | ✓ | ✓ | ✓ | rating field |
| Color Label | ✓ | ✓ | ✓ | ✓ | | |
| Add to Album… | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Add to Clip Project | | | ✓ | ✓ (videos) | | |
| Add to Chat | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Optimize GIF… | ✓ (a JPG) | ✓ | | ✓ (always) | | |
| Upscale… | ✓ | ✓ (a GIF) | | ✓ | ⋯ | |
| Paste Edit | when copied | when copied | | when copied | | |
| Remove Marks From Selected | | | | ✓ (2+ photos) | | |
| Compare | | | | | ⋯ | |
| Export… | | | | | ⋯ | |
| Open File Location, Copy File Path | ✓ | ✓ | ✓ | | | |
| Delete… | ✓ | ✓ | ✓ | ✓ | ✓ | |

What the table shows:

- **The GIF menu is the photo menu, unchanged.** Optimize GIF… shows on a JPG
  and only says "only applies to .gif files" after it is clicked. Edit Image,
  Select Similar Photos and Upscale… show on a GIF.
- **Export… and Compare are only on the selection bar.**
- **Color Label is not on the selection bar.**
- **Remove Marks From Selected is only in the selection's right-click menu.**
- **The selection's right-click menu starts with "4 selected"**, a row that can
  be clicked and does nothing (14553).
- **The single-photo menu has 16 items and 3 separators**, all at one level.

**3.8 Odd homes.**

- The screen recorder's **Record GIF** button lives in the footer of the
  Keyboard Shortcuts sheet (10371).
- Toggle Screen Recorder's message tells you to look for it there.

## 4. The command palette

31 commands. "UI" says where else in the app the same thing is reached.

| Command | UI | Notes |
| --- | --- | --- |
| Scan Directory | Add Folder… | name differs |
| Cancel Scan | none | |
| Rescan Library | page ⋯ | |
| Generate Thumbnails | none | housekeeping |
| Clean Orphan Thumbnails | none | housekeeping |
| Show Thumbnail Cache Stats | none | housekeeping |
| Rebuild Search Index | none | housekeeping |
| Build Perceptual Hashes | Select Similar's prompt, the detail page's similar strip | the Duplicate Finder needs it but only says "Run Build Perceptual Hashes first" (28911), with no button |
| Open Library | sidebar All Media | |
| Open Tag Review | sidebar Tag Review | |
| Create Album | sidebar Collections + | name differs |
| Save Current Search as Smart Album | page ⋯, View popover, Collections + | three places |
| Open Smart Album | sidebar Collections | quick pick; its message names a label that does not exist |
| Find Duplicates | page ⋯ | see 3.1 |
| Move Selected to Trash | none | the only way into Trash (with Upscale's option) |
| Empty Trash | none | crashes (1.1) |
| Reveal in Media Organizer | none | needs a path; useless from the palette (1.6) |
| Keyboard Shortcuts | page ⋯, `?` | |
| Toggle Screen Recorder, Record GIF (Screen) | shortcuts sheet footer | |
| Open Clip Editor | detail page rail icon | needs a path from the palette (1.6) |
| New Clip Project…, Open Clip Project… | sidebar Studio | |
| Practice Session, Daily Study, Painting Plans | sidebar Studio (when on) | |
| Set Up The Upscaler | Upscale dialog, image editor Enhance | |
| Edit Image, Paste Edit Onto Selected Photos | menus | act on the library's selection |
| Remove Marks From Other Photos, From Selected Photos | image editor, selection menu | |

## 5. My own mistakes found on the way

The shortcuts sheet (10280–10336) is out of date from work earlier today:

- It still says "Drag the sash between sections to resize". The sashes went
  with the sidebar redesign.
- It says `/` focuses "the tag / folder filter". It is the tag filter now.
- It lists Ctrl+S as "Save over the original". Ctrl+S saves a copy since the
  image editor redesign.
- It does not list P, F, Ctrl+U, W, V or Ctrl+[ / ].

## 6. What I would do, in order

1. **Fix what is broken; small and safe.**
   - Pass `{ title }` in the four confirmations (1.1). Better, make the
     notification service accept a plain string, so the next caller cannot
     break it.
   - Correct the shortcuts sheet (5).
   - Clear a trashed item from the selection (1.5).
   - Hide Reveal in Media Organizer and Open Clip Editor from the palette
     (1.6), since they need arguments.
   - Fix the "Save Smart Album" and "Trim / Export Clip" wording.
2. **Deleting: built 2026-10-01** after Mufaro: "maybe we give an option, a
   user can choose to have permanent delete which is currently routed through
   eraser, or normal delete that sends things to trash and clears through
   eraser after 30 days." Setting `mediaOrganizer.deleteMode`:
   - `permanent` (default, as before) asks, then deletes.
   - `trash` moves to Trash without asking.

   Trash now:
   - Restore and Delete Permanently… in its menu and selection bar;
   - Empty Trash… as its page action;
   - after 30 days, items are removed through `moPurgeMedia`, files and all,
     so they no longer come back (1.2 fixed).

   Probe: `motrash`.
3. **Folder management.** A right-click on a folder row:
   - Rescan;
   - Show in Folder;
   - Remove From Library… (stops watching; files untouched).
4. **One Duplicates.**
   - The sidebar row opens the Duplicate Finder with Exact and Look-alike
     tabs, and builds hashes on demand.
   - Find Duplicates leaves the ⋯ menu.
5. **Menus by kind and in one order.**
   - Photo, GIF and video menus show only what applies.
   - The single-item and selection menus use the same groups in the same
     order: open, edit, organise, AI, send, file, delete.
   - The selection bar keeps the frequent ones.
   - Export… and Compare join the selection menu.
   - Rarer items (Copy File Path, Optimize GIF, Add to Chat) go into a
     submenu.
   - The "4 selected" row goes.
6. **Names.**
   - One name per action: Add Folder…, New Album…, Show in Folder, and the
     Trash words from step 2.
   - The housekeeping commands go into one Library Maintenance… page.
7. **Album page.** Make an album a scope of the library grid
   (`grid:album:<id>`, which the instance parser already reads). Albums then
   get selection, menus, sort and layouts. The album's own fields (title,
   description) go in its header.

**Decided 2026-10-01 and built:**

- **Feed** stays the default for All Media (3.5).
- **Favorites** replace the 1–5 stars: one mark on cards, menus, the
  selection bar, the detail page and the lightbox. The keyboard shortcut is
  F; search with `is:favorite`. Existing ratings became favorites (3.4).
  Probe: `mofav`.
- **The screen recorder** moved to Studio's + (New Clip Project… or Record
  Screen…). The on/off setting and Toggle Screen Recorder are gone (3.8).
- **Fixed:** the four crashing confirmations (1.1) and the shortcuts sheet
  (5).

**Still open:** folder management (step 3), one Duplicates (4), menus by
kind (5), names (6), the album page (7), and a new name for the tool.
