// viewMove.test.ts — a view moved between containers keeps its content
//
// The field bug: detaching a panel tab (Terminal) into a floating box showed
// an EMPTY box. Root cause: the hand-rolled IView objects for tool views
// rebuilt a fresh element on every createElement() call, while their
// provider-resolution ran once per lifetime — so the first move orphaned the
// element holding the real content and installed a blank shell, forever.
// The base View class re-mounts its ONE element (view.ts createElement);
// these tests pin that contract onto both hand-rolled factories.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { ViewManager } from '../../src/views/viewManager.js';
import { ViewContainer } from '../../src/views/viewContainer.js';
import { ViewContributionProcessor } from '../../src/contributions/viewContribution.js';
import { ViewsBridge } from '../../src/api/bridges/viewsBridge.js';
import type { IToolDescription } from '../../src/tools/toolManifest.js';

function toolDescription(viewId: string): IToolDescription {
  return {
    manifest: {
      id: 'test.tool',
      name: 'Test Tool',
      version: '1.0.0',
      engines: { parallx: '^1.0.0' },
      activationEvents: ['*'],
      contributes: {
        views: [{ id: viewId, name: 'Console', defaultContainerId: 'panel' }],
      },
    },
    toolPath: '/test',
    isBuiltin: true,
  } as unknown as IToolDescription;
}

/** Simulates the panel → floating wrapper → panel journey of a detached tab. */
function moveAcross(view: any, from: ViewContainer, to: ViewContainer): void {
  from.removeView(view.id);
  to.addView(view);
}

describe('a moved view keeps its content (contributed-view factory)', () => {
  let vm: ViewManager;
  let processor: ViewContributionProcessor;
  let panel: ViewContainer;
  let wrapper: ViewContainer;
  let resolveCount: number;

  beforeEach(() => {
    vm = new ViewManager();
    processor = new ViewContributionProcessor(vm);
    processor.processContributions(toolDescription('view.term'));
    resolveCount = 0;
    processor.registerProvider('view.term', {
      resolveView: (_id, el) => {
        resolveCount++;
        const live = document.createElement('div');
        live.className = 'live-terminal';
        live.textContent = 'LIVE';
        el.appendChild(live);
      },
    });
    panel = new ViewContainer('panel');
    wrapper = new ViewContainer('panelview.view.term');
    wrapper.hideTabBar();
  });

  it('resolves provider content on first mount', () => {
    const view = vm.createViewSync('view.term');
    panel.addView(view);
    expect(view.element?.querySelector('.live-terminal')?.textContent).toBe('LIVE');
    expect(resolveCount).toBe(1);
  });

  it('detach into a wrapper carries the SAME element, content intact', () => {
    const view = vm.createViewSync('view.term');
    panel.addView(view);
    const original = view.element;

    moveAcross(view, panel, wrapper);

    expect(view.element).toBe(original);
    expect(view.element?.querySelector('.live-terminal')?.textContent).toBe('LIVE');
    expect(wrapper.element.contains(view.element!)).toBe(true);
    expect(resolveCount).toBe(1); // resolveView must NOT run again
  });

  it('redock brings the content home too', () => {
    const view = vm.createViewSync('view.term');
    panel.addView(view);
    moveAcross(view, panel, wrapper);
    moveAcross(view, wrapper, panel);

    expect(view.element?.querySelector('.live-terminal')?.textContent).toBe('LIVE');
    expect(panel.element.contains(view.element!)).toBe(true);
    expect(resolveCount).toBe(1);
  });
});

describe('a moved view keeps its content (views-bridge factory)', () => {
  it('moving never re-runs provider.createView nor leaks its disposable', () => {
    const vm = new ViewManager();
    const bridge = new ViewsBridge('test.tool', vm, []);
    let createCount = 0;
    let disposeCount = 0;
    bridge.registerViewProvider('view.bridged', {
      createView: (el: HTMLElement) => {
        createCount++;
        el.textContent = 'BRIDGED';
        return { dispose: () => { disposeCount++; } };
      },
    });

    const view = vm.createViewSync('view.bridged') as any;
    const a = new ViewContainer('a');
    const b = new ViewContainer('b');
    a.addView(view);
    const original = view.element;
    expect(original?.textContent).toBe('BRIDGED');

    moveAcross(view, a, b);
    moveAcross(view, b, a);

    expect(view.element).toBe(original);
    expect(view.element?.textContent).toBe('BRIDGED');
    expect(a.element.contains(view.element)).toBe(true);
    expect(createCount).toBe(1);
    expect(disposeCount).toBe(0);
  });
});
