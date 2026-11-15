---
name: nightly-check
description: Run every check Parallx has on the dev branch and report only what broke. Use when asked for a full check of the app, or as the prompt of a scheduled nightly task.
---
# The full check of dev

Report only: change nothing in the repository.

1. Work in the repository's checkout (mufarosean/Parallx; attach and clone it if it is not in the container). `git fetch origin dev && git checkout dev && git pull`. Note the commit being checked.
2. If `node_modules` is missing, run `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --no-audit --no-fund` (plain `npm install` fails in the cloud). Then `npm run typecheck`, `npx vitest run` and `npm run build`. All three are expected to pass, with no failures and no unhandled errors.
3. Follow the `run-hidden` skill. Run these probes with `xvfb-run -a node <probe> test-results/<name>` (plain `node` on Windows), each with a 20 minute limit: `tests/probes/sheet-file-probe.mjs`, `tests/probes/sheet-cells-probe.mjs`, `tests/probes/touch-drag-probe.mjs`, `tests/probes/keyboard-audit-probe.mjs`. Then every other `tests/probes/*-probe.mjs` that needs no language model, no graphics card and no Windows (each probe's header says); list the ones skipped and why.
4. Judge against the record, not against zero. `docs/MASTER_LIST.md` and `CLAUDE.md` say what is expected. For `sheet-cells-probe` the differences from Excel are known and listed in the master list's Worksheets entry; only a difference not listed there is a finding. In the keyboard audit, one control of the spreadsheet engine's ribbon left out of the Tab order is known; anything else above 0 is a finding.
5. Do not commit, push, open issues or pull requests, and do not fix anything, even where the fix looks obvious.
6. End with a report of at most 25 lines: the commit checked; each check as passed or failed; for each failure, the first lines of the error and the commit that most likely caused it (`git log` on the files involved); what was not run and why. If everything passed, say so in two lines.

On the owner's own machine the same run can use his models and his card: the probes skipped in the cloud for needing them are run there.
