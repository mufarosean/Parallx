# Panel and Flashcards visual checks

Run from the repository root using installed dependencies:

```powershell
node tests/ui-polish/prepare.mjs
node tests/ui-polish/probe.mjs
node ext/flashcards/test/run-navigation-probe.mjs
```

For this session's retained baseline, `node tests/ui-polish/review.mjs`
generates an interactive before/after page at
`test-results/agent-reliability/ui-review.html`. It requires the original
baseline artifacts; the main probe does not.

Preparation archives the current tracked source into a new code snapshot,
overlays the UI files under review, and builds there. It does not rebuild the
shared checkout. Each probe creates a new owned app profile and workspace,
installs only the repository's Flashcards extension into that profile, and
seeds six synthetic decks through its real database bridge. No user profile,
decks, or workspace contents are copied. Inference and terminal execution are
not needed; the shared isolation guard disables unrelated capabilities.

The probe enables Flashcards in the new profile and reloads after database
seeding so the cached sidebar also reads the fixture. Sidebar checks cover
search, no-match feedback, keyboard tabs, keyboard deck menus, counts on
hover, and narrow/wide layouts. Native captures include the actual sidebar
at 202px and approximately 792px widths.

The probe uses production views and services. It checks deck filtering and
no-match feedback, responsive layout, timestamp toggling, reveal, visible
rating controls, keyboard grading, Undo, and scrolling the end of an answer
above its controls. Screenshots cover dark/light tokens and 1280×800 / 900×720
windows. A successful run writes `evidence/result.json` beside its images.

Artifacts and the `ui-prepared.json` build pointer live under
`test-results/agent-reliability/`, reusing the existing owned-root launcher.
Failed attempts remain available. The hidden Electron capture warms the
compositor and waits for frames and finite animations before saving, avoiding
the stale images returned by a single capture of a hidden window.

Terminal commands are disabled in this fixture; its startup message is a
fixture limitation. These tests verify the terminal's shared chrome, not shell
execution. There are no Problem Bank or Worksheet fixtures or changes.
