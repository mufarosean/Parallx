// @vitest-environment jsdom
//
// chatStagedPrompt.test.ts — a staged prompt is an INVITATION, not a send.
//
// `chat.submitPrompt` fires whatever question the calling surface guessed the
// user wanted. For surfaces where the question is really the user's — the
// flashcards "Discuss with AI" button being the one that prompted this — the
// prompt has to land in the input, focused and editable, and go nowhere until
// the user says so. stageValue() is that primitive: same fill as setValue(),
// plus the focus and caret placement that make "keep typing" work.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ChatInputPart } from '../../src/built-in/chat/input/chatInputPart';

if (!(HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const part = new ChatInputPart(container);
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  return { part, container, textarea };
}

describe('ChatInputPart.stageValue', () => {
  let mounted: ReturnType<typeof mount>;

  beforeEach(() => { mounted = mount(); });
  afterEach(() => { mounted.container.remove(); });

  it('fills the input with the staged prompt', () => {
    const { part, textarea } = mounted;
    part.stageValue('Ground this card in my own material.');
    expect(textarea.value).toBe('Ground this card in my own material.');
  });

  it('focuses the input, so the user can keep typing without reaching for it', () => {
    const { part, textarea } = mounted;
    part.stageValue('Ground this card.');
    expect(document.activeElement).toBe(textarea);
  });

  it('leaves the caret at the END — the user appends their real question', () => {
    const { part, textarea } = mounted;
    const text = 'Ground this card in my own material.\n\n';
    part.stageValue(text);
    expect(textarea.selectionStart).toBe(text.length);
    expect(textarea.selectionEnd).toBe(text.length);
  });

  it('does not select the text, which the next keystroke would erase', () => {
    const { part, textarea } = mounted;
    part.stageValue('Ground this card.');
    expect(textarea.selectionStart).toBe(textarea.selectionEnd);
  });

  it('replaces a previous staged prompt rather than appending to it', () => {
    const { part, textarea } = mounted;
    part.stageValue('First card.');
    part.stageValue('Second card.');
    expect(textarea.value).toBe('Second card.');
    expect(textarea.selectionStart).toBe('Second card.'.length);
  });

  it('stages multi-line prompts intact', () => {
    const { part, textarea } = mounted;
    const prompt = ['Ground this card:', '', 'Cite the file and page.'].join('\n');
    part.stageValue(prompt);
    expect(textarea.value).toBe(prompt);
  });

  it('never sends: staging alone leaves the value in place', () => {
    // acceptInput() is what clears the textarea. If stageValue ever grew a
    // submit, this value would be gone.
    const { part, textarea } = mounted;
    part.stageValue('Ground this card.');
    expect(textarea.value).not.toBe('');
  });

  it('setValue stays send-oriented — it does not steal focus', () => {
    // submitPrompt uses setValue then acceptInput; focusing there would yank
    // the caret out of whatever the user was doing for no reason.
    const { part, textarea } = mounted;
    textarea.blur();
    part.setValue('Fired programmatically.');
    expect(document.activeElement).not.toBe(textarea);
  });
});
