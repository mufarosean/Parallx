// ext/web-research/readability.js — placeholder for vendored
// Mozilla Readability v0.5.x.
//
// MANUAL STEP REQUIRED before Iter 1 functional testing:
//   1. Download https://raw.githubusercontent.com/mozilla/readability/main/Readability.js
//      (use a fixed-tag commit for reproducibility; current stable is v0.5.0).
//   2. Replace this file's body with the contents.
//   3. Ensure the file exports `Readability` as either:
//        - `globalThis.Readability = Readability;` at top level, OR
//        - an ES module `export { Readability };` (preferred for our blob-URL loader).
//   4. Do NOT modify the Readability source. We rely on its canonical behavior;
//      our sanitizer (post-Readability) is the place to add custom strips.
//
// Until vendored, this stub exports a deterministic placeholder that throws so
// the extension fails closed (per Security Analyst veto on best-effort
// sanitization that proceeds when Readability throws — C8 explicitly hard-fails).

export class Readability {
  constructor(_doc, _options) {
    throw new Error('[web-research] Readability not vendored yet. See ext/web-research/readability.js for the manual vendoring step.');
  }
  parse() {
    throw new Error('[web-research] Readability not vendored yet.');
  }
}
