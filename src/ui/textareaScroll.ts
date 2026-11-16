// textareaScroll.ts — scroll a <textarea> to a character, wrapped lines included.
//
// A textarea does not scroll its selection into view when code sets it
// (Chromium leaves scrollTop where it was, focused or not), and a wrapped
// line has no fixed height, so line number × line height lands short of a
// passage that sits under long paragraphs. The line's top is measured
// instead: a copy of the textarea (same classes, so the same font, padding
// and wrapping, at the same content width) holds the text before that line,
// and its content height is where the line starts. The copy is never shown
// and is gone before the call returns.

/** The top of the line holding `offset`, in px from the top of the textarea's content box edge (its top padding included). */
export function textareaLineTop(textarea: HTMLTextAreaElement, offset: number): number {
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', Math.max(0, Math.min(offset, value.length)) - 1) + 1;
  const style = getComputedStyle(textarea);
  const px = (v: string): number => parseFloat(v) || 0;
  const lineHeight = px(style.lineHeight) || px(style.fontSize) * 1.5 || 20;
  const padTop = px(style.paddingTop);
  const parent = textarea.parentElement;
  // Not laid out (or not in the page): rows of one line height are the best guess.
  if (!parent || textarea.clientWidth === 0) return padTop + value.slice(0, lineStart).split('\n').length * lineHeight - lineHeight;
  if (lineStart === 0) return padTop;
  const copy = textarea.cloneNode(false) as HTMLTextAreaElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.tabIndex = -1;
  Object.assign(copy.style, {
    position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    boxSizing: 'border-box', height: '0', minHeight: '0', maxHeight: 'none', overflowY: 'hidden',
    // The original's content width: clientWidth leaves out its scrollbar and borders, the copy has neither.
    width: `${textarea.clientWidth + px(style.borderLeftWidth) + px(style.borderRightWidth)}px`,
  });
  // The text up to the line ends in a line break, so the copy's last line is
  // the empty one where the wanted line begins.
  copy.value = value.slice(0, lineStart);
  parent.appendChild(copy);
  const height = copy.scrollHeight;
  copy.remove();
  return Math.max(padTop, height - px(style.paddingBottom) - lineHeight);
}

/** Scroll so the line holding `offset` sits `fraction` of the way down the textarea's view. */
export function scrollTextareaToOffset(textarea: HTMLTextAreaElement, offset: number, fraction = 1 / 3): void {
  textarea.scrollTop = Math.max(0, textareaLineTop(textarea, offset) - textarea.clientHeight * fraction);
}
