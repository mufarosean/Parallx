# AI tagging: one tool, your tags, a review list

The first attempt gave the chat AI twenty Media Organizer tools. It tagged the
wrong photos, invented tags, and ignored nesting. The cause of the wrong photos
was structural: `viewImage` put a photo in the chat composer, the model saw it
one turn later as pixels with no id, and in a loop it had to remember which
picture belonged to which id. The tools were switched off on 2026-06-02.

This program replaces all of them with one tool and a review list.

## What a user gets

- **Tag With AI** on a photo's right-click menu (grid and Home), on a
  multi-selection's right-click menu, and on the selection bar. **Retag With
  AI** sits beside it everywhere: a fresh look at the photo, its current tags
  replaced on Approve.
- **One chat tool**, `mediaOrganizer_tagPhotos`: "how many photos are
  untagged?", "tag my untagged photos", "retag these", or specific photo ids
  (`mode: "retag"`, and a `tagged` scope for the photos that have tags). The
  chat AI never handles images; it starts a run and reports where the
  results are.
- **Tag Review**, a tab (sidebar: Library > Tag Review, with a count).
  Every photo from a run appears with its suggested tags shown as full paths
  (`ANIMALS › DOG › CORGI`). Per photo: remove a suggestion, add one of your
  tags, then Approve or Skip. Approve All is a shortcut, never a requirement.
  No Match and Failed photos are marked and can be retried.
- A run goes in the background, one photo at a time, and survives closing the
  tab. Stop finishes the photo in progress; the rest wait for Resume.
- **Tagging Rules** (Tag Review, the Rules button): text you write once per
  workspace, sent as its own section of every tagging request, chat tool and
  menu alike. For a library whose tags are close to one another it is where
  you say which one wins: "STUDY means a drawing done from this photo, not
  the photo itself", "use CORGI only when the breed is unmistakable, otherwise
  DOG", "never tag people by name". The rules cannot add a tag you do not
  have; the schema and the validation still allow only your tags. Up to 4000
  characters; saved as you type.

## The rules (enforced in code, not asked of the model)

1. **Existing tags only.** The model receives your tag tree. With Ollama the
   reply is constrained by a JSON schema whose only allowed values are your tag
   paths, so it cannot write a tag you do not have. Every reply is validated
   again against the tree before it reaches the review list; anything unknown
   is dropped.
2. **Parents come along.** Picking `CORGI` adds `DOG` and `ANIMALS` on Approve.
3. **One parent per tag.** Nesting a tag under a new parent moves it (drag in
   the sidebar, or the path form in New Tags). The path form refuses to put an
   existing tag under a second parent and says where it lives. Merging keeps
   the destination where it is in the tree.
4. **ALL CAPS.** Every tag name is stored upper case, whichever way it was
   created or renamed. Uniqueness is case-insensitive, so `Beach` and `BEACH`
   can no longer both exist.
5. **Photos only.** GIFs and videos are left out and counted in the report.
6. **Tags are only added, unless you ask for a retag.** On Tag With AI a
   photo keeps the tags it has; the model is told which ones it already has
   and does not suggest them again. On **Retag With AI** the model sees the
   photo with no tags and proposes its whole set; the review row shows the
   current tags struck through beside the picks, and Approve replaces them
   (their parents included). Skip keeps the photo as it is. Nothing is
   removed until Approve, and never on an ordinary tagging run.
7. **Nothing reaches a photo without Approve.**

## When the tool exists

The tool is registered when the Media Organizer activates and unregistered
when it deactivates, so it exists only while the extension is enabled. It then
sits in the same tool list as the built-in tools (AI Settings > Tools, under
Media Organizer) and in what the model is sent. Disable the extension and it
leaves both; two filters also keep a disabled extension's tools out of the
model's list and refuse calls to them.

Building this found the app starting disabled extensions anyway: a `*`
activation request (and reopening a saved tab) activated an extension without
checking that it was enabled, so its code ran and its tools registered while
it was off. The workbench now drops activation requests for disabled
extensions, and tab restore does not wake them. AI Settings > Tools also names
extension groups by the extension ("Media Organizer") instead of its id, and
its filter matches that name. `tests/probes/tool-visibility-probe.mjs`
checks disabled, enabled and disabled again in the real app.

## The image the model sees

The original is never modified and nothing is written to disk. The file is
decoded in memory and re-encoded as a JPEG of at most 1536 px on the long
edge (quality 0.9): about the most a vision model uses, since Claude and the
Qwen vision models scale larger images down themselves and extra pixels only
cost GPU memory. Formats the browser cannot decode (HEIC, TIFF, RAW) use the
library's own 1536 px thumbnail instead.

**Detail Crops** (a switch on the Tag Review tab, off by default): for photos
larger than 3072 px on the long edge, the model also gets the four quarters of
the photo, each up to 1024 px, so small subjects stay legible. Slower.

## The model

Your chat model, read at the start of every run. A run refuses to start when
that model does not report vision support, and says so. No separate tagging
model: one model in GPU memory, no swapping. The request turns thinking off,
uses temperature 0 and does not change the context size (changing it makes
Ollama reload the model).

## How it fits together

- `mo_ai_tag_reviews` (migration 021): one row per photo, status queued,
  running, pending, nomatch or failed, the picked tag ids, the model, and
  (migration 024) the `mode`, `add` or `retag`. Approve and Skip delete the
  row. A row left `running` by a closed app goes back to `queued` on the next
  start. `moTagApprovePlan` (pure) turns a row into what Approve writes: the
  live picks with their ancestors, what to add, and on a retag what to
  remove; the grid is told `REPLACE` for a retag and `ADD` otherwise.
- The runner is a module singleton: one photo at a time, `mo:ai-tag-changed`
  after each so the tab and the sidebar count update.
- Tagging rules live in `mo_settings` under `ai_tag_rules` (per workspace,
  like the detail-crops switch). The runner reads them for every photo, so an
  edit applies from the next photo on; `moTagRulesText` trims and caps them
  and `moTagPrompt` places them after the instructions and before the tag
  list, headed "Rules for this library".
- Pure logic (name normalisation, tag paths, ancestors, the schema, the prompt,
  reply parsing, pick resolution, crop rectangles) sits between
  `@mo-tag-pure-begin` and `@mo-tag-pure-end` and is extracted verbatim by
  `tests/unit/moAiTagging.test.ts`.
- The twenty old tools, their handlers and the "last viewed media" anchor are
  deleted, not left commented out.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Syntax | `node --check ext/media-organizer/main.js` | OK |
| Pure tagging logic | `npx vitest run tests/unit/moAiTagging.test.ts` | 21 pass |
| Tag rules and the review queue on a real database | `ELECTRON_RUN_AS_NODE=1 electron tests/probes/tag-rules-probe.cjs` | 40 pass |
| Real model, real photo | `node tests/probes/ai-tag-model-probe.mjs <photo> qwen3.8:27b` | 5/5 (below) |
| Tag Review in the app | `node tests/probes/tag-review-probe.mjs <outDir>` (hidden) | every step passes (below) |
| Whole suite | `npx vitest run` | 6034 pass |
| Types | `npx tsc --noEmit` | clean |

The model check used a colour photo of a boxing match (a fighter standing
over a knocked-down opponent, a crowd, press photographers with cameras) and
a tree with right answers and decoys. `qwen3.8:27b` answered
`SPORTS › BOXING, PEOPLE › CROWD, EQUIPMENT › CAMERA` and none of the decoys
(beach, corgi, wedding, black and white); with BOXING already on the photo it
did not repeat it. About 15 s for the first photo (model load), 1.7 s after.

The in-app probe seeds a workspace (four real images, the tag tree, one review
row per state), launches the app hidden and checks, with no renderer errors:
the four states and their buttons; thumbnails (the original for a small photo,
generated 1536 px thumbnails for large ones); the add-tag list (portalled to
the body at z-index 10005, typing shown in capitals) turning a No Match row
reviewable; removing a chip; Approve writing BOXING, CAMERA, EQUIPMENT and
SPORTS (not the removed CROWD or its parent PEOPLE) and removing the row;
Resume running the real runner on the queued colour-bars image, in-memory
image included, which came back as `PATTERNS › TEST CARD`; the sidebar's
Tag Review count; Tag With AI in the grid menu and on the selection bar.

A fresh app root treats a newly found external extension as disabled (it
activates, but its manifest contributions wait), so the probe enables the
Media Organizer the way the Tools view does before it opens the sidebar.
