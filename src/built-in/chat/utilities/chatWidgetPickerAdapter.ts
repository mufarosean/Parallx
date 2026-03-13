import type { IChatWidgetServices } from '../chatTypes.js';
import type { Event } from '../../../platform/events.js';
import type { ChatMode, ILanguageModelInfo } from '../../../services/chatTypes.js';

export interface IChatWidgetPickerAdapterDeps {
  readonly getModels: () => Promise<readonly ILanguageModelInfo[]>;
  readonly getModelInfo?: (modelId: string) => Promise<ILanguageModelInfo>;
  readonly getActiveModel: () => string | undefined;
  readonly setActiveModel: (modelId: string) => void;
  readonly onDidChangeModels: Event<void>;
  readonly getModelContextLength: (modelId: string) => Promise<number>;
  readonly getMode: () => ChatMode;
  readonly setMode: (mode: ChatMode) => void;
  readonly getAvailableModes: () => readonly ChatMode[];
  readonly onDidChangeMode: Event<ChatMode>;
}

export function buildChatWidgetPickerServices(
  deps: IChatWidgetPickerAdapterDeps,
): Pick<IChatWidgetServices, 'modelPicker' | 'modePicker'> {
  return {
    modelPicker: {
      getModels: deps.getModels,
      getModelInfo: deps.getModelInfo,
      getActiveModel: deps.getActiveModel,
      setActiveModel: deps.setActiveModel,
      onDidChangeModels: deps.onDidChangeModels,
      getModelContextLength: deps.getModelContextLength,
    },
    modePicker: {
      getMode: deps.getMode,
      setMode: deps.setMode,
      getAvailableModes: deps.getAvailableModes,
      onDidChangeMode: deps.onDidChangeMode,
    },
  };
}