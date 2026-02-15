// Hello World — sample external tool for Parallx
//
// This file demonstrates the minimum required structure for a Parallx tool.
// Copy this entire folder to ~/.parallx/tools/hello-world/ to install it.
//
// A tool module must export an `activate` function. It receives:
//   - `parallx` — the scoped API object (parallx.commands, parallx.window, etc.)
//   - `context`  — tool context with subscriptions, state, and toolPath
//
// Optionally export a `deactivate` function for cleanup.

/**
 * Called when the tool is activated.
 *
 * @param {object} parallx - The Parallx API object (mirrors vscode.* shape)
 * @param {object} context - Tool context: { subscriptions, globalState, workspaceState, toolPath }
 */
export function activate(parallx, context) {
  console.log('[Hello World] Tool activated!');

  // ── Register a command ──
  const sayHello = parallx.commands.registerCommand('helloWorld.sayHello', () => {
    parallx.window.showInformationMessage('Hello from an external Parallx tool! 🎉');
  });
  context.subscriptions.push(sayHello);

  // ── Register another command ──
  const showTime = parallx.commands.registerCommand('helloWorld.showTime', () => {
    const now = new Date().toLocaleTimeString();
    parallx.window.showInformationMessage(`Current time: ${now}`);
  });
  context.subscriptions.push(showTime);

  // ── Create a view ──
  const viewProvider = parallx.views.registerViewProvider(
    'helloWorld.mainView',
    {
      createView(container) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '16px';
        wrapper.style.color = 'var(--foreground)';
        wrapper.style.fontFamily = 'var(--font-family)';

        const heading = document.createElement('h3');
        heading.textContent = '👋 Hello World';
        heading.style.margin = '0 0 12px 0';
        wrapper.appendChild(heading);

        const desc = document.createElement('p');
        desc.textContent = 'This is a sample external tool loaded from ~/.parallx/tools/hello-world/';
        desc.style.fontSize = '13px';
        desc.style.lineHeight = '1.5';
        desc.style.opacity = '0.8';
        wrapper.appendChild(desc);

        const btn = document.createElement('button');
        btn.textContent = 'Say Hello';
        btn.style.cssText = 'margin-top: 12px; padding: 6px 14px; background: var(--button-background, #0e639c); color: var(--button-foreground, #fff); border: none; border-radius: 2px; cursor: pointer; font-size: 13px;';
        btn.addEventListener('click', () => {
          parallx.commands.executeCommand('helloWorld.sayHello');
        });
        wrapper.appendChild(btn);

        container.appendChild(wrapper);
        return { dispose() { wrapper.remove(); } };
      },
    },
  );
  context.subscriptions.push(viewProvider);

  console.log('[Hello World] Commands and view registered');
}

/**
 * Called when the tool is deactivated (optional).
 * Subscriptions are auto-disposed, but you can do extra cleanup here.
 */
export function deactivate() {
  console.log('[Hello World] Tool deactivated');
}
