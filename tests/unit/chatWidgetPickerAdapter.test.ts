import { describe, expect, it, vi } from 'vitest';

import { ChatMode } from '../../src/services/chatTypes';
import { buildChatWidgetPickerServices } from '../../src/built-in/chat/utilities/chatWidgetPickerAdapter';

describe('chat widget picker adapter', () => {
  it('delegates model picker operations', async () => {
    const getModels = vi.fn().mockResolvedValue([{ id: 'llama', displayName: 'Llama' }]);
    const getActiveModel = vi.fn().mockReturnValue('llama');
    const setActiveModel = vi.fn();
    const getModelContextLength = vi.fn().mockResolvedValue(8192);
    const onDidChangeModels = vi.fn() as any;

    const services = buildChatWidgetPickerServices({
      getModels,
      getActiveModel,
      setActiveModel,
      onDidChangeModels,
      getModelContextLength,
      getMode: vi.fn().mockReturnValue(ChatMode.Agent),
      setMode: vi.fn(),
      getAvailableModes: vi.fn().mockReturnValue([ChatMode.Edit, ChatMode.Agent]),
      onDidChangeMode: vi.fn() as any,
    });

    await expect(services.modelPicker?.getModels()).resolves.toEqual([{ id: 'llama', displayName: 'Llama' }]);
    expect(services.modelPicker?.getActiveModel()).toBe('llama');
    services.modelPicker?.setActiveModel('qwen');
    await expect(services.modelPicker?.getModelContextLength?.('qwen')).resolves.toBe(8192);
    expect(setActiveModel).toHaveBeenCalledWith('qwen');
    expect(services.modelPicker?.onDidChangeModels).toBe(onDidChangeModels);
  });

  it('delegates mode picker operations', () => {
    const getMode = vi.fn().mockReturnValue(ChatMode.Edit);
    const setMode = vi.fn();
    const getAvailableModes = vi.fn().mockReturnValue([ChatMode.Edit, ChatMode.Agent]);
    const onDidChangeMode = vi.fn() as any;

    const services = buildChatWidgetPickerServices({
      getModels: vi.fn().mockResolvedValue([]),
      getActiveModel: vi.fn().mockReturnValue('llama'),
      setActiveModel: vi.fn(),
      onDidChangeModels: vi.fn() as any,
      getModelContextLength: vi.fn().mockResolvedValue(4096),
      getMode,
      setMode,
      getAvailableModes,
      onDidChangeMode,
    });

    expect(services.modePicker?.getMode()).toBe(ChatMode.Edit);
    services.modePicker?.setMode(ChatMode.Agent);
    expect(services.modePicker?.getAvailableModes()).toEqual([ChatMode.Edit, ChatMode.Agent]);
    expect(setMode).toHaveBeenCalledWith(ChatMode.Agent);
    expect(services.modePicker?.onDidChangeMode).toBe(onDidChangeMode);
  });
});