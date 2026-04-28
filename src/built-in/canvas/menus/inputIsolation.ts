// inputIsolation.ts — keep popup inputs from leaking events into ProseMirror
//
// Several canvas insert popups (image, bookmark, media) host a URL <input>
// floating inside the editor. Without isolation, ProseMirror's editor view
// captures keystrokes, paste, and cut/copy events bubbling out of the input,
// stealing focus and triggering its own commands. This helper attaches the
// standard isolation contract:
//
//   • Enter   → optional onSubmit
//   • Escape  → optional onCancel
//   • All keyboard + clipboard events stop propagating past the input
//   • Optional onInput hook fires after each input event (e.g. clear errors)
//
// The popup is responsible for focusing the input and tearing itself down;
// this helper only attaches listeners.

export interface IInputIsolationOptions {
  /** Called when the user presses Enter inside the input. */
  onSubmit?: () => void;
  /** Called when the user presses Escape inside the input. */
  onCancel?: () => void;
  /** Called after each `input` event (after `stopPropagation`). */
  onInput?: () => void;
}

export function isolateInputFromEditor(
  input: HTMLInputElement,
  options: IInputIsolationOptions = {},
): void {
  const { onSubmit, onCancel, onInput } = options;

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && onSubmit) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
    event.stopPropagation();
  });
  input.addEventListener('keyup', (event) => event.stopPropagation());
  input.addEventListener('keypress', (event) => event.stopPropagation());
  input.addEventListener('input', (event) => {
    event.stopPropagation();
    onInput?.();
  });
  input.addEventListener('paste', (event) => event.stopPropagation());
  input.addEventListener('copy', (event) => event.stopPropagation());
  input.addEventListener('cut', (event) => event.stopPropagation());
}
