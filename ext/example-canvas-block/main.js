// example-canvas-block — reference extension for M82 Slice A.
//
// Demonstrates the full round-trip:
//   1. Declares one block type in `parallx-manifest.json` under
//      `contributes.canvas.blockTypes[]`.
//   2. Provides the full Tiptap `BlockDefinition` (including the
//      `extension(context)` factory) in `activate()` via
//      `api.canvas.registerBlockType(definition)`.

/**
 * @param {{ subscriptions: { push(d: { dispose(): void }): void } }} context
 * @param {any} api
 */
function activate(context, api) {
  if (!api?.canvas?.registerBlockType) {
    console.warn('[example-canvas-block] api.canvas.registerBlockType unavailable — canvas surface not loaded?');
    return;
  }

  // Build a minimal Tiptap Node extension. The body is intentionally tiny —
  // M82 only verifies the wiring; richer behaviour is a future surface concern.
  const definition = {
    id: 'example.embeddedIframe',
    name: 'exampleEmbeddedIframe',
    label: 'Embedded iframe',
    icon: 'browser',
    source: 'custom',
    kind: 'atom',
    capabilities: { draggable: true, selectable: true },
    extension: (_context) => {
      // We lazily require @tiptap/core at activate-time. In a real extension
      // the bundler would pin the version against the host; here we accept
      // the host's runtime resolution.
      const TiptapCore = require('@tiptap/core');
      return TiptapCore.Node.create({
        name: 'exampleEmbeddedIframe',
        group: 'block',
        atom: true,
        addAttributes() {
          return {
            src: {
              default: 'about:blank',
              parseHTML: (el) => el.getAttribute('data-src'),
              renderHTML: (attrs) => ({ 'data-src': attrs.src }),
            },
          };
        },
        parseHTML() {
          return [{ tag: 'div[data-block-type="example-embedded-iframe"]' }];
        },
        renderHTML({ HTMLAttributes }) {
          return [
            'div',
            {
              ...HTMLAttributes,
              'data-block-type': 'example-embedded-iframe',
              class: 'example-embedded-iframe',
            },
            ['iframe', { src: HTMLAttributes['data-src'], sandbox: 'allow-scripts' }],
          ];
        },
      });
    },
  };

  const disposable = api.canvas.registerBlockType(definition);
  context.subscriptions.push(disposable);
}

function deactivate() {
  // Subscriptions registered above are disposed automatically by the host.
}

module.exports = { activate, deactivate };
