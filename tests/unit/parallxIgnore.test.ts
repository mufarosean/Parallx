// parallxIgnore.test.ts — pin gitignore-style pattern compiler + matcher.
//
// Pins:
//   - DEFAULT_PATTERNS coverage (node_modules, .git, .env, secrets/, *.key)
//   - leading `/` anchors to root; bare names match at any depth
//   - trailing `/` = directory-only (files with same name are NOT ignored)
//   - `*` does NOT cross `/`; `**/` matches any depth; `**` at end matches all
//   - `?` matches single non-`/` char
//   - `!` negation flips later matches
//   - comments `#` and blank lines ignored
//   - dot character classes treat `.` literally
//   - case-sensitive matching (gitignore-compatible)
//   - getPatterns() returns trimmed raw lines, in order, comments excluded
//   - clear() wipes all state

import { describe, it, expect } from 'vitest';
import { ParallxIgnore, createParallxIgnore } from '../../src/services/parallxIgnore';

describe('ParallxIgnore — defaults', () => {
  const ig = createParallxIgnore();

  it('ignores node_modules directory (directory-only contract)', () => {
    expect(ig.isIgnored('node_modules', true)).toBe(true);
    // Files are checked via isDirectoryIgnored on parent dirs during walking;
    // directory-only patterns skip file-mode checks (early-continue in isIgnored).
    expect(ig.isIgnored('node_modules/foo.js', false)).toBe(false);
    expect(ig.isDirectoryIgnored('node_modules')).toBe(true);
  });

  it('ignores .git directory', () => {
    expect(ig.isIgnored('.git', true)).toBe(true);
    expect(ig.isDirectoryIgnored('.git')).toBe(true);
  });

  it('ignores .env and dotted variants', () => {
    expect(ig.isIgnored('.env', false)).toBe(true);
    expect(ig.isIgnored('.env.local', false)).toBe(true);
    expect(ig.isIgnored('.env.production', false)).toBe(true);
  });

  it('ignores *.key, *.pem, *.p12 at any depth', () => {
    expect(ig.isIgnored('private.key', false)).toBe(true);
    expect(ig.isIgnored('certs/server.pem', false)).toBe(true);
    expect(ig.isIgnored('a/b/c.p12', false)).toBe(true);
  });

  it('ignores secrets/ directory', () => {
    expect(ig.isIgnored('secrets', true)).toBe(true);
    expect(ig.isDirectoryIgnored('secrets')).toBe(true);
  });

  it('does NOT ignore ordinary source files', () => {
    expect(ig.isIgnored('src/main.ts', false)).toBe(false);
    expect(ig.isIgnored('README.md', false)).toBe(false);
    expect(ig.isIgnored('package.json', false)).toBe(false);
  });
});

describe('ParallxIgnore — directory-only patterns', () => {
  it('trailing slash matches directories only (not same-name files); file-mode checks short-circuit', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('build/\n');
    expect(ig.isIgnored('build', true)).toBe(true);
    expect(ig.isIgnored('build', false)).toBe(false);
    // Directory-only patterns early-continue on file-mode checks, even for paths
    // nested under the directory. Callers must walk and use isDirectoryIgnored.
    expect(ig.isIgnored('build/output.txt', false)).toBe(false);
  });

  it('pattern without trailing slash matches BOTH files and directories', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('logs\n');
    expect(ig.isIgnored('logs', true)).toBe(true);
    expect(ig.isIgnored('logs', false)).toBe(true);
  });
});

describe('ParallxIgnore — anchoring', () => {
  it('leading `/` anchors to root', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('/config.json\n');
    expect(ig.isIgnored('config.json', false)).toBe(true);
    expect(ig.isIgnored('sub/config.json', false)).toBe(false);
  });

  it('bare name (no slash) matches at any depth', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('tmp\n');
    expect(ig.isIgnored('tmp', false)).toBe(true);
    expect(ig.isIgnored('a/tmp', false)).toBe(true);
    expect(ig.isIgnored('a/b/c/tmp', false)).toBe(true);
  });

  it('mid-path slash anchors from root', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('src/generated\n');
    expect(ig.isIgnored('src/generated', true)).toBe(true);
    expect(ig.isIgnored('src/generated/a.ts', false)).toBe(true);
    expect(ig.isIgnored('packages/lib/src/generated', true)).toBe(false);
  });
});

describe('ParallxIgnore — wildcards', () => {
  it('`*` does not cross path separators', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('*.log\n');
    expect(ig.isIgnored('a.log', false)).toBe(true);
    expect(ig.isIgnored('logs/a.log', false)).toBe(true);
    // *.log is bare → unanchored → matches at any depth; this is consistent
    // with gitignore. The point of this assertion is that `*` itself doesn't
    // span `/`: a non-log basename in a subdir is NOT matched.
    expect(ig.isIgnored('logs/foo.txt', false)).toBe(false);
  });

  it('`**/` matches any directory depth', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('**/cache\n');
    expect(ig.isIgnored('cache', true)).toBe(true);
    expect(ig.isIgnored('a/cache', true)).toBe(true);
    expect(ig.isIgnored('a/b/c/cache', true)).toBe(true);
  });

  it('`**` at end matches everything under a prefix', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('vendor/**\n');
    expect(ig.isIgnored('vendor/a.txt', false)).toBe(true);
    expect(ig.isIgnored('vendor/sub/deep/x.js', false)).toBe(true);
  });

  it('`?` matches exactly one non-slash char', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('file?.txt\n');
    expect(ig.isIgnored('file1.txt', false)).toBe(true);
    expect(ig.isIgnored('fileA.txt', false)).toBe(true);
    expect(ig.isIgnored('file.txt', false)).toBe(false);
    expect(ig.isIgnored('file12.txt', false)).toBe(false);
  });
});

describe('ParallxIgnore — negation', () => {
  it('`!` un-ignores a later-matched path', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('*.log\n!keep.log\n');
    expect(ig.isIgnored('a.log', false)).toBe(true);
    expect(ig.isIgnored('keep.log', false)).toBe(false);
  });

  it('negation only matters if pattern came AFTER the ignore rule', () => {
    const ig = new ParallxIgnore();
    // reverse order: negation first, then broad ignore overrides
    ig.loadFromContent('!keep.log\n*.log\n');
    expect(ig.isIgnored('keep.log', false)).toBe(true);
  });
});

describe('ParallxIgnore — parser', () => {
  it('skips comments and blank lines', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('# comment\n\n  \nfoo\n');
    expect(ig.getPatterns()).toEqual(['foo']);
  });

  it('trims whitespace around patterns', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('   bar   \n');
    expect(ig.getPatterns()).toEqual(['bar']);
    expect(ig.isIgnored('bar', false)).toBe(true);
  });

  it('treats `.` as a literal char (no regex escape leak)', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('config.json\n');
    expect(ig.isIgnored('config.json', false)).toBe(true);
    expect(ig.isIgnored('configXjson', false)).toBe(false);
  });
});

describe('ParallxIgnore — path normalization', () => {
  it('normalizes backslashes to forward slashes', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('logs\n');
    expect(ig.isIgnored('a\\b\\logs', false)).toBe(true);
    expect(ig.isIgnored('a\\logs\\x.txt', false)).toBe(true);
  });

  it('strips leading `/`', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('/root.txt\n');
    expect(ig.isIgnored('/root.txt', false)).toBe(true);
  });

  it('isDirectoryIgnored is a convenience alias', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('build/\n');
    expect(ig.isDirectoryIgnored('build')).toBe(true);
    expect(ig.isDirectoryIgnored('src')).toBe(false);
  });
});

describe('ParallxIgnore — lifecycle', () => {
  it('clear() removes all patterns including defaults', () => {
    const ig = createParallxIgnore();
    expect(ig.isIgnored('node_modules', true)).toBe(true);
    ig.clear();
    expect(ig.isIgnored('node_modules', true)).toBe(false);
    expect(ig.getPatterns()).toEqual([]);
  });

  it('createParallxIgnore appends file content AFTER defaults', () => {
    const ig = createParallxIgnore('!node_modules\n');
    // The negation comes after the default ignore → un-ignores node_modules.
    expect(ig.isIgnored('node_modules', true)).toBe(false);
  });

  it('getPatterns preserves insertion order', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('a\nb\nc\n');
    expect(ig.getPatterns()).toEqual(['a', 'b', 'c']);
  });
});

describe('ParallxIgnore — case sensitivity', () => {
  it('matching is case-sensitive (gitignore default)', () => {
    const ig = new ParallxIgnore();
    ig.loadFromContent('Build/\n');
    expect(ig.isIgnored('Build', true)).toBe(true);
    expect(ig.isIgnored('build', true)).toBe(false);
    expect(ig.isIgnored('BUILD', true)).toBe(false);
  });
});
