# D2: Scan Pipeline — Tracker

## Status: CLOSED

## Features
| ID | Feature | Iter 1 | Iter 2 | Iter 3 | Status |
|----|---------|--------|--------|--------|--------|
| F6 | Scan Configuration (S12) | ✅ | ✅ | ✅ | COMPLETE |
| F7 | External Tool Detection (S13) | ✅ | ✅ | ✅ | COMPLETE |
| F8 | Fingerprint Service (S14) | ✅ | ✅ | ✅ | COMPLETE |
| F9 | Metadata Extraction (S15) | ✅ | ✅ | ✅ | COMPLETE |
| F10 | Directory Walker (S16) | ✅ | ✅ | ✅ | COMPLETE |
| F11 | Scan Orchestrator (S17) | ✅ | ✅ | ✅ | COMPLETE |

## Iteration Log

### Iteration 1 — Major Implementation
- **Source analysis**: Full study of Stash scan pipeline (pkg/file/scan.go, internal/manager/task_scan.go)
  - Two-goroutine producer-consumer architecture → adapted to two-phase walk+process
  - Extension-based file classification, oshash/MD5 fingerprinting, ffprobe/exiftool metadata
  - Per-file transactions, progress reporting, cancellation
- **Architecture**: 6 new sections (S12-S17) + S11 modifications, 11 APIs verified
- **Changes**: +709 lines to main.js, manifest updated with 2 command contributions
- **Post-execution fixes**: dialog API, mtime comparison, path separator
- **Verification**: CONDITIONAL PASS — 3 logic issues + 2 contract violations flagged

### Iteration 2 — Gap Closure
- **Source analysis**: Targeted gap review for edge cases, shell safety, rename handling
- **Fixes applied**:
  - P0: shellQuote() helper for all terminal.exec calls (prevents $(), backtick, pipe injection)
  - P0: computeOshash rewired to pass path via process.argv[1] instead of embedded in script
  - P0: Rename detection — fingerprint match + fs.exists check → rename or duplicate
  - P1: Video duration update on rescan
  - P1: Transaction wrapping for new file INSERT (db.transaction + txnResult[0].lastInsertRowid)
  - P2: Domain entity updated_at touched on rescan and rename
  - P2: Deactivation: _activated reset, command disposables captured and disposed
  - P2: Stats counter for 'renamed' action + completion message
  - Fixed corrupted code from overlapping edits (extractVideoMeta, extractImageDimensions, extractEXIF, computeMD5, processFile, runScan)
  - Fixed orphan fingerprint → false duplicate (continue instead of return)
- **Verification**: FAIL → fixed CRITICAL txnResult access + MEDIUM orphan handling → re-verified PASS

### Iteration 3 — Final Refinement
- **Source analysis**: Final review of Stash patterns for polish opportunities
- **Fixes applied**:
  - P1: Folder path→ID in-memory cache (_folderIdCache Map, cleared in finally)
  - P1: Missing fingerprint recovery on unchanged files (tools installed after first scan)
  - P1: Missing metadata recovery on unchanged files (ffprobe/exiftool installed after first scan)
  - P2: Walk entry validation (skip entries with missing name/type)
  - Fix: POSIX shellQuote escape sequence corrected (`'\''` not `'\'`)
- **Verification**: CONDITIONAL PASS → fixed shellQuote → PASS

## Section Summary (main.js)
| Section | Lines | Description |
|---------|-------|-------------|
| S12 | ~30 | IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, SCAN_DEFAULTS |
| S13 | ~40 | detectTool, detectAllTools, shellQuote |
| S14 | ~50 | computeOshash, computeMD5, fingerprintFile |
| S15 | ~80 | extractVideoMeta, extractImageDimensions, extractEXIF, parseFrameRate, parseExifDate, extractMetadata |
| S16 | ~65 | classifyFile, shouldExclude, walkDirectory (with folder cache) |
| S17 | ~140 | processFile (skip/update/rename/dedup/create), processChunk, runScan, cancelScan |
| S11 mod | ~60 | activate (ensureDatabase, status bar, commands), deactivate (full cleanup) |
