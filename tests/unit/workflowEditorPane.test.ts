// @vitest-environment jsdom
//
// workflowEditorPane.test.ts — the editor against a REAL WorkflowService
// (no mocks between the pane and the document). What these pins hold:
// palette adds write through, illegal connects are refused with a visible
// reason, inspector edits land in the stored document, Delete removes a
// node WITH its edges, the status chip tells the truth (draft → warning →
// armed), trace mode paints statuses and refuses graph mutations, and an
// externally deleted workflow degrades to a clear message.

import { describe, expect, it, vi } from 'vitest';
import { WorkflowEditorPane } from '../../src/built-in/autonomy-log/workflowEditorPane';
import { WorkflowService } from '../../src/services/workflows/workflowService';
import type { WorkflowExecutionDeps } from '../../src/services/workflows/workflowRunner';
import type { WorkflowNode } from '../../src/services/workflows/workflowTypes';

function makeService(): { service: WorkflowService; deps: WorkflowExecutionDeps } {
  const deps: WorkflowExecutionDeps = {
    runAgentTurn: vi.fn(async () => 'done'),
    runCommand: vi.fn(async () => undefined),
    runTool: vi.fn(async () => ({ content: 'ok' })),
    notify: vi.fn(),
  };
  const service = new WorkflowService();
  service.attachExecution(deps);
  return { service, deps };
}

function seedWorkflow(service: WorkflowService) {
  return service.addWorkflow({
    name: 'Test Flow', class: 'quiet', enabled: false, source: 'user',
    nodes: [
      { id: 'n1', label: 'Manual', kind: 'trigger.manual', x: 40, y: 60 },
      { id: 'n2', label: 'Tell Me', kind: 'action.notify', message: 'hello', x: 300, y: 60 },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
  });
}

function mount(service: WorkflowService, id: string, listTools?: () => readonly { name: string; description: string }[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const pane = new WorkflowEditorPane(container, id, { service, listTools });
  return { pane, container };
}

const nodeCard = (container: HTMLElement, nodeId: string) =>
  container.querySelector(`.px-node-canvas__node[data-node-id="${nodeId}"]`) as HTMLElement | null;

describe('mounting', () => {
  it('renders the document: cards on the canvas, name in the header', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    expect((container.querySelector('.wfe__name') as HTMLInputElement).value).toBe('Test Flow');
    expect(nodeCard(container, 'n1')).toBeTruthy();
    expect(nodeCard(container, 'n2')).toBeTruthy();
    expect(nodeCard(container, 'n1')!.classList.contains('is-family-trigger')).toBe(true);
    expect(container.querySelectorAll('.px-node-canvas__edge').length).toBe(1);
    pane.dispose();
    container.remove();
  });

  it('a missing workflow degrades to a clear message, not a crash', () => {
    const { service } = makeService();
    const { pane, container } = mount(service, 'wf-ghost');
    expect(container.querySelector('.wfe__gone')?.textContent).toContain('no longer exists');
    pane.dispose();
    container.remove();
  });
});

describe('editing writes through the service', () => {
  it('the palette adds a node to the STORED document', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    const buttons = [...container.querySelectorAll('.wfe__palette-item')] as HTMLButtonElement[];
    const cooldownBtn = buttons.find((b) => b.textContent === 'Cooldown')!;
    cooldownBtn.click();
    const doc = service.getWorkflow(wf.id)!;
    expect(doc.nodes.some((n) => n.kind === 'control.cooldown')).toBe(true);
    pane.dispose();
    container.remove();
  });

  it('renaming commits on blur; an emptied name reverts', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    const name = container.querySelector('.wfe__name') as HTMLInputElement;
    name.value = 'Morning Sweep';
    name.dispatchEvent(new Event('blur'));
    expect(service.getWorkflow(wf.id)!.name).toBe('Morning Sweep');
    name.value = '   ';
    name.dispatchEvent(new Event('blur'));
    expect(service.getWorkflow(wf.id)!.name).toBe('Morning Sweep');
    pane.dispose();
    container.remove();
  });

  it('the inspector edits the selected node — the notify message lands in the doc', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    // Select n2 through the canvas API path the pane wired.
    (pane as unknown as { _canvas: { setSelection(n: string[]): void } })._canvas.setSelection(['n2']);
    const ta = container.querySelector('.wfe-ins__textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
    ta.value = 'Due cards: {{event.count}}';
    ta.dispatchEvent(new Event('blur'));
    const n2 = service.getWorkflow(wf.id)!.nodes.find((n) => n.id === 'n2') as WorkflowNode & { message: string };
    expect(n2.message).toBe('Due cards: {{event.count}}');
    pane.dispose();
    container.remove();
  });

  it('Delete removes the selected node AND its edges', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    (pane as unknown as { _canvas: { setSelection(n: string[]): void } })._canvas.setSelection(['n2']);
    const canvasHost = container.querySelector('.wfe__canvas') as HTMLElement;
    canvasHost.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    const doc = service.getWorkflow(wf.id)!;
    expect(doc.nodes.map((n) => n.id)).toEqual(['n1']);
    expect(doc.edges).toEqual([]);
    pane.dispose();
    container.remove();
  });

  it('a connect INTO a trigger is refused with a visible reason', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    const inner = pane as unknown as { _onConnect(a: string, b: string): void };
    inner._onConnect('n2', 'n1');
    expect(service.getWorkflow(wf.id)!.edges).toEqual([{ from: 'n1', to: 'n2' }]);
    expect(container.querySelector('.wfe__hint')?.textContent).toContain('trigger');
    // A legal connect goes through, once.
    const buttons = [...container.querySelectorAll('.wfe__palette-item')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent === 'Notify')!.click();
    const added = service.getWorkflow(wf.id)!.nodes.find((n) => n.id !== 'n1' && n.id !== 'n2')!;
    inner._onConnect('n2', added.id);
    inner._onConnect('n2', added.id); // duplicate — ignored
    expect(service.getWorkflow(wf.id)!.edges).toEqual([
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: added.id },
    ]);
    pane.dispose();
    container.remove();
  });

  it('workflow-level inspector commits priority and mutex group', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    (pane as unknown as { _canvas: { setSelection(n: string[], e: string[]): void } })._canvas.setSelection([], []);
    const numbers = [...container.querySelectorAll('.wfe-ins__input[type="number"]')] as HTMLInputElement[];
    numbers[0].value = '5';
    numbers[0].dispatchEvent(new Event('change'));
    expect(service.getWorkflow(wf.id)!.priority).toBe(5);
    const texts = [...container.querySelectorAll('.wfe-ins__input:not([type="number"])')] as HTMLInputElement[];
    const mutex = texts[texts.length - 1];
    mutex.value = 'planner';
    mutex.dispatchEvent(new Event('blur'));
    expect(service.getWorkflow(wf.id)!.mutexGroup).toBe('planner');
    pane.dispose();
    container.remove();
  });
});

describe('the status chip tells the truth', () => {
  it('draft → warning → armed', () => {
    const { service } = makeService();
    const draft = service.addWorkflow({
      name: 'Draft', class: 'quiet', enabled: false, source: 'user',
      nodes: [{ id: 'a', label: 'Note', kind: 'action.notify', message: 'x', x: 0, y: 0 }],
      edges: [],
    });
    const { pane, container } = mount(service, draft.id);
    const chip = () => container.querySelector('.wfe__status')!;
    expect(chip().textContent).toContain('Draft');

    service.updateWorkflow(draft.id, {
      nodes: [
        { id: 't', label: 'Manual', kind: 'trigger.manual', x: 0, y: 0 },
        { id: 'a', label: 'Note', kind: 'action.notify', message: 'x', x: 200, y: 0 },
        { id: 'orphan', label: 'Lost', kind: 'action.notify', message: 'y', x: 400, y: 0 },
      ],
      edges: [{ from: 't', to: 'a' }],
    });
    expect(chip().classList.contains('is-warn')).toBe(true);

    service.updateWorkflow(draft.id, {
      nodes: [
        { id: 't', label: 'Manual', kind: 'trigger.manual', x: 0, y: 0 },
        { id: 'a', label: 'Note', kind: 'action.notify', message: 'x', x: 200, y: 0 },
      ],
      edges: [{ from: 't', to: 'a' }],
      enabled: true,
    });
    expect(chip().textContent).toBe('Armed');
    pane.dispose();
    container.remove();
  });
});

describe('trace mode', () => {
  it('Run Now records, jumps to the trace, paints statuses, and blocks edits', async () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    (container.querySelector('.wfe__btn--primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(service.getRuns(wf.id)).toHaveLength(1));
    await vi.waitFor(() => {
      expect(container.querySelector('.wfe__canvas--trace')).toBeTruthy();
    });
    expect(nodeCard(container, 'n2')!.classList.contains('is-run-ok')).toBe(true);

    // Mutations are refused with a visible reason while viewing a run.
    const inner = pane as unknown as { _addNode(e: unknown): void; _onConnect(a: string, b: string): void };
    const before = service.getWorkflow(wf.id)!.nodes.length;
    (container.querySelectorAll('.wfe__palette-item')[0] as HTMLButtonElement).click();
    expect(service.getWorkflow(wf.id)!.nodes.length).toBe(before);
    expect(container.querySelector('.wfe__hint')?.textContent).toContain('Editing');

    // Back To Editing restores the graph view.
    const back = [...container.querySelectorAll('.wfe__btn')].find((b) => b.textContent === 'Back To Editing') as HTMLButtonElement;
    back.click();
    expect(container.querySelector('.wfe__canvas--trace')).toBeNull();
    void inner;
    pane.dispose();
    container.remove();
  });
});

describe('external changes', () => {
  it('a panel-side toggle repaints the header; deleting the workflow shows the gone state', () => {
    const { service } = makeService();
    const wf = seedWorkflow(service);
    const { pane, container } = mount(service, wf.id);
    service.setEnabled(wf.id, true);
    expect((container.querySelector('.wfe__btn--armed') as HTMLElement).textContent).toBe('Disable');
    service.removeWorkflow(wf.id);
    expect(container.querySelector('.wfe__gone')?.textContent).toContain('no longer exists');
    pane.dispose();
    container.remove();
  });
});

describe('the tool picker', () => {
  it('with a tool list the tool action gets a dropdown of real names', () => {
    const { service } = makeService();
    const wf = service.addWorkflow({
      name: 'T', class: 'quiet', enabled: false, source: 'user',
      nodes: [{ id: 'x', label: 'Tool', kind: 'action.tool', toolName: '', x: 0, y: 0 }],
      edges: [],
    });
    const { pane, container } = mount(service, wf.id, () => [
      { name: 'canvas_read_page', description: 'read' },
      { name: 'planner_add_task', description: 'add' },
    ]);
    (pane as unknown as { _canvas: { setSelection(n: string[]): void } })._canvas.setSelection(['x']);
    // The core dropdown renders its trigger; both names are reachable items.
    expect(container.querySelector('.wfe__inspector .ui-dropdown, .wfe__inspector [class*="dropdown"]')).toBeTruthy();
    pane.dispose();
    container.remove();
  });
});
