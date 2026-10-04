// canvasEmbedMermaidBlocks.test.ts — Embed and Mermaid diagram blocks.

import { describe, it, expect } from 'vitest';
import { toEmbedUrl, clampEmbedHeight } from '../../src/built-in/canvas/extensions/embedNode';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

describe('Embed links', () => {
  it('only https is framed', () => {
    expect(toEmbedUrl('http://example.com')).toBeNull();
    expect(toEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(toEmbedUrl('file:///etc/passwd')).toBeNull();
    expect(toEmbedUrl('not a url')).toBeNull();
    expect(toEmbedUrl('https://example.com/page?x=1')).toBe('https://example.com/page?x=1');
  });
  it('share links become the address the site serves for embedding', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(toEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(toEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(toEmbedUrl('https://www.loom.com/share/abc123')).toBe('https://www.loom.com/embed/abc123');
    expect(toEmbedUrl('https://docs.google.com/document/d/1AbC_d-9/edit#heading=h.1')).toBe('https://docs.google.com/document/d/1AbC_d-9/preview');
    expect(toEmbedUrl('https://codepen.io/someone/pen/XyZ12')).toBe('https://codepen.io/someone/embed/XyZ12?default-tab=result');
    expect(toEmbedUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(toEmbedUrl('https://www.figma.com/file/KEY/Name')).toBe(`https://www.figma.com/embed?embed_host=parallx&url=${encodeURIComponent('https://www.figma.com/file/KEY/Name')}`);
  });
  it('the height stays within bounds', () => {
    expect(clampEmbedHeight(50)).toBe(120);
    expect(clampEmbedHeight(5000)).toBe(1200);
    expect(clampEmbedHeight('abc')).toBe(420);
    expect(clampEmbedHeight(333.4)).toBe(333);
  });
});

describe('Markdown', () => {
  const doc = { type: 'doc', content: [
    { type: 'embed', attrs: { src: 'https://example.com/x', height: 300 } },
    { type: 'mermaidDiagram', attrs: { code: 'flowchart LR\n  A --> B' } },
  ] };
  it('both blocks come back with their settings', () => {
    const back = markdownToTiptapJson(tiptapJsonToMarkdown(doc)) as any;
    const embed = back.content.find((n: any) => n.type === 'embed');
    const mermaid = back.content.find((n: any) => n.type === 'mermaidDiagram');
    expect(embed?.attrs).toMatchObject({ src: 'https://example.com/x', height: 300 });
    expect(mermaid?.attrs?.code).toBe('flowchart LR\n  A --> B');
  });
  it('reading text shows the link and the diagram code as a mermaid fence', () => {
    const text = tiptapJsonToMarkdown(doc, undefined, { forReading: true });
    expect(text).toContain('https://example.com/x');
    expect(text).toContain('```mermaid\nflowchart LR\n  A --> B\n```');
  });
});

import { mermaidTheme } from '../../src/built-in/canvas/extensions/mermaidNode';
describe('Mermaid look follows the page colour', () => {
  it('dark backgrounds get the dark look, light ones the default', () => {
    expect(mermaidTheme('rgb(24, 25, 28)')).toBe('dark');
    expect(mermaidTheme('rgb(244, 245, 247)')).toBe('default');
    expect(mermaidTheme('rgba(255, 255, 255, 1)')).toBe('default');
    expect(mermaidTheme('rgba(0, 0, 0, 0)')).toBe('dark');
  });
});
