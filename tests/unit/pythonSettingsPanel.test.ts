// @vitest-environment jsdom
//
// pythonSettingsPanel.test.ts — the panel must actually PAINT (M94/M97)
//
// The reported symptom was a Settings page showing only its heading and
// description with an empty body. Those two come from the panel's metadata,
// which the hub renders itself — so a panel whose `render()` throws is
// visually indistinguishable from a feature that was never implemented.
//
// The service-level regression test proves the throw is gone. This proves the
// consequence: a toggle, the honest caveat, and an environment section exist
// in the DOM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SettingsRegistryService,
  setGlobalSettingsRegistry,
} from '../../src/services/settingsRegistryService.js';
import { PythonEnvService, PYTHON_ENABLED_KEY } from '../../src/services/pythonEnvService.js';
import { createPythonSettingsPanel } from '../../src/built-in/settings/pythonSettingsPanel.js';

let service: PythonEnvService | undefined;
let container: HTMLElement;

beforeEach(() => {
  setGlobalSettingsRegistry(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  service?.dispose();
  service = undefined;
  setGlobalSettingsRegistry(undefined);
  container.remove();
});

/** Reproduce the real boot order: service first, registry afterwards. */
function bootInRealOrder(): { registry: SettingsRegistryService; service: PythonEnvService } {
  const svc = new PythonEnvService();
  const registry = new SettingsRegistryService();
  setGlobalSettingsRegistry(registry);
  return { registry, service: svc };
}

describe('Python settings panel', () => {
  it('renders a body, not just a heading', () => {
    const booted = bootInRealOrder();
    service = booted.service;

    const panel = createPythonSettingsPanel(service);
    const disposable = panel.render(container);

    // The exact symptom from the bug report: nothing under the heading.
    expect(container.children.length).toBeGreaterThan(0);
    expect(container.querySelector('.pysettings')).not.toBeNull();
    // …and specifically NOT the error fallback.
    expect(container.querySelector('.pysettings__notice--error')).toBeNull();

    (disposable as { dispose(): void })?.dispose?.();
  });

  it('renders the enable toggle as a real switch, off by default', () => {
    const booted = bootInRealOrder();
    service = booted.service;
    createPythonSettingsPanel(service).render(container);

    const toggle = container.querySelector('.ui-toggle');
    expect(toggle, 'the enable toggle must exist — this is the control the docs point at').not.toBeNull();
    expect(toggle!.getAttribute('role')).toBe('switch');
    expect(toggle!.getAttribute('aria-checked')).toBe('false');
  });

  it('registers the python.* schemas as a side effect of building the panel', () => {
    const booted = bootInRealOrder();
    service = booted.service;
    createPythonSettingsPanel(service);
    // Without this the flat Settings list has no Python rows at all.
    expect(booted.registry.getSchema(PYTHON_ENABLED_KEY)).toBeDefined();
  });

  it('carries the "what this does not do" caveat next to the switch', () => {
    // The security copy is load-bearing: enabling this means arbitrary code
    // execution with the user's permissions, and the UI must say so.
    const booted = bootInRealOrder();
    service = booted.service;
    createPythonSettingsPanel(service).render(container);

    const caveat = container.querySelector('.pysettings__caveat');
    expect(caveat).not.toBeNull();
    expect(caveat!.textContent).toMatch(/does not/i);
    expect(caveat!.textContent).toMatch(/sandbox/i);
  });

  it('flipping the toggle writes the workspace setting', async () => {
    const booted = bootInRealOrder();
    service = booted.service;
    createPythonSettingsPanel(service).render(container);

    const toggle = container.querySelector('.ui-toggle') as HTMLButtonElement;
    expect(service.isEnabled).toBe(false);

    toggle.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(service.isEnabled).toBe(true);
    expect(booted.registry.getValue(PYTHON_ENABLED_KEY)).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders even when NO settings registry ever appears', () => {
    // Degraded, but visible. A blank pane is the one outcome that is never
    // acceptable, because it looks like nothing was built.
    service = new PythonEnvService();
    const disposable = createPythonSettingsPanel(service).render(container);

    expect(container.querySelector('.pysettings')).not.toBeNull();
    expect(container.querySelector('.ui-toggle')).not.toBeNull();

    (disposable as { dispose(): void })?.dispose?.();
  });

  it('shows an explanation instead of an empty pane if the panel throws', () => {
    // Defence in depth for the NEXT bug of this shape.
    const exploding = {
      get isEnabled(): boolean { throw new Error('boom'); },
      isAvailable: false,
      ensureSettingsRegistered() { /* no-op */ },
    } as unknown as PythonEnvService;

    const disposable = createPythonSettingsPanel(exploding).render(container);

    const notice = container.querySelector('.pysettings__notice--error');
    expect(notice, 'a throwing panel must explain itself, not render nothing').not.toBeNull();
    expect(notice!.textContent).toContain('boom');

    (disposable as { dispose(): void })?.dispose?.();
  });

  it('cleans up its DOM on dispose', () => {
    const booted = bootInRealOrder();
    service = booted.service;
    const disposable = createPythonSettingsPanel(service).render(container);
    (disposable as { dispose(): void }).dispose();
    expect(container.querySelector('.pysettings')).toBeNull();
  });
});
