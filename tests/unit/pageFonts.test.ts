// pageFonts.test.ts — a page's Default font is the app's face, Newsreader is
// in the page font list, and an export carries the bundled faces it names.
import { describe, expect, it } from 'vitest';
import { BUILTIN_FONTS, pageFontCss, resolveFontStack, getFont } from '../../src/built-in/canvas/config/fontRegistry';
import { bundledFontFaceCss, buildPrintHtml } from '../../src/built-in/canvas/export/printHtml';

describe('page fonts', () => {
  it('Default is the app\'s interface face, by its variable on screen', () => {
    expect(pageFontCss('default')).toMatch(/^var\(--px-font-ui, 'Hanken Grotesk'/);
    expect(pageFontCss(undefined)).toBe(pageFontCss('default'));
    expect(getFont('default').stack.startsWith(`'Hanken Grotesk'`)).toBe(true);
  });

  it('a page whose font is gone falls back to Default', () => {
    expect(pageFontCss('custom:not-there')).toBe(pageFontCss('default'));
  });

  it('Newsreader is in the list, second, and is its own face', () => {
    expect(BUILTIN_FONTS.map((f) => f.id).slice(0, 2)).toEqual(['default', 'newsreader']);
    expect(pageFontCss('newsreader')).toBe(`'Newsreader', 'Iowan Old Style', Georgia, ui-serif, serif`);
    expect(resolveFontStack('newsreader')).toBe(pageFontCss('newsreader'));
  });

  it('every other built-in keeps its id and its stack has no variable', () => {
    for (const id of ['serif', 'mono', 'system', 'verdana', 'trebuchet', 'cambria', 'times', 'garamond', 'courier', 'casual']) {
      expect(getFont(id).id).toBe(id);
      expect(pageFontCss(id)).not.toContain('var(');
    }
  });

  it('an export embeds the bundled faces its stack names, from the app\'s files', () => {
    const css = bundledFontFaceCss(resolveFontStack('newsreader'), 'D:\\apps\\Parallx');
    expect(css.match(/@font-face/g)?.length).toBe(4);
    expect(css).toContain(`url("file:///D:/apps/Parallx/dist/renderer/fonts/newsreader-latin-opsz-normal.woff2")`);
    expect(css).toContain('newsreader-latin-ext-opsz-italic.woff2');
    expect(css).toContain('unicode-range: U+0000-00FF');
    const both = bundledFontFaceCss(getFont('default').stack, '/opt/parallx');
    expect(both).toContain('hanken-grotesk-latin-wght-normal.woff2');
    expect(both).toContain('inter-latin-wght-normal.woff2');
  });

  it('a system face, or no app path, embeds nothing', () => {
    expect(bundledFontFaceCss(resolveFontStack('times'), '/opt/parallx')).toBe('');
    expect(bundledFontFaceCss(resolveFontStack('newsreader'), undefined)).toBe('');
  });

  it('the printed document carries the rules', () => {
    const html = buildPrintHtml({ title: 'T', contentHtml: '<p>x</p>', fontStack: resolveFontStack('newsreader'), includeTitle: true, appPath: '/opt/parallx' });
    expect(html).toContain(`font-family: 'Newsreader'; font-style: normal`);
    expect(html).toContain(`body { font-family: 'Newsreader'`);
  });
});
