# scripts

`build.mjs` bundles the renderer (esbuild); `vendorBundles.mjs` lists the
libraries that build as their own bundles and load on first use;
`build-icon-registry.mjs` generates `src/ui/iconRegistry.generated.ts`
from lucide; `bundle-study.mjs` builds `ext/study/main.js` from its sources;
`package-extension.mjs <folder>` packages an extension as a `.plx`;
`patch-deps.mjs` runs after install; the `verify-*.mjs` scripts drive the
Python and notebook bridges by hand. `Parallx.bat` and `Parallx.vbs`
start the app on Windows.
