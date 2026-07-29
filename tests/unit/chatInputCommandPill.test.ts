// @vitest-environment jsdom
//
// chatInputCommandPill.test.ts — a command pill is a CLAIM.
//
// Typing "/word " used to be promoted to a legitimate-looking command pill with
// no registry check, so invented commands (the old empty state advertised
// "/edit", "/agent", "/explain" — none of which exist) looked real, and the
// runtime later stripped the word out of the message. The pill now only appears
// for commands the runtime will actually dispatch, and the caret survives the
// promotion.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ChatInputPart } from '../../src/built-in/chat/input/chatInputPart';

// insertTrigger really opens the autocomplete, which scrolls its active row
// into view — jsdom has no scrollIntoView, so stub it (the dropdown opening at
// all is the behaviour under test).
if (!(HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

const REGISTERED = [
  { name: 'init', description: 'Generate AGENTS.md' },
  { name: 'compact', description: 'Summarize the conversation' },
  { name: 'context', description: 'Show the context breakdown' },
];

function mount(withProvider = true) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const part = new ChatInputPart(container);
  if (withProvider) {
    part.setSlashCommandProvider({ getCommands: () => REGISTERED });
  }
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { part, container, textarea };
}

/** Simulate the user typing `text` (the input event drives pill detection). */
function type(textarea: HTMLTextAreaElement, text: string): void {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('command pill promotion', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('promotes a REGISTERED command to a pill and keeps the rest of the text', () => {
    const { part, textarea } = mount();
    type(textarea, '/compact please');
    expect(textarea.value).toBe('please');
    expect(part.getValue()).toBe('/compact please');
  });

  it('leaves an UNREGISTERED command as plain text — no pill, nothing eaten', () => {
    const { part, textarea } = mount();
    type(textarea, '/explain how reserving works');
    // Text is untouched: the word reaches the model instead of being dressed
    // up as a command and stripped downstream.
    expect(textarea.value).toBe('/explain how reserving works');
    expect(part.getValue()).toBe('/explain how reserving works');
  });

  it('leaves the caret AFTER the carried-over text, not at position 0', () => {
    const { textarea } = mount();
    type(textarea, '/init scan');
    expect(textarea.value).toBe('scan');
    // Before the fix this was 0, so the next keystroke landed before "scan"
    // (typing "x" produced "xscan" instead of "scanx").
    expect(textarea.selectionStart).toBe('scan'.length);
    expect(textarea.selectionEnd).toBe('scan'.length);
  });

  it('never promotes when no command provider is wired yet', () => {
    const { textarea } = mount(false);
    type(textarea, '/compact please');
    expect(textarea.value).toBe('/compact please');
  });

  it('ignores a slash that is not at the start of the message', () => {
    const { textarea } = mount();
    type(textarea, 'read src/a.ts /init now');
    expect(textarea.value).toBe('read src/a.ts /init now');
  });
});

// The empty state's "/ commands" and "@ context" cells type the trigger for
// the user so the app's LIVE menu opens — nothing is hard-coded, so nothing
// can be advertised that does not exist.
describe('insertTrigger — opening the live menus', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('puts "/" at index 0 with the caret after it (the menu\'s trigger condition)', () => {
    const { part, textarea } = mount();
    part.insertTrigger('/');
    expect(textarea.value).toBe('/');
    expect(textarea.selectionStart).toBe(1);
  });

  it('PREPENDS to a half-typed draft instead of destroying it', () => {
    const { part, textarea } = mount();
    type(textarea, 'summarize this');
    part.insertTrigger('/');
    expect(textarea.value).toBe('/summarize this');
    expect(textarea.selectionStart).toBe(1); // menu trigger still satisfied
  });

  it('appends "@" and adds the separating space a mention needs', () => {
    const { part, textarea } = mount();
    type(textarea, 'compare with');
    part.insertTrigger('@');
    expect(textarea.value).toBe('compare with @');
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });
});
