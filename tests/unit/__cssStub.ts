// tests/unit/__cssStub.ts — empty module substituted for *.css imports
// during unit tests (see vitest.config.ts alias). Real CSS is only relevant
// in the renderer at runtime; unit tests just need the import to resolve.
export default {};
