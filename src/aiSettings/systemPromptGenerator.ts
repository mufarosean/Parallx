// systemPromptGenerator.ts — System prompt generation from friendly settings (M15 Task 1.2)
//
// The critical bridge between the friendly UI and the raw LLM instruction.
// When the user changes tone from "Balanced" to "Concise", this function
// regenerates the system prompt automatically. The user never has to write
// a prompt unless they want to.

import type {
  AITone,
  AIFocusDomain,
  AIResponseLength,
  AISettingsProfile,
} from './aiSettingsTypes.js';

// ─── Tone Instructions ─────────────────────────────────────────────────────

const TONE_INSTRUCTIONS: Record<AITone, string> = {
  concise:
    'Be brief and direct. Use short sentences. Skip preambles and conclusions unless asked. Bullet points over paragraphs.',
  balanced:
    'Be clear and helpful. Match the complexity of the answer to the complexity of the question. Use structure when it aids clarity.',
  detailed:
    'Be thorough and explanatory. Provide context, examples, and relevant nuance. Prefer complete explanations over brevity.',
};

// ─── Focus Instructions ────────────────────────────────────────────────────

const FOCUS_INSTRUCTIONS: Record<AIFocusDomain, string> = {
  general: '',
  finance:
    'Pay particular attention to financial signals: transactions, budgets, expenses, invoices, and monetary patterns.',
  writing:
    'Pay particular attention to written content: tone, clarity, structure, grammar, and creative expression.',
  coding:
    'Pay particular attention to code: correctness, efficiency, patterns, debugging, and software architecture.',
  research:
    'Pay particular attention to information synthesis: sources, accuracy, completeness, and nuanced analysis.',
  custom: '', // filled dynamically from customFocusDescription
};

// ─── Length Instructions ───────────────────────────────────────────────────

const LENGTH_INSTRUCTIONS: Record<AIResponseLength, string> = {
  short: 'Keep responses to 1–3 sentences unless more is explicitly needed.',
  medium: 'Aim for responses that are thorough but not exhaustive.',
  long: 'Provide comprehensive responses. Do not truncate. Include all relevant detail.',
  adaptive:
    'Match response length to the question: brief for simple queries, detailed for complex ones.',
};

// ─── Generator ─────────────────────────────────────────────────────────────

/**
 * Settings required to generate the chat system prompt.
 * Combines chat settings with the tone/focus fields from suggestions.
 */
export interface SystemPromptGenInput {
  systemPrompt: string;
  systemPromptIsCustom: boolean;
  responseLength: AIResponseLength;
  tone: AITone;
  focusDomain: AIFocusDomain;
  customFocusDescription: string;
}

/**
 * Generate the chat system prompt from friendly settings.
 * This replaces PARALLX_IDENTITY when injected as promptOverlay.
 */
export function generateChatSystemPrompt(
  settings: SystemPromptGenInput
): string {
  const focusLine =
    settings.focusDomain === 'custom'
      ? `Pay particular attention to: ${settings.customFocusDescription}.`
      : FOCUS_INSTRUCTIONS[settings.focusDomain];

  const parts = [
    'You are a helpful, intelligent assistant embedded in the Parallx workspace.',
    "Everything runs locally on the user's machine. You are powered by Ollama and have no internet access.",
    TONE_INSTRUCTIONS[settings.tone],
    LENGTH_INSTRUCTIONS[settings.responseLength],
    focusLine,
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Build the SystemPromptGenInput from a full profile.
 * Convenience helper that merges the cross-section fields.
 */
export function buildGenInputFromProfile(
  profile: AISettingsProfile
): SystemPromptGenInput {
  return {
    systemPrompt: profile.chat.systemPrompt,
    systemPromptIsCustom: profile.chat.systemPromptIsCustom,
    responseLength: profile.chat.responseLength,
    tone: profile.suggestions.tone,
    focusDomain: profile.suggestions.focusDomain,
    customFocusDescription: profile.suggestions.customFocusDescription,
  };
}

/**
 * Generate a preview of the chat prompt from a full profile.
 */
export function generateSystemPromptPreview(
  profile: AISettingsProfile
): { chatPrompt: string } {
  const chatPrompt = generateChatSystemPrompt(buildGenInputFromProfile(profile));
  return { chatPrompt };
}
