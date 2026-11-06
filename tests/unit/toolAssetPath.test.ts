import { describe, it, expect } from 'vitest';
import { resolveToolAssetPath } from '../../src/tools/toolAssetPath';

describe('resolveToolAssetPath', () => {
  it('joins a relative path inside the tool folder with its separators', () => {
    expect(resolveToolAssetPath('D:\\AI\\Parallx\\ext\\character-studio', 'figure/figure.bin')).toBe('D:\\AI\\Parallx\\ext\\character-studio\\figure\\figure.bin');
    expect(resolveToolAssetPath('/opt/parallx/ext/x/', './data\\a.bin')).toBe('/opt/parallx/ext/x/data/a.bin');
  });

  it('refuses paths that leave the folder or are not relative', () => {
    for (const bad of ['', '   ', '../other/main.js', 'figure/../../x', '/etc/passwd', '\\\\server\\share', 'C:\\Windows\\a', 'C:a', 'https://example.com/a', 'file:///c:/a', 'a\0b']) {
      expect(resolveToolAssetPath('D:\\tools\\x', bad), bad).toBeNull();
    }
    expect(resolveToolAssetPath('', 'a.bin')).toBeNull();
  });
});
