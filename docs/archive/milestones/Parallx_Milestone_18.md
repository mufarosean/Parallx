# Milestone 18 — Production PDF Viewer

## Research & Implementation Document — June 2025

**Branch:** `milestone-15` (continuation)

---

## Table of Contents

1. [Vision](#vision)
2. [Current State Audit](#current-state-audit)
3. [Research — PDF.js Viewer Layer](#research--pdfjs-viewer-layer)
4. [Architecture Decision](#architecture-decision)
5. [Capability Inventory](#capability-inventory)
6. [Task Tracker](#task-tracker)
7. [Verification Checklist](#verification-checklist)
8. [Risk Register](#risk-register)

---

## Vision

**Before M18 — what the user experiences today:**

> You open a 116-page insurance policy PDF. The viewer loads, but it doesn't feel smooth — zooming tears down every page and rebuilds them from scratch. There's no search, so finding "collision deductible" means scrolling through 116 pages manually. No outline panel, no thumbnails, no page rotation. Text selection sort-of works but the highlight opacity is hardcoded and the selection layer doesn't align well at non-100% zoom. All pages use hardcoded US-Letter dimensions (612×792 pts), so any PDF with different page sizes renders at wrong proportions. There's no DPR handling, making text look fuzzy on HiDPI displays. The viewer is functional but feels like a prototype.

**After M18 — what the user will experience:**

> Same 116-page PDF. The viewer opens instantly with a professional toolbar. Pages render crisp on HiDPI displays because PDF.js's built-in DPR handling is active. You press `Ctrl+F` and a search bar appears — type "collision deductible", see match count, jump between highlighted results. Click the outline icon to see the document's table of contents; click any heading to jump there. Toggle thumbnail sidebar for visual navigation. Zoom is smooth — the viewer uses CSS scaling with a detail canvas for the visible area, so only one high-res render happens instead of 116. Page rotation works. The viewer uses the battle-tested PDF.js Viewer layer that powers Firefox's built-in PDF reader.

**The one-sentence pitch:**

> Replace the DIY Display-layer PDF rendering with PDF.js's production Viewer layer — gaining search, outline, thumbnails, render queue, DPR, and detail canvas for free.

**Why this matters:**

The current PDF viewer (built in M15/M17) uses only PDF.js's Display layer — the low-level `getDocument()` + `page.render()` API. It manually manages an IntersectionObserver, has no canvas eviction, no render cancellation, no render priority queue, and rebuilds all page placeholders on zoom. PDF.js ships a complete **Viewer layer** (`pdfjs-dist/web/pdf_viewer.mjs`) that solves all of these problems. It's the same code that powers Firefox's PDF reader. This milestone replaces our ~478 lines of DIY rendering code with the mature, battle-tested Viewer layer components.

---

## Current State Audit

### What exists (pdfEditorPane.ts — 478 lines)

| Aspect | Current Implementation | Problem |
|--------|----------------------|---------|
| **Rendering** | DIY IntersectionObserver, renders nearest pages | No render queue, no priority, no cancellation. If user scrolls fast, many concurrent renders pile up. |
| **Canvas management** | Creates canvas per page, never evicts | Memory grows linearly with pages rendered. A 200+ page PDF will accumulate hundreds of canvases. |
| **DPR handling** | None | Text and lines appear fuzzy on Retina/HiDPI displays (2x, 3x). |
| **Zoom** | Tears down ALL canvases, recreates ALL placeholders, re-triggers observer | Jarring visual flash. Scroll position restoration is approximate (fraction-based). Expensive even for pages far from viewport. |
| **Page dimensions** | Hardcoded 612×792 (US Letter) for placeholders | PDFs with A4, legal, or mixed page sizes render at wrong proportions until individually rendered. |
| **Text layer** | `pdfjsLib.TextLayer` with hardcoded 0.25 opacity | No search highlight integration. Alignment degrades at non-standard zoom levels. |
| **Search** | None | Users must visually scan for content. |
| **Outline/TOC** | None | No way to navigate document structure. |
| **Thumbnails** | None | No visual page navigation. |
| **Link navigation** | None | Internal PDF links (TOC, cross-references) don't work. |
| **Annotation layer** | None | PDF form fields, comments, and links not rendered. |
| **Rotation** | None | Landscape-oriented pages can't be rotated. |
| **Print** | None | No way to print the document. |
| **Toolbar** | Basic: prev/next, page input, zoom ±, fit-width, fit-page | Missing: search, outline toggle, thumbnail toggle, rotation, print, spread modes. |
| **Keyboard shortcuts** | Arrows, PageUp/Down, Home/End, Ctrl+G, Ctrl+±  | Missing: Ctrl+F (search), Ctrl+P (print), R (rotate). |

### What PDF.js Viewer layer provides for free

These are exported from `pdfjs-dist/web/pdf_viewer.mjs` (v5.4.624):

| Export | Purpose |
|--------|---------|
| `PDFViewer` | Full page management — render queue, canvas buffer (eviction ring), DPR, detail canvas, CSS-zoom + partial re-render, scroll/spread modes, annotation layer, text layer, struct tree layer |
| `PDFPageView` | Individual page rendering with automatic DPR, `RenderingStates`, cancel support |
| `PDFFindController` | Full-text search with match highlighting, match navigation, regex, case-sensitive, whole-word |
| `PDFLinkService` | Internal link resolution, page navigation by destination, history support |
| `PDFHistory` | Browser-style back/forward for in-document navigation |
| `EventBus` | Lightweight pub/sub for component communication |
| `RenderingStates` | State enum: INITIAL, RUNNING, PAUSED, FINISHED |
| `ScrollMode` | Vertical, horizontal, wrapped, page modes |
| `SpreadMode` | None, odd, even spread modes |
| `AnnotationLayerBuilder` | Renders PDF annotations (links, form fields, comments) |
| `TextLayerBuilder` | Production text layer with search highlight integration |
| `StructTreeLayerBuilder` | Accessibility structure tree |
| `GenericL10n` | Localization service (English defaults) |
| `FindState` | FOUND, NOT_FOUND, WRAPPED, PENDING |

**Not exported but available internally:**

| Component | Notes |
|-----------|-------|
| `PDFRenderingQueue` | Created internally by `PDFViewer` when `renderingQueue` option is omitted (`defaultRenderingQueue = true`). Handles priority: visible → adjacent → idle pre-render. |
| `PDFPageViewBuffer` | Ring buffer limiting live canvases. Auto-configured by `PDFViewer`. |

---

## Research — PDF.js Viewer Layer

### How PDFViewer manages rendering

1. **Canvas buffer (ring buffer):** `PDFPageViewBuffer` keeps a fixed-size set of rendered `PDFPageView` instances. When a new page is rendered, the oldest off-screen page is evicted (canvas torn down, memory freed). Default buffer size scales with viewport: `Math.max(DEFAULT_CACHE_SIZE, 2 * visiblePages.length + 1)`.

2. **Render queue with priority:** `PDFRenderingQueue.renderHighestPriority()` is called on every scroll event. It picks the most important unrendered page (visible > adjacent > pre-render) and renders only that one. Concurrent renders are serialized — no pile-up.

3. **Render cancellation:** When a page leaves the buffer, its in-flight render task is cancelled via `RenderTask.cancel()`. This prevent wasted GPU/CPU work.

4. **DPR handling:** Each `PDFPageView` reads `window.devicePixelRatio` and scales the canvas backing store accordingly. The canvas CSS size stays at layout dimensions; the backing store is `dpr × layout`. Text and lines are crisp on HiDPI.

5. **Detail canvas (zoom optimization):** When `enableDetailCanvas: true` (default), zooming beyond the canvas pixel budget doesn't re-render the full page. Instead, a small "detail canvas" renders only the visible portion at full resolution, overlaid on a CSS-scaled version of the base canvas. This makes zoom feel instant.

6. **Optimized partial rendering:** When `enableOptimizedPartialRendering: true`, PDF.js tracks which PDF operations affect which page regions. The detail canvas only replays operations for its visible rect — massive speedup for complex pages.

7. **CSS-zoom foundation:** At zoom levels that exceed `maxCanvasPixels`, the base canvas is rendered at a capped resolution and CSS-scaled up. The detail canvas provides crispness for the viewport area. No full-page re-render needed.

8. **Text layer integration:** `TextLayerBuilder` is automatically created per page with proper transform alignment. Works with `PDFFindController` for search highlight rendering.

9. **Annotation layer:** `AnnotationLayerBuilder` renders form fields, link annotations, popup notes. Users can fill forms, click internal links.

### How PDFFindController works

1. Controller receives `find` command via `EventBus` with query, options (caseSensitive, entireWord, highlightAll, findPrevious).
2. Extracts text content from all pages (async, progressive).
3. Normalizes text (Unicode, diacritics) and runs search.
4. Dispatches `updatefindmatchescount` (total matches) and `updatefindcontrolstate` (current match index, state).
5. Scroll-to-match via `PDFLinkService.goToPage()` + offset.
6. Highlight rendering delegated to each page's `TextLayerBuilder` which applies CSS classes to matched spans.

### How the viewer CSS works

`pdfjs-dist/web/pdf_viewer.css` provides production styles for:
- `.pdfViewer` container with scroll handling
- `.page` wrappers with proper layering (canvas → text → annotation → struct tree)
- `.textLayer` with transparent text for selection + highlight classes for search matches
- `.annotationLayer` with form field, link, and popup styles
- Print `@media print` rules

### Key configuration for our use case

```typescript
const viewer = new PDFViewer({
  container: viewerContainerDiv,    // outer scrollable div
  viewer: viewerDiv,                // inner div where pages append
  eventBus,                         // lightweight pub/sub
  linkService,                      // handles internal links + page nav
  findController,                   // search
  removePageBorders: false,         // keep page shadows
  textLayerMode: TextLayerMode.ENABLE,
  annotationMode: AnnotationMode.ENABLE_FORMS,
  maxCanvasPixels: 32 * 1024 * 1024,  // 32MP (default)
  enableDetailCanvas: true,            // zoom optimization
  enableHWA: false,                    // Electron Chromium — test carefully
  supportsPinchToZoom: true,
});
```

### Build considerations

- `pdf_viewer.mjs` expects `globalThis.pdfjsLib` to be set **before** import. Our esbuild IIFE bundle can handle this by importing `pdfjs-dist` first and assigning to `globalThis.pdfjsLib` before the viewer code runs.
- `pdf_viewer.css` should be imported alongside our custom CSS. We'll `@import` it or copy it to `dist/renderer/`.
- The viewer layer uses DOM APIs (DOMMatrix, canvas, etc.) — these are available in Electron's renderer process.

---

## Architecture Decision

### Before (Display layer — current)
```
pdfEditorPane.ts (478 lines)
├── pdfjsLib.getDocument()           → load document
├── IntersectionObserver             → DIY lazy rendering
├── page.render({ canvas })          → per-page render (no DPR)
├── pdfjsLib.TextLayer               → DIY text layer
├── manual zoom rebuild              → tear-down + rebuild all
└── no search, no outline, no links
```

### After (Viewer layer — M18)
```
pdfEditorPane.ts (~300 lines)
├── globalThis.pdfjsLib = pdfjsLib   → viewer layer prerequisite
├── new EventBus()                   → component communication
├── new PDFLinkService({ eventBus }) → internal link navigation
├── new PDFFindController(...)       → search engine
├── new PDFViewer({ container,       → REPLACES everything below:
│     eventBus, linkService,         │   ✓ render queue + priority
│     findController,                │   ✓ canvas buffer (eviction)
│     enableDetailCanvas: true,      │   ✓ DPR handling
│     maxCanvasPixels: 32MP })       │   ✓ detail canvas for zoom
│                                    │   ✓ text layer (per page)
│                                    │   ✓ annotation layer
│                                    │   ✓ struct tree (a11y)
│                                    │   ✓ search highlighting
│                                    │   ✓ scroll/spread modes
├── viewer.setDocument(pdfDoc)       → viewer handles all pages
├── Custom toolbar                   → enhanced (search, outline, etc.)
└── Outline sidebar (pdfDoc.getOutline()) → document structure nav
```

**What we delete:**
- IntersectionObserver setup
- Manual `page.render()` calls  
- Manual canvas creation/eviction
- Manual TextLayer instantiation
- Manual zoom rebuild (tear-down + recreate all placeholders)
- Hardcoded 612×792 page dimensions

**What we keep:**
- File loading via Electron bridge (`parallxElectron.fs.readFile`)
- `EditorPane` class hierarchy (`extends EditorPane`)
- `PdfEditorInput` (no changes needed)
- Custom toolbar styling (restyled, not replaced)
- Keyboard shortcut handler (extended)

---

## Capability Inventory

### P0 — Core (Smooth, fast, correct rendering)

| # | Capability | Implementation |
|---|-----------|----------------|
| P0.1 | **Switch to Viewer layer** | Replace DIY rendering with `PDFViewer`, `EventBus`, `PDFLinkService`. Single `viewer.setDocument()` call replaces all manual rendering. |
| P0.2 | **DPR-correct rendering** | Automatic — `PDFPageView` handles `devicePixelRatio`. No manual code needed. |
| P0.3 | **Canvas buffer + eviction** | Automatic — `PDFPageViewBuffer` ring buffer. Old off-screen pages evicted. |
| P0.4 | **Render queue + cancellation** | Automatic — `PDFRenderingQueue` serializes renders, cancels stale ones. |
| P0.5 | **Detail canvas for zoom** | `enableDetailCanvas: true` — zoom uses CSS scaling + focused hi-res overlay. |
| P0.6 | **Correct page dimensions** | Each `PDFPageView` reads its page's actual viewport. Mixed page sizes work. |
| P0.7 | **Search (Ctrl+F)** | `PDFFindController` + custom search bar UI. Match count, prev/next, highlight all. |
| P0.8 | **Annotation layer** | `annotationMode: AnnotationMode.ENABLE_FORMS` — links, form fields, popups render. |
| P0.9 | **Internal link navigation** | `PDFLinkService` resolves PDF destinations → page + position. TOC links work. |

### P1 — Navigation & Tools

| # | Capability | Implementation |
|---|-----------|----------------|
| P1.1 | **Outline / TOC sidebar** | `pdfDoc.getOutline()` → tree view in collapsible sidebar panel. Click → `linkService.goToDestination()`. |
| P1.2 | **Thumbnail sidebar** | Custom thumbnail strip using `page.getViewport({ scale: thumbScale })` + small canvas per visible thumb. Reuse `PDFRenderingQueue` concepts. |
| P1.3 | **Page rotation** | `viewer.pagesRotation = (current + 90) % 360`. Toolbar button + `R` shortcut. |
| P1.4 | **Spread modes** | `viewer.spreadMode = SpreadMode.ODD / EVEN / NONE`. Toolbar toggle for side-by-side reading. |
| P1.5 | **Scroll modes** | `viewer.scrollMode = ScrollMode.VERTICAL / HORIZONTAL / WRAPPED / PAGE`. |

### P2 — Integration & Polish

| # | Capability | Implementation |
|---|-----------|----------------|
| P2.1 | **Print support** | `window.print()` with PDF.js print styles. Toggle `renderingQueue.printing = true` for full render. |
| P2.2 | **Download / open external** | Button to open in system PDF reader via Electron shell. |
| P2.3 | **Page label display** | `pdfDoc.getPageLabels()` for documents with custom page numbering (i, ii, iii, 1, 2, 3...). |
| P2.4 | **Toolbar overflow menu** | Group less-used actions (spread mode, scroll mode, download) into overflow `···` menu. |
| P2.5 | **Accessibility** | `StructTreeLayerBuilder` auto-enabled when struct tree is present in PDF. |

### P3 — Future (Not in scope for M18)

| # | Capability | Notes |
|---|-----------|-------|
| P3.1 | Send page/selection to AI chat | Requires chat API integration — deferred. |
| P3.2 | Annotation editing (highlight, freetext) | `annotationEditorMode` — complex, deferred. |
| P3.3 | Deep linking (open PDF at specific page from search results) | Requires editor input URI scheme extension — deferred. |

---

## Task Tracker

### P0 — Core Rendering (must complete first)

| Task | Description | Status |
|------|-------------|--------|
| **P0.1** | **Viewer layer bootstrap** — Import `PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController` from `pdfjs-dist/web/pdf_viewer.mjs`. Set `globalThis.pdfjsLib` before import. Wire up all four components. Replace `_createPlaceholders()`, `_setupObserver()`, `_renderPage()`, `_rebuildPages()`, `_clearCanvases()` with single `viewer.setDocument(pdfDoc)` call. Update build script to copy `pdf_viewer.css`. Import viewer CSS into `pdfEditorPane.css`. | ✅ |
| **P0.2** | **Toolbar upgrade — zoom** — Replace manual zoom methods with `viewer.currentScale` setter and `viewer.increaseScale()` / `viewer.decreaseScale()`. Fit-width = `viewer.currentScaleValue = 'page-width'`. Fit-page = `viewer.currentScaleValue = 'page-fit'`. Auto = `viewer.currentScaleValue = 'auto'`. Listen to `EventBus 'scalechanging'` to update zoom label. | ✅ |
| **P0.3** | **Toolbar upgrade — navigation** — Replace manual page navigation with `viewer.currentPageNumber` setter. Listen to `EventBus 'pagechanging'` to update page input. `linkService.goToPage(n)` for smooth scroll. | ✅ |
| **P0.4** | **Search bar UI** — Add collapsible search bar below toolbar. Input field + match count + prev/next buttons + close. Ctrl+F toggles. Wire to `PDFFindController`: dispatch `'find'` event on input, listen to `'updatefindmatchescount'` + `'updatefindcontrolstate'` for UI updates. Escape closes search bar. | ✅ |
| **P0.5** | **Layout integration** — Update `layoutPaneContent()` to call `viewer.currentScaleValue = viewer.currentScaleValue` (triggers relayout) instead of manual rebuild. Handle resize debouncing. | ✅ |
| **P0.6** | **CSS integration** — Import `pdf_viewer.css` from pdfjs-dist. Override viewer CSS variables/classes to match Parallx dark theme (`var(--vscode-*)` tokens). Ensure `.pdfViewer .page` shadow, `.textLayer` selection colors, search highlight colors all use theme tokens. | ✅ |
| **P0.7** | **Cleanup & lifecycle** — Update `_cleanup()` to call `viewer.cleanup()`, `viewer.setDocument(null)`, `pdfDoc.destroy()`. Ensure `PDFFindController` and `PDFLinkService` are properly torn down. No memory leaks. | ✅ |

### P1 — Navigation & Tools

| Task | Description | Status |
|------|-------------|--------|
| **P1.1** | **Outline sidebar** — Call `pdfDoc.getOutline()` after document load. If outline exists, show toggle button in toolbar. Render as collapsible tree in a sidebar panel (left of viewport). Each item: title text, click → `linkService.goToDestination(dest)`. Nested items for sub-sections. Sidebar width ~220px. Close with toggle or Escape. | ✅ |
| **P1.2** | **Thumbnail sidebar** — Render small page previews (~120px wide) in a scrollable strip. Highlight current page. Click to navigate. Use viewport-based lazy rendering (only render visible thumbnails). Consider using `page.getViewport({ scale: 120/pageWidth })` + small canvas. | ✅ |
| **P1.3** | **Page rotation** — Add rotation button to toolbar. `viewer.pagesRotation = (viewer.pagesRotation + 90) % 360`. Keyboard shortcut: `R`. | ✅ |
| **P1.4** | **Spread & scroll modes** — Add spread mode toggle (single / two-up). `viewer.spreadMode = SpreadMode.ODD`. Toolbar button cycles through None → Odd → Even. | ✅ |

### P2 — Polish

| Task | Description | Status |
|------|-------------|--------|
| **P2.1** | **Print** — Add print button (Ctrl+P). Triggers `window.print()`. PDF.js print CSS media query handles rendering. | ✅ |
| **P2.2** | **Open externally** — Button to open PDF in system default viewer via `electron.shell.openPath()`. Added `shell:openPath` IPC handler in main.cjs and preload.cjs. | ✅ |
| **P2.3** | **Page labels** — Read `pdfDoc.getPageLabels()`. If custom labels exist, show them in toolbar next to page number. Updates on page change. | ✅ |

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — 1793+ tests pass, zero regressions
- [ ] `node scripts/build.mjs` — clean build, pdf_viewer.css copied to dist
- [ ] Open a multi-page PDF — pages render correctly, scroll is smooth
- [ ] HiDPI test — text is crisp on 2x display (or simulated via DevTools)
- [ ] Zoom in to 300% — detail canvas provides crisp viewport without full re-render
- [ ] Zoom out to 50% — pages render correctly, no blank canvases
- [ ] Ctrl+F → search "deductible" → match count shown, results highlighted, prev/next works
- [ ] Click internal PDF link (TOC entry) → navigates to correct page
- [ ] Outline sidebar opens, shows document structure, click navigates
- [ ] Thumbnail sidebar shows page previews, click navigates
- [ ] Rotation: click R → page rotates 90°, toolbar updates
- [ ] Memory: scroll through entire 116-page PDF, check no canvas accumulation (DevTools Memory)
- [ ] Fit-width and fit-page work after window resize
- [ ] Keyboard: all existing shortcuts still work, Ctrl+F opens search, R rotates

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| `pdf_viewer.mjs` requires `globalThis.pdfjsLib` — import order matters in esbuild IIFE | Bundle with explicit assignment: `import * as pdfjsLib from 'pdfjs-dist'; globalThis.pdfjsLib = pdfjsLib;` at module top, before viewer import. esbuild preserves import order in IIFE. Test build output to verify. |
| Viewer CSS conflicts with Parallx theme | Scope overrides under `.pdf-editor-pane .pdfViewer`. Use CSS specificity, not `!important`. Test in both dark and light themes. |
| `enableHWA` (hardware acceleration) may cause rendering artifacts in Electron 40 | Default to `false`. Test separately. Can be enabled later if stable. |
| Detail canvas may not work perfectly in all zoom ranges | It's the default in Firefox's PDF viewer. If issues arise, set `enableDetailCanvas: false` and fall back to full re-render (still better than current). |
| ES2025 compatibility — v5.4.624 is safe but future pdfjs-dist updates may reintroduce `Map.getOrInsertComputed` | Pin `pdfjs-dist@5.4.624` in `package.json`. Add comment explaining why. |
| Large PDFs (1000+ pages) may cause slow initial `setDocument()` | PDFViewer has `FORCE_LAZY_PAGE_INIT` threshold — pages beyond it are lazily initialized. Verify with a large PDF. |
| `PDFThumbnailViewer` is not exported from `pdf_viewer.mjs` | Build custom lightweight thumbnail strip using Display layer for thumbnails only. The main viewer uses the Viewer layer. |
