// @vitest-environment jsdom
// The permission mode in the chat's mode picker: in Agent mode, one
// segmented control (Ask, Auto, Careful) wired to the permission service,
// with a line under it that says what the chosen mode really does.

import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { ChatMode } from '../../src/services/chatTypes';
import type { PermissionMode } from '../../src/services/permissionService';
import { ChatModePicker, PERMISSION_MODE_META } from '../../src/built-in/chat/pickers/chatModePicker';

function mount(mode: ChatMode, permissionMode: PermissionMode | undefined) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const onDidChangeMode = new Emitter<ChatMode>();
  let current = permissionMode;
  const set: PermissionMode[] = [];
  const picker = new ChatModePicker(container, {
    getMode: () => mode,
    setMode: () => {},
    getAvailableModes: () => [ChatMode.Edit, ChatMode.Agent],
    onDidChangeMode: onDidChangeMode.event,
    ...(permissionMode ? {
      getPermissionMode: () => current!,
      setPermissionMode: (m: PermissionMode) => { current = m; set.push(m); },
    } : {}),
  });
  picker.openDropdown();
  const dropdown = document.querySelector('.parallx-chat-picker-dropdown') as HTMLElement;
  return { picker, dropdown, set, current: () => current };
}

describe('the permission mode in the mode picker', () => {
  it('Agent mode shows Ask, Auto and Careful as one control, the current one checked, and the truth line for it', () => {
    const { picker, dropdown } = mount(ChatMode.Agent, 'auto');
    const segments = [...dropdown.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(segments.map((s) => s.textContent)).toEqual(['Ask', 'Auto', 'Careful']);
    expect(segments.map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(dropdown.querySelector('.parallx-chat-picker-gating-truth')!.textContent).toBe(PERMISSION_MODE_META.auto.truth);
    expect(PERMISSION_MODE_META.auto.truth).toContain('everything runs without asking');
    picker.dispose();
  });

  it('a click switches the mode through the service and rewrites the truth line', () => {
    const { picker, dropdown, set, current } = mount(ChatMode.Agent, 'ask');
    const careful = [...dropdown.querySelectorAll('[role="radio"]')].find((s) => s.textContent === 'Careful') as HTMLElement;
    careful.click();
    expect(set).toEqual(['careful']);
    expect(current()).toBe('careful');
    expect(dropdown.querySelector('.parallx-chat-picker-gating-truth')!.textContent).toBe(PERMISSION_MODE_META.careful.truth);
    expect(document.body.contains(dropdown)).toBe(true);
    picker.dispose();
  });

  it('Edit mode, or a picker with no permission service, shows no control', () => {
    const edit = mount(ChatMode.Edit, 'auto');
    expect(edit.dropdown.querySelector('[role="radio"]')).toBeNull();
    edit.picker.dispose();
    const headless = mount(ChatMode.Agent, undefined);
    expect(headless.dropdown.querySelector('[role="radio"]')).toBeNull();
    headless.picker.dispose();
  });
});
