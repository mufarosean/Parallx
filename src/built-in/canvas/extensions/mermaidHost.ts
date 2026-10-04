// mermaidHost.ts — entry of the Mermaid bundle (dist/renderer/canvas-mermaid.js)
//
// Mermaid is several MB, used only by Mermaid diagram blocks, so it builds as
// its own esm bundle (scripts/build.mjs) that mermaidNode.ts imports on first
// use, like the worksheet engine. Never import this file from the main tree.

import mermaid from 'mermaid';

let seq = 0;

/** Render diagram code to SVG, or say what is wrong with it. */
export async function renderMermaid(code: string, theme: 'dark' | 'default'): Promise<{ svg: string } | { error: string }> {
  mermaid.initialize({
    startOnLoad: false,
    // Strict: no click handlers or HTML labels from the diagram text.
    securityLevel: 'strict',
    theme,
    fontFamily: 'inherit',
  });
  try {
    await mermaid.parse(code);
    const { svg } = await mermaid.render(`canvas-mermaid-${++seq}`, code);
    return { svg };
  } catch (err) {
    // Mermaid leaves its error drawing behind on a failed render.
    document.getElementById(`dcanvas-mermaid-${seq}`)?.remove();
    const message = err instanceof Error ? err.message : String(err);
    return { error: message.split('\n').slice(0, 4).join('\n') };
  }
}
