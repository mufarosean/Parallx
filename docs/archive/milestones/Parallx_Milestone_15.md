# Milestone 15 — AI Personality & Behavior Settings

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 15.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–14 established the workbench shell, tool system, local AI chat,
> RAG pipeline, and workspace session isolation. This milestone adds a first-class
> settings UI so the user can change how all AI in Parallx thinks, speaks, and
> behaves — **without ever touching code or config files directly.**

---

## Mandatory Pre-Implementation Protocol

> **Read the codebase before writing anything.** Every assumption made without reading
> the source will produce integration failures. Run all of the following before Task 1.1.

```bash
# 1. Understand what AI config already exists
grep -r "IParallxAgentConfig\|DEFAULT_AGENT_CONFIG\|DEFAULT_MODEL_CONFIG" src/ --include="*.ts" -l
grep -r "temperature\|PARALLX_IDENTITY\|buildSystemPrompt" src/ --include="*.ts"

# 2. Find the chat model config
grep -r "activeModelId\|_activeModelId\|sendChatRequest" src/ --include="*.ts"
cat src/services/languageModelsService.ts

# 3. Find the existing settings/storage system (M1 IStorage + ConfigurationService)
grep -r "IStorage\|ConfigurationService\|Memento\|IConfigurationService" src/ --include="*.ts" -l

# 4. Find how system prompts are built and injected
grep -r "promptOverlay\|buildSystemPrompt\|getPreferencesForPrompt" src/ --include="*.ts" -l

# 5. Find how views and tools register themselves
grep -r "registerViewProvider\|IToolManifest\|builtinManifests" src/ --include="*.ts" -l

# 6. Find the DI container registration pattern
grep -r "createServiceIdentifier\|registerInstance" src/ --include="*.ts" | head -20
```

> After running the above: the `ConfigurationService` backed by `IStorage` is the
> persistence layer. The system prompt is built dynamically via `buildSystemPrompt()`
> in `chatSystemPrompts.ts` and injected via `promptOverlay`. Views register through
> `IToolManifest` + `registerViewProvider()`. Use these existing patterns — do not
> create parallel mechanisms.

---

## Reference Documentation

| Reference | URL | What to learn from it |
|-----------|-----|-----------------------|
| LM Studio Presets | https://lmstudio.ai/docs/app/presets | Named preset bundles: system prompt + temperature + params saved together |
| LM Studio Per-Model Config | https://lmstudio.ai/docs/app/advanced/per-model | Separate config per model, not just global |
| Open WebUI Model Builder | https://docs.openwebui.com/features/ai-knowledge/models/ | Full field breakdown: name, description, system prompt, advanced params, prompt suggestions, capabilities |
| Jan AI Model Parameters | https://www.jan.ai/docs/desktop/model-parameters | Parameter labels: "personality settings and performance controls" — human-readable framing |
| ChatGPT Canvas Parametrization | https://www.uxtigers.com/post/prompt-augmentation | Hybrid GUI: sliders for abstract dimensions like "reading level" alongside raw text fields |
| Shape of AI – Persona patterns | https://www.shapeof.ai | Persona characteristics: tone, constraints, style presets for re-use |
| VS Code Settings Editor UX | https://code.visualstudio.com/docs/getstarted/settings | Search bar, grouped sections, tree nav, per-setting reset-to-default, "edit in JSON" escape hatch |
| Msty Personas + Crew Mode | https://msty.ai/changelog | Named personas with avatars, persona-first conversation mode, shadow personas |

> **The key insight from studying these tools:**
> The best AI config UIs do three things simultaneously:
> 1. **Friendly surface** — sliders, dropdowns, and plain-English labels hide the raw prompt
> 2. **Expert escape hatch** — a raw system prompt editor is always one click away
> 3. **Named presets** — settings are bundled and named ("Focused Coder", "Casual Assistant")
>    so switching persona takes one click, not retyping everything

---

## Milestone Definition

### Vision

Every AI behavior in Parallx — the chat assistant and the proactive suggestion system — is
configurable through a dedicated **AI Settings panel**. The panel looks and feels like
VS Code's Settings editor: grouped sections, a search bar, human-readable labels, and
immediate effect on saving. No config file editing. No restarting the app.

The user can:
- Change the agent's display name and avatar
- Pick a communication tone (Concise / Balanced / Detailed)
- Set a domain focus (Finance, Writing, General, etc.)
- Adjust creativity/temperature with a labeled slider (Precise → Creative)
- Write or override the full system prompt for chat
- Create, save, and switch named **Persona Presets** ("Default", "Focused Finance", "Creative Brainstorm")
- Configure proactive suggestion behavior (confidence threshold, suggestion limits)
- Preview what the current settings produce with a live test prompt
- Reset any individual setting or the entire profile to factory defaults

### What This Is Not

- It is NOT an Ollama model downloader or model switcher (Capability 5 is a focused
  model manager, not a full model marketplace)
- It is NOT a full appearance/theme engine (Capability 11 adds basic controls only)
- It is NOT multi-user or role-based (single user in M15)

### Background — What Actually Exists Today

| System | Location | Current State |
|--------|----------|---------------|
| **Agent config** | `src/services/parallxConfigService.ts` | `IParallxAgentConfig` controls RAG behavior (maxIterations, autoRag, ragTopK, ragScoreThreshold). Model names in `IParallxModelConfig`. Config loaded from `.parallx/config.json`. |
| **System prompt** | `src/built-in/chat/config/chatSystemPrompts.ts` | `buildSystemPrompt(mode, context)` generates prompts per-request. `PARALLX_IDENTITY` is the default persona block. `promptOverlay` field in `ISystemPromptContext` overrides it when set. |
| **Temperature** | `src/built-in/chat/providers/ollamaProvider.ts` | Per-call via `options.temperature`. Planning mode hardcoded at 0.1. No global default. |
| **Language models** | `src/services/languageModelsService.ts` | `LanguageModelsService` queries Ollama `/api/tags`, stores `_activeModelId`, auto-selects first non-embedding model. `ILanguageModelsService` in `chatTypes.ts`. |
| **Chat model picker** | `src/built-in/chat/pickers/chatModelPicker.ts` | Dropdown in chat header to switch models at runtime. |
| **Storage** | `src/platform/storage.ts` | `IStorage` interface (async key-value). `ConfigurationService` wraps it with `'config:'` prefix. |
| **View system** | `src/tools/builtinManifests.ts` + `src/contributions/viewContribution.ts` | Views register via `IToolManifest.contributes.views` + `registerViewProvider()`. |
| **Existing preferences** | `src/built-in/chat/data/chatDataService.ts` | `getPreferencesForPrompt()` extracts learned preferences from conversation history via memory service. Appended after system prompt. |
| **Proactive suggestions** | `src/services/proactiveSuggestionsService.ts` | Vector-similarity-based pattern detection. Fires `onDidUpdateSuggestions`. Has hardcoded constants (`ANALYSIS_COOLDOWN_MS`, `CLUSTER_THRESHOLD`). |
| **Session manager** | `src/workspace/sessionManager.ts` | M14's `SessionManager` + `WorkspaceSessionContext`. Guards in indexing and chat. |
| **CSS tokens** | All CSS files | Uses `var(--vscode-*)` tokens exclusively. No `--parallx-*` tokens exist. |
| **UI components** | `src/ui/` | Has: ActionBar, Button, InputBox, IconPicker, FilterableList, Overlay, TabBar, ContextMenu. Missing: Slider, Toggle, Dropdown, SegmentedControl, Textarea. |

### Critical Corrections from the Codebase Audit

1. **No `src/agent/` directory exists.** There is no `AgentRuntimeService`, no `AGENT_CONFIG`
   constant, and no proactive agent with tick intervals or planning prompts. The
   `ProactiveSuggestionsService` is the closest thing — it does vector-similarity analysis
   with hardcoded thresholds. Tasks referencing "Agent Runtime" wire into
   `ProactiveSuggestionsService` instead.

2. **No event bus exists.** The codebase uses the VS Code `Emitter<T>` / `Event<T>` pattern
   exclusively. `AISettingsService` exposes `readonly onDidChange: Event<AISettingsProfile>`
   and consumers subscribe directly — not via `eventBus.emit()`.

3. **CSS uses `--vscode-*` tokens, not `--parallx-*`.** All styling must use existing
   `var(--vscode-*)` custom properties with fallbacks. The M15 panel uses tokens like
   `var(--vscode-foreground)`, `var(--vscode-input-background)`, `var(--vscode-focusBorder)`, etc.

4. **`IStorage` is the persistence layer, not `IStorageService`.** The raw `IStorage`
   interface from `platform/storage.ts` is what `ConfigurationService` uses. M15 uses it
   the same way.

5. **Temperature is per-call through `options.temperature`.** The `OllamaProvider.sendChatRequest()`
   passes `temperature` from the request options to Ollama. M15 provides a global default
   that flows through the request pipeline.

6. **System prompt injection uses `promptOverlay`.** When `promptOverlay` is set on
   `ISystemPromptContext`, it replaces `PARALLX_IDENTITY`. M15 generates the persona block
   and passes it as `promptOverlay`.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI SETTINGS PANEL (UI)                        │
│  Opened via: Activity Bar icon  |  Command Palette  |  Status bar│
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐  │
│  │  SECTION NAV     │  │        SETTINGS CONTENT AREA         │  │
│  │  (left sidebar)  │  │                                      │  │
│  │                  │  │  Search settings...                  │  │
│  │  > Persona       │  │                                      │  │
│  │  > Chat          │  │  -- Persona ---                      │  │
│  │  > Suggestions   │  │  Name: [Parallx AI          ]       │  │
│  │  > Model         │  │  Tone: [ Balanced v ]                │  │
│  │  > Advanced      │  │  Focus: [ General v ]                │  │
│  │  > Preview       │  │  Creativity: |--*----| Balanced      │  │
│  │                  │  │                                      │  │
│  └─────────────────┘  │  -- Chat ---                          │  │
│                        │  System Prompt: [textarea]            │  │
│  ┌─────────────────┐  │  Response Length: [ Medium v ]        │  │
│  │  PRESET SWITCHER │  │                                      │  │
│  │                  │  │  -- Suggestions ---                   │  │
│  │  * Default       │  │  [x] Proactive suggestions           │  │
│  │  o Finance Focus │  │  Confidence: |----*-| 65%            │  │
│  │  o Creative Mode │  │                                      │  │
│  │  [+ New Preset]  │  │  -- Preview ---                      │  │
│  └─────────────────┘  │  [Test: "Hello, who are you?"] [Run] │  │
│                        └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User changes a setting in the panel
        │
        ▼
AISettingsPanel (UI) calls IAISettingsService.updateActiveProfile(patch)
        │
        ▼
AISettingsService:
  1. Deep-merges patch into active profile
  2. Regenerates system prompt (unless systemPromptIsCustom = true)
  3. Persists to IStorage (key: 'ai-settings.profiles')
  4. Fires onDidChange event via Emitter<T>
        │
        ├──▶ defaultParticipant.ts → next chat request uses new promptOverlay + temperature
        │
        └──▶ ProactiveSuggestionsService → reads new thresholds
```

No app restart needed. Settings take effect on the next AI interaction.

---

## TypeScript Types

**File:** `src/aiSettings/aiSettingsTypes.ts`

```typescript
import type { IDisposable } from '../platform/lifecycle.js';

// ─── Tone / Style Enums ────────────────────────────────────────────────────

export type AITone = 'concise' | 'balanced' | 'detailed';
export type AIFocusDomain =
  | 'general'
  | 'finance'
  | 'writing'
  | 'coding'
  | 'research'
  | 'custom';
export type AIResponseLength = 'short' | 'medium' | 'long' | 'adaptive';

// ─── The Full Settings Profile ─────────────────────────────────────────────

export interface AIPersonaSettings {
  /** Display name shown in the UI and in suggestion cards (e.g. "Parallx AI") */
  name: string;
  /** One-sentence description shown under the name */
  description: string;
  /** Emoji or icon key used as the avatar (e.g. "🧠", "💼", "✍️") */
  avatarEmoji: string;
}

export interface AIChatSettings {
  /**
   * The system prompt injected at the top of every chat conversation.
   * The friendly UI controls (tone, focus, length) generate this string,
   * but the user can also override it directly in the raw editor.
   */
  systemPrompt: string;
  /** Whether the user has manually overridden the generated system prompt */
  systemPromptIsCustom: boolean;
  responseLength: AIResponseLength;
}

export interface AIModelSettings {
  /**
   * 0.0 = fully deterministic (precise)
   * 1.0 = fully creative (variable)
   * Maps directly to Ollama's `temperature` parameter.
   * Passed through OllamaProvider.sendChatRequest() options.
   */
  temperature: number;
  /** Max tokens per response (0 = model default). Passed as num_predict. */
  maxTokens: number;
  /** Context window size override (0 = model default). Passed as num_ctx. */
  contextWindow: number;
}

export interface AISuggestionSettings {
  /** Friendly tone for the proactive suggestions system */
  tone: AITone;
  /** Domain the AI pays extra attention to */
  focusDomain: AIFocusDomain;
  /** If focusDomain === 'custom', this free-text field describes it */
  customFocusDescription: string;
  /**
   * Minimum confidence 0–1 to surface a suggestion.
   * Wires into ProactiveSuggestionsService threshold.
   */
  suggestionConfidenceThreshold: number;
  /** Whether proactive suggestion cards are shown */
  suggestionsEnabled: boolean;
  /** Max suggestion cards visible at once */
  maxPendingSuggestions: number;
}

export interface AISettingsProfile {
  /** Unique ID — used as the preset key */
  id: string;
  /** Human-readable name shown in the Preset Switcher */
  presetName: string;
  /** Whether this is a built-in read-only preset */
  isBuiltIn: boolean;
  persona: AIPersonaSettings;
  chat: AIChatSettings;
  model: AIModelSettings;
  suggestions: AISuggestionSettings;
  createdAt: number;
  updatedAt: number;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IAISettingsService extends IDisposable {
  /** Get the currently active profile (effective = global merged with workspace override) */
  getActiveProfile(): AISettingsProfile;

  /** Get the un-merged global profile (needed by the UI to show override badges) */
  getGlobalProfile(): AISettingsProfile;

  /** Get a specific profile by ID */
  getProfile(id: string): AISettingsProfile | undefined;

  /** List all saved profiles */
  getAllProfiles(): AISettingsProfile[];

  /** Switch the active profile — fires onDidChange */
  setActiveProfile(id: string): Promise<void>;

  /** Update fields on the currently active profile and save */
  updateActiveProfile(patch: DeepPartial<AISettingsProfile>): Promise<void>;

  /** Create a new profile (cloned from active, or from defaults if base is undefined) */
  createProfile(name: string, baseId?: string): Promise<AISettingsProfile>;

  /** Delete a profile (cannot delete built-in presets) */
  deleteProfile(id: string): Promise<void>;

  /** Rename a profile */
  renameProfile(id: string, newName: string): Promise<void>;

  /** Reset a specific section of the active profile to factory defaults */
  resetSection(section: 'persona' | 'chat' | 'model' | 'suggestions'): Promise<void>;

  /** Reset the entire active profile to factory defaults */
  resetAll(): Promise<void>;

  /** Generate a system prompt string from the current friendly settings */
  generateSystemPrompt(settings: AISuggestionSettings & AIChatSettings): string;

  /** Test: send a single message using the active profile settings and return the response */
  runPreviewTest(userMessage: string): Promise<string>;

  /** Subscribe to settings changes. Uses Emitter<T>/Event<T> pattern. */
  readonly onDidChange: import('../platform/events.js').Event<AISettingsProfile>;
}

// ─── Utility ───────────────────────────────────────────────────────────────

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ─── Workspace Override (Capability 6) ─────────────────────────────────────

/**
 * A sparse patch of AISettingsProfile fields.
 * Only the fields present here override the global active profile.
 * Stored in .parallx/ai-settings.json inside the workspace root.
 */
export type WorkspaceAIOverride = DeepPartial<
  Pick<AISettingsProfile, 'chat' | 'model' | 'suggestions'>
> & {
  /** Human label shown in the status bar when override is active */
  label?: string;
};

// ─── Prompt Builder Answers (Capability 8) ─────────────────────────────────

export interface PromptBuilderAnswers {
  role: string;
  audience: string;
  audienceDetails: string;
  expertiseAreas: string[];
  constraints: string;
}
```

---

## Factory Defaults

**File:** `src/aiSettings/aiSettingsDefaults.ts`

```typescript
import type { AISettingsProfile } from './aiSettingsTypes.js';
import { generateChatSystemPrompt } from './systemPromptGenerator.js';

function makeDefaultProfile(): AISettingsProfile {
  const profile: AISettingsProfile = {
    id: 'default',
    presetName: 'Default',
    isBuiltIn: true,
    persona: {
      name: 'Parallx AI',
      description: 'Your intelligent workspace assistant',
      avatarEmoji: '🧠',
    },
    chat: {
      systemPrompt: '',  // filled below
      systemPromptIsCustom: false,
      responseLength: 'adaptive',
    },
    model: {
      temperature: 0.7,
      maxTokens: 0,       // model default
      contextWindow: 0,   // model default
    },
    suggestions: {
      tone: 'balanced',
      focusDomain: 'general',
      customFocusDescription: '',
      suggestionConfidenceThreshold: 0.65,
      suggestionsEnabled: true,
      maxPendingSuggestions: 5,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Generate the default system prompt from the default settings
  profile.chat.systemPrompt = generateChatSystemPrompt({
    ...profile.chat,
    tone: profile.suggestions.tone,
    focusDomain: profile.suggestions.focusDomain,
    customFocusDescription: profile.suggestions.customFocusDescription,
  });
  return profile;
}

export const DEFAULT_PROFILE: AISettingsProfile = makeDefaultProfile();

export const BUILT_IN_PRESETS: AISettingsProfile[] = [
  DEFAULT_PROFILE,
  {
    ...DEFAULT_PROFILE,
    id: 'finance-focus',
    presetName: 'Finance Focus',
    isBuiltIn: true,
    persona: {
      name: 'Finance Assistant',
      description: 'Focused on transactions, budgeting, and financial insights',
      avatarEmoji: '💰',
    },
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      tone: 'concise',
      focusDomain: 'finance',
      suggestionConfidenceThreshold: 0.60,
    },
  },
  {
    ...DEFAULT_PROFILE,
    id: 'creative-mode',
    presetName: 'Creative Mode',
    isBuiltIn: true,
    persona: {
      name: 'Creative Partner',
      description: 'Playful and exploratory — great for writing and brainstorming',
      avatarEmoji: '✍️',
    },
    model: {
      ...DEFAULT_PROFILE.model,
      temperature: 0.9,
    },
    suggestions: {
      ...DEFAULT_PROFILE.suggestions,
      tone: 'detailed',
      focusDomain: 'writing',
    },
  },
];
```

---

## System Prompt Generator

**File:** `src/aiSettings/systemPromptGenerator.ts`

This is the critical bridge between the friendly UI and the raw LLM instruction.
When the user changes tone from "Balanced" to "Concise", this function regenerates
the system prompt. The user never has to write a prompt unless they want to.

```typescript
import type {
  AISuggestionSettings, AIChatSettings, AITone,
  AIFocusDomain, AIResponseLength, AISettingsProfile,
} from './aiSettingsTypes.js';

const TONE_INSTRUCTIONS: Record<AITone, string> = {
  concise:  'Be brief and direct. Use short sentences. Skip preambles and conclusions unless asked. Bullet points over paragraphs.',
  balanced: 'Be clear and helpful. Match the complexity of the answer to the complexity of the question. Use structure when it aids clarity.',
  detailed: 'Be thorough and explanatory. Provide context, examples, and relevant nuance. Prefer complete explanations over brevity.',
};

const FOCUS_INSTRUCTIONS: Record<AIFocusDomain, string> = {
  general:  '',
  finance:  'Pay particular attention to financial signals: transactions, budgets, expenses, invoices, and monetary patterns.',
  writing:  'Pay particular attention to written content: tone, clarity, structure, grammar, and creative expression.',
  coding:   'Pay particular attention to code: correctness, efficiency, patterns, debugging, and software architecture.',
  research: 'Pay particular attention to information synthesis: sources, accuracy, completeness, and nuanced analysis.',
  custom:   '', // filled in dynamically
};

const LENGTH_INSTRUCTIONS: Record<AIResponseLength, string> = {
  short:    'Keep responses to 1–3 sentences unless more is explicitly needed.',
  medium:   'Aim for responses that are thorough but not exhaustive.',
  long:     'Provide comprehensive responses. Do not truncate. Include all relevant detail.',
  adaptive: 'Match response length to the question: brief for simple queries, detailed for complex ones.',
};

/**
 * Generate the chat system prompt from friendly settings.
 * This replaces PARALLX_IDENTITY when injected as promptOverlay.
 */
export function generateChatSystemPrompt(
  settings: AIChatSettings & {
    tone: AITone;
    focusDomain: AIFocusDomain;
    customFocusDescription: string;
  }
): string {
  const focusLine = settings.focusDomain === 'custom'
    ? `Pay particular attention to: ${settings.customFocusDescription}.`
    : FOCUS_INSTRUCTIONS[settings.focusDomain];

  const parts = [
    `You are a helpful, intelligent assistant embedded in the Parallx workspace.`,
    `Everything runs locally on the user's machine. You are powered by Ollama and have no internet access.`,
    TONE_INSTRUCTIONS[settings.tone],
    LENGTH_INSTRUCTIONS[settings.responseLength],
    focusLine,
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Generate a preview of the chat prompt from a full profile.
 */
export function generateSystemPromptPreview(
  profile: AISettingsProfile
): { chatPrompt: string } {
  const chatPrompt = generateChatSystemPrompt({
    ...profile.chat,
    tone: profile.suggestions.tone,
    focusDomain: profile.suggestions.focusDomain,
    customFocusDescription: profile.suggestions.customFocusDescription,
  });
  return { chatPrompt };
}
```

---

## File Structure

All new files go in `src/aiSettings/`. This exact layout must be followed.

```
src/
└── aiSettings/
    ├── aiSettingsTypes.ts          # All types, IAISettingsService interface, DeepPartial
    ├── aiSettingsDefaults.ts       # DEFAULT_PROFILE and BUILT_IN_PRESETS
    ├── aiSettingsService.ts        # IAISettingsService implementation (extends Disposable)
    ├── systemPromptGenerator.ts    # generateChatSystemPrompt() + preview
    ├── ollamaModelService.ts       # IOllamaModelService — talks to Ollama REST API (Cap 5)
    ├── communityPresets.ts         # Static array of gallery presets (Cap 7)
    └── ui/
        ├── aiSettingsPanel.ts      # Main panel — registered as a Parallx view
        ├── aiSettings.css          # All panel styles (co-located CSS)
        ├── presetSwitcher.ts       # Preset list + create/delete/rename
        ├── previewPanel.ts         # Live test prompt → response
        ├── promptBuilder.ts        # AI-assisted prompt wizard (Cap 8)
        └── sections/
            ├── personaSection.ts   # Name, description, emoji avatar
            ├── chatSection.ts      # Response length, chat system prompt editor
            ├── suggestionsSection.ts  # Confidence threshold, suggestion toggles
            ├── modelSection.ts     # Temperature slider, token limits
            ├── modelManagerSection.ts # Ollama model list, pull, delete (Cap 5)
            ├── advancedSection.ts  # Raw system prompt, JSON export/import
            ├── workspaceSection.ts # Workspace override display (Cap 6)
            └── gallerySection.ts   # Community preset gallery (Cap 7)
```

**New `src/ui/` components required** (must be created before panel UI):

```
src/ui/
├── slider.ts       # Range slider with labeled stops
├── slider.css
├── toggle.ts       # On/off toggle switch
├── toggle.css
├── dropdown.ts     # Single-select dropdown
├── dropdown.css
├── segmentedControl.ts  # Segmented button group (Concise / Balanced / Detailed)
├── segmentedControl.css
├── textarea.ts     # Multi-line text input
└── textarea.css
```

All new `src/ui/` components must follow the project rules:
- Extend `Disposable` from `platform/lifecycle.ts`
- Accept `(container: HTMLElement, options?: TOptions)` in constructor
- Use CSS from co-located `.css` file — no inline styles for visual properties
- Fire events via `Emitter<T>` — expose as `readonly onDidX: Event<T>`
- Accept styles/theme as config — never hardcode colors
- Depend only on `platform/` — never on `services/`, `parts/`, or `views/`

---

## Capability 1 — AI Settings Service (Foundation)

### Description

The persistence backbone. Reads and writes AI settings profiles using M1's `IStorage`.
Emits change events so all consumers (chat prompt builder, proactive suggestions)
react immediately without a restart.

---

### Task 1.1 — Define Types and Defaults

- **Files:** `src/aiSettings/aiSettingsTypes.ts`, `src/aiSettings/aiSettingsDefaults.ts`
- Copy the types exactly from the TypeScript Types section above.
- Note: uses `suggestions` (not `agent`) as the field name — no agent runtime exists.
- `DEFAULT_PROFILE` defines the factory state every fresh installation starts with.
- The three built-in presets (Default, Finance Focus, Creative Mode) are always present
  and cannot be deleted.
- **Completion Criteria:** Both files compile with `tsc --noEmit`. All downstream files
  import types only from `aiSettingsTypes.ts`.

---

### Task 1.2 — Implement System Prompt Generator

- **File:** `src/aiSettings/systemPromptGenerator.ts`
- Implement `generateChatSystemPrompt()` exactly as shown in the System Prompt Generator
  section above.
- **The generator is the bridge between the friendly UI and the raw LLM instruction.**
  When the user moves the tone slider from "Balanced" to "Concise", only this function
  is called — the user never needs to know what words end up in the prompt.
- Add `generateSystemPromptPreview(profile)` that generates prompts and returns them
  for display in the Advanced section.
- **Completion Criteria:** For each of the three built-in presets, calling
  `generateChatSystemPrompt()` produces a non-empty, sensible string. Write a unit test
  (`tests/unit/systemPromptGenerator.test.ts`) with three assertions.

---

### Task 1.3 — Implement AISettingsService

- **File:** `src/aiSettings/aiSettingsService.ts`
- Extends `Disposable` from `platform/lifecycle.ts`.
- Persists to `IStorage` (from `platform/storage.ts`) under keys:
  - `'ai-settings.profiles'` — JSON array of `AISettingsProfile`
  - `'ai-settings.activeProfileId'` — string
- On construction: load persisted profiles from storage; if none exist, seed with
  `BUILT_IN_PRESETS`.
- Exposes `readonly onDidChange: Event<AISettingsProfile>` via `Emitter<T>` pattern —
  **NOT** an event bus (no event bus exists in the codebase).
- Key rules:
  - Built-in presets (`isBuiltIn: true`) can never be deleted.
  - Updating a built-in preset's settings silently clones it to a new profile named
    `"${presetName} (Modified)"` and switches active to that clone. The original stays clean.
  - `updateActiveProfile(patch)` merges the patch deeply, then calls
    `generateChatSystemPrompt()` unless `systemPromptIsCustom` is `true`.
  - Every write fires `this._onDidChange.fire(updatedProfile)`.
- **`runPreviewTest` implementation:**
  ```typescript
  async runPreviewTest(userMessage: string): Promise<string> {
    const profile = this.getActiveProfile();
    // Use ILanguageModelsService to get the active model and send a request
    const modelId = this._languageModelsService.activeModelId;
    if (!modelId) throw new Error('No active model available');

    const response = await this._languageModelsService.sendChatRequest(modelId, [
      { role: 'system', content: profile.chat.systemPrompt },
      { role: 'user', content: userMessage },
    ], {
      temperature: profile.model.temperature,
      maxTokens: profile.model.maxTokens || undefined,
    });
    // Collect streamed response into a string
    return collectStreamedResponse(response);
  }
  ```
- **Note:** `ILanguageModelsService` already exists in `chatTypes.ts` and handles all
  Ollama communication. Do NOT call Ollama directly — use the existing service.
- **Completion Criteria:**
  - On first launch: three built-in presets in storage, active profile is "Default".
  - `updateActiveProfile({ suggestions: { tone: 'concise' } })` saves the change,
    regenerates the chat system prompt (if not custom), and fires `onDidChange`.
  - `setActiveProfile('finance-focus')` switches the active profile and fires the event.
  - `createProfile('My Custom', 'default')` creates a clone of Default with a new ID.
  - `runPreviewTest('Hello!')` returns a non-empty string from the LLM.
  - Unit test: `tests/unit/aiSettingsService.test.ts`

---

### Task 1.4 — Register Service in DI

- **File:** `src/services/serviceTypes.ts` — add `IAISettingsService` identifier
- **File:** `src/workbench/workbenchServices.ts` — register the service instance
- Follow the existing pattern:
  ```typescript
  // serviceTypes.ts — add after ISessionManager
  export interface IAISettingsService extends IDisposable { ... }
  export const IAISettingsService = createServiceIdentifier<IAISettingsService>('IAISettingsService');

  // workbenchServices.ts — register after ILanguageModelsService
  services.registerInstance(IAISettingsService, new AISettingsService(storage, languageModelsService));
  ```
- The service must be registered after `ILanguageModelsService` (it depends on it) but
  before any UI that consumes settings.
- **Completion Criteria:** DI resolves `IAISettingsService` without error. Console shows
  `[AISettingsService] Loaded 3 profiles` on startup.

---

### Task 1.5 — Wire Chat Participant to Settings Service

- **File:** `src/built-in/chat/participants/defaultParticipant.ts`
- **File:** `src/built-in/chat/chatTypes.ts` — add `aiSettingsService` to `IDefaultParticipantServices`
- **File:** `src/built-in/chat/data/chatDataService.ts` — thread `aiSettingsService` through deps
- When building the system prompt in `defaultParticipant.ts`, use the AI settings profile
  to provide `promptOverlay` and `temperature`:
  ```typescript
  // In the prompt assembly section of defaultParticipant.ts:
  const aiProfile = services.aiSettingsService?.getActiveProfile();

  const promptContext: ISystemPromptContext = {
    workspaceName, pageCount, currentPageTitle, fileCount,
    isRAGAvailable, isIndexing,
    promptOverlay: aiProfile?.chat.systemPrompt,  // replaces PARALLX_IDENTITY
    workspaceDigest, tools
  };
  ```
- Temperature from the active profile passes through to `sendChatRequest()` options:
  ```typescript
  const requestOptions = {
    ...existingOptions,
    temperature: aiProfile?.model.temperature,
    maxTokens: aiProfile?.model.maxTokens || undefined,
  };
  ```
- **Note:** Existing chat sessions are not retroactively changed — only new messages
  after the change use the new system prompt.
- **Completion Criteria:** Changing tone to "Detailed" in the settings panel, then opening
  a new chat and asking "What is 2+2?" returns a noticeably more verbose response than
  with "Concise" tone.

---

### Task 1.6 — Wire Proactive Suggestions to Settings Service

- **File:** `src/services/proactiveSuggestionsService.ts`
- Subscribe to `IAISettingsService.onDidChange`.
- On change: read `profile.suggestions` and update the relevant thresholds:
  - `suggestionsEnabled` controls whether analysis runs at all
  - `suggestionConfidenceThreshold` maps to the internal cluster threshold
  - `maxPendingSuggestions` caps how many suggestions are surfaced
- **Completion Criteria:** Disabling `suggestionsEnabled` stops new suggestions from
  appearing. Raising the confidence threshold reduces suggestion frequency.

---

## Capability 2 — AI Settings Panel (UI)

### Description

The visual settings editor. Registered as a Parallx view through the contribution system.
Opens from the activity bar icon, command palette, and status bar click.

The design is VS Code-flavored: a left nav for sections, a search bar across the top,
and content that renders all section fields in a scrollable stack. Every field shows a
brief description below it. Every field has a reset-to-default button (appears on hover).

---

### Task 2.0 — Create Missing UI Primitives

- **Files:** `src/ui/slider.ts`, `src/ui/slider.css`, `src/ui/toggle.ts`, `src/ui/toggle.css`,
  `src/ui/dropdown.ts`, `src/ui/dropdown.css`, `src/ui/segmentedControl.ts`,
  `src/ui/segmentedControl.css`, `src/ui/textarea.ts`, `src/ui/textarea.css`
- These are required before any panel section can be built.
- Each component follows the project's `src/ui/` contract:
  - Extends `Disposable`
  - Constructor: `(container: HTMLElement, options?: TOptions)`
  - Co-located CSS with `ui-` prefix classes (e.g., `.ui-slider`, `.ui-toggle`)
  - Events via `Emitter<T>`, exposed as `readonly onDidChange: Event<T>`
  - All colors via `var(--vscode-*)` tokens with fallbacks
- **Slider:** `<input type="range">` wrapper. Options: `min`, `max`, `step`, `value`,
  `labeledStops?: Array<{ value: number; label: string }>`. Custom styled track + thumb.
- **Toggle:** On/off switch. Options: `checked`, `label`. Styled as a sliding oval.
- **Dropdown:** Single-select. Options: `items: Array<{ value: string; label: string }>`,
  `selected`. Renders as a button that opens a positioned list.
- **SegmentedControl:** Horizontal button bar where exactly one is active. Options:
  `segments: Array<{ value: string; label: string }>`, `selected`.
- **Textarea:** Multi-line text input. Options: `value`, `placeholder`, `rows`, `readonly`.
- **Completion Criteria:** Each component renders correctly in isolation. Unit test per
  component in `tests/unit/uiComponents.test.ts` (jsdom environment).

---

### Task 2.1 — Implement PresetSwitcher

- **File:** `src/aiSettings/ui/presetSwitcher.ts`
- Renders a vertical list of saved profiles. The active one has a filled indicator;
  others are plain. Built-in presets show a small "built-in" badge.
- **Controls:**
  - Click a profile → calls `aiSettingsService.setActiveProfile(id)`. List re-renders.
  - **[+ New Preset]** button → prompts for a name (using `InputBox` from `src/ui/`) →
    calls `createProfile(name)` → new item appears in list, selected.
  - Right-click a custom preset → ContextMenu with: **Rename**, **Duplicate**, **Delete**.
  - Right-click a built-in preset → ContextMenu with: **Duplicate** only.
- **Completion Criteria:** All five controls work. Deleting a custom profile returns the
  user to the Default preset. The UI immediately reflects the change.

---

### Task 2.2 — Implement Section Navigation & Panel Shell

- **File:** `src/aiSettings/ui/aiSettingsPanel.ts`
- The panel has two columns:
  - **Left (200px):** section nav at top + preset switcher below
  - **Right (flex):** search bar + scrollable section content
- **Sections (in order):**
  1. Persona
  2. Chat
  3. Suggestions
  4. Model
  5. Advanced
  6. Preview
- All sections are rendered and stacked vertically. The nav is a scroll shortcut (clicks
  smooth-scroll to the section header), not a page router. Users can see multiple sections.
- **Search bar:** filters visible settings in real time by label or description text.
  Non-matching fields are dimmed (lower opacity), not hidden. The user can always scroll
  to any section even with an active search query.
- **Completion Criteria:** All six sections render. Search "temperature" highlights the
  temperature slider. Search "suggestions" highlights the suggestion toggles.

---

### Task 2.3 — Implement Persona Section

- **File:** `src/aiSettings/ui/sections/personaSection.ts`
- **Fields:**

  | Field | Control | Description shown to user |
  |-------|---------|--------------------------|
  | Agent Name | InputBox | The name used in suggestion cards and chat headers |
  | Description | InputBox (short) | One-line description of this persona |
  | Avatar | IconPicker (12 emoji options) | Icon shown next to suggestions |

- Emoji options: 🧠 💼 ✍️ 💰 🔬 📊 🎯 🤖 🦊 🌊 ⚡ 🧩
- Uses existing `IconPicker` from `src/ui/iconPicker.ts`.
- Every field has a small reset icon (appears on hover) that resets that individual field
  to its value from `DEFAULT_PROFILE`.
- A section-level "Reset section to defaults" link at the bottom.
- **Completion Criteria:** Changing the agent name to "Friday" and saving shows "Friday"
  reflected in the profile data within 2 seconds.

---

### Task 2.4 — Implement Chat Section

- **File:** `src/aiSettings/ui/sections/chatSection.ts`
- **Fields:**

  | Field | Control | Notes |
  |-------|---------|-------|
  | Response Length | Dropdown: Short / Medium / Long / Adaptive | Adaptive = length matches question complexity |
  | Communication Tone | SegmentedControl: Concise / Balanced / Detailed | Shared with suggestions |
  | Domain Focus | Dropdown: General / Finance / Writing / Coding / Research / Custom | Shows custom text field when "Custom" selected |
  | Custom Focus | Textarea (only visible when Domain = Custom) | Describe what the AI should pay attention to |
  | Chat System Prompt | Collapsible Textarea (collapsed by default) | Labelled: "System Prompt (auto-generated)" |
  | Override System Prompt | Toggle | When on: textarea editable, `systemPromptIsCustom = true`. When off: prompt regenerates. |

- **Generated prompt display:** Below the main fields, a read-only preview box shows the
  effective system prompt, updating live as the user changes fields above.
  Label: `"Effective system prompt"`. A copy button lets the user copy it.
- **When Override is ON:** the textarea becomes editable. A warning shows:
  `"You're using a custom system prompt. Changes to Tone and Domain will not affect it."`
  with a link `"Revert to generated"` that turns Override off.
- **Completion Criteria:**
  - Changing tone from Balanced → Concise updates the effective prompt preview immediately.
  - Enabling Override and typing a custom prompt persists it. Turning Override off
    regenerates from the current tone/domain fields.

---

### Task 2.5 — Implement Suggestions Section

- **File:** `src/aiSettings/ui/sections/suggestionsSection.ts`
- **Fields:**

  | Field | Control | Default | Description |
  |-------|---------|---------|-------------|
  | Proactive Suggestions | Toggle | ON | Show suggestion cards |
  | Suggestion Confidence | Slider 0–100% | 65% | Min confidence to surface a suggestion |
  | Suggestion Backlog Limit | InputBox (number, 1–20) | 5 | Max cards visible at once |

- Under the Confidence slider: a plain-English tooltip that updates as the slider moves:
  - 0–40%: `"Very sensitive — many suggestions, some may be low quality"`
  - 41–70%: `"Balanced — good mix of frequency and quality"`
  - 71–90%: `"Selective — only high-confidence suggestions surface"`
  - 91–100%: `"Very selective — most signals will be silently ignored"`
- **Completion Criteria:**
  - Toggling "Proactive Suggestions" off persists the setting and fires `onDidChange`.
  - Moving Confidence slider from 65% to 85% persists correctly.

---

### Task 2.6 — Implement Model Section

- **File:** `src/aiSettings/ui/sections/modelSection.ts`
- **Fields:**

  | Field | Control | Default | Description |
  |-------|---------|---------|-------------|
  | Creativity / Temperature | Slider 0.0–1.0 with 5 labeled stops | 0.7 | Controls output randomness |
  | Max Response Tokens | InputBox (number, 0 = model default) | 0 | Hard cap on response length |
  | Context Window | InputBox (number, 0 = model default) | 0 | How much history the model sees |

- **Creativity slider labeled stops:**
  Five stops: Precise (0.0) · Focused (0.25) · Balanced (0.5) · Expressive (0.75) · Creative (1.0)
  Clicking a labeled stop snaps the slider to that value.
- Below the slider: `"Current value: 0.70"` shown as plain text, updating live.
- **Warning for max tokens:** If set below 200, show inline warning:
  `"Very low — the AI may truncate responses mid-sentence."`
- **Completion Criteria:** Dragging temperature to 0.0 and running a preview test returns
  a consistent response. Dragging to 1.0 produces more variation.

---

### Task 2.7 — Implement Advanced Section

- **File:** `src/aiSettings/ui/sections/advancedSection.ts`
- **Fields:**

  | Field | Control |
  |-------|---------|
  | Export Profile | Button: "Export as JSON" — downloads the active profile as `.json` |
  | Import Profile | File picker: accepts `.json`, validates against `AISettingsProfile`, imports as new custom profile |
  | Reset All | Danger button (red, confirmation dialog): resets active profile to factory defaults |
  | Generated Prompt Preview | Read-only Textarea showing the effective system prompt |

- Import validation: if the JSON is missing required fields, show a specific error:
  `"Invalid profile: missing field 'suggestions.tone'. Check the export format."`
  Missing fields that have defaults should be filled from `DEFAULT_PROFILE` (same logic
  as Task 3.3 health check).
- Export produces a file named `parallx-profile-{presetName}-{date}.json`.
- **Completion Criteria:** Export → edit → import round-trips cleanly. The imported
  profile appears in the preset switcher.

---

### Task 2.8 — Implement Preview Panel

- **File:** `src/aiSettings/ui/previewPanel.ts`
- **Purpose:** The user types a test message and sees how the AI responds with the current
  settings — before committing to a full chat session.
- **Layout:** Text input + Run button. Response area below. Metadata line showing active
  preset name, temperature, and tone.
- Three starter prompts as clickable chips: `"Hello, who are you?"` ·
  `"Summarize what you know about me."` · `"What would you suggest I do today?"`
- While waiting: spinner inside the response area.
- If the LLM call fails: error shown inline with a "Retry" button.
- **"Open in chat"** button creates a new chat session pre-seeded with the current
  system prompt and opens it in the main editor area.
- **Completion Criteria:**
  - Clicking Run with a starter prompt returns a response.
  - Changing tone and re-running shows a visibly different response style.
  - "Open in chat" creates a working chat session.

---

### Task 2.9 — Register Panel as a Parallx View

- **File:** `src/tools/builtinManifests.ts` — add `AI_SETTINGS_MANIFEST`
- **File:** `src/aiSettings/ui/aiSettingsPanel.ts` — `registerViewProvider()` call
- **File:** `src/workbench/workbench.ts` — register the tool
- Register using the same pattern as Explorer, Search, and other built-in tools:
  ```typescript
  // builtinManifests.ts
  export const AI_SETTINGS_MANIFEST: IToolManifest = {
    manifestVersion: 1,
    id: 'parallx.ai-settings',
    name: 'AI Settings',
    version: '1.0.0',
    publisher: 'parallx',
    description: 'Configure AI personality, behavior, and model settings.',
    main: './main.js',
    engines: { parallx: '^0.1.0' },
    activationEvents: ['onStartupFinished'],
    contributes: {
      commands: [
        { id: 'ai-settings.open', title: 'Parallx: Open AI Settings' },
      ],
      keybindings: [
        { command: 'ai-settings.open', key: 'Ctrl+Shift+A' },
      ],
      viewContainers: [
        { id: 'ai-settings-container', title: 'AI Settings', icon: '⚙', location: 'sidebar' },
      ],
      views: [
        { id: 'view.aiSettings', name: 'AI Settings', defaultContainerId: 'ai-settings-container' },
      ],
    },
  };
  ```
- Add a clickable status bar entry (right side): `⚙ AI: Default` that shows the active
  preset name and opens the panel on click. Uses `StatusBarEntry` from `serviceTypes.ts`.
- **Completion Criteria:**
  - Activity bar icon visible. Clicking it opens the settings panel.
  - `Ctrl+Shift+A` opens it from anywhere.
  - Status bar shows `⚙ AI: Default` (updates when preset changes).

---

## Capability 3 — Persistence & Change Propagation

### Description

Settings must survive app restarts and propagate instantly to all AI consumers.

---

### Task 3.1 — Storage Key Design

- All profiles stored under key `'ai-settings.profiles'` as a JSON array.
- Active profile ID stored under `'ai-settings.activeProfileId'`.
- These keys go through `IStorage` directly (same pattern as `ConfigurationService` which
  uses the `'config:'` prefix). No collision risk — the `ai-settings.` prefix is unique.
- **Never** store raw Ollama model names inside the settings profile — those come from
  `ILanguageModelsService` which is separately managed. The settings profile controls
  behavior (tone, temperature, prompt), not which model binary is loaded.
- **Completion Criteria:** Open app, change tone, close app, reopen app. Tone is still
  changed. Profile count is the same.

---

### Task 3.2 — Live Change Propagation

- `AISettingsService` fires `this._onDidChange.fire(profile)` after every successful write.
- `defaultParticipant.ts` and `ProactiveSuggestionsService` subscribe to this event
  (Tasks 1.5 and 1.6).
- Changes take effect on the **next** LLM call — no restart required.
- **Completion Criteria:** While Parallx is running, toggle "Concise" mode and immediately
  type a chat message. The response style changes.

---

### Task 3.3 — Settings Health Check on Startup

- On startup, `AISettingsService` validates loaded profiles against the current type schema.
  If a field is missing (e.g., a new field added in a code update), fill it from
  `DEFAULT_PROFILE` silently using deep merge.
- If the stored profile JSON is unparseable, reset to `BUILT_IN_PRESETS` and log a warning.
- **Completion Criteria:** Manually corrupt the stored JSON. App still opens. Warning
  appears in DevTools console. Three built-in presets are present.

---

## Capability 4 — Styling

### Description

The settings panel must feel like a native Parallx panel. It follows the same dark-theme
styling conventions as the rest of the workbench, using `var(--vscode-*)` tokens.

---

### Task 4.1 — Panel Base Styling

- **File:** `src/aiSettings/ui/aiSettings.css`
- Key style rules (all colors via `var(--vscode-*)` tokens):
  - Two-column layout: 200px nav + flex content
  - Section headers: `font-size: 11px; font-weight: 600; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); letter-spacing: 0.08em;`
  - Setting rows: `display: flex; flex-direction: column; padding: 8px 0;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));`
  - Setting label: `font-size: 13px; font-weight: 500; color: var(--vscode-foreground);`
  - Setting description: `font-size: 11px; color: var(--vscode-descriptionForeground);
    margin-top: 2px;`
  - Reset icon: appears on hover only (`opacity: 0` by default, `opacity: 1` on
    `.setting-row:hover`)
  - Active preset in switcher: `background: var(--vscode-list-activeSelectionBackground);`
- **Completion Criteria:** Panel looks consistent with the rest of the Parallx dark theme.

---

### Task 4.2 — Slider Styling

- Temperature and confidence sliders use the custom `Slider` component from Task 2.0.
- Track: thin line in `var(--vscode-widget-border)`.
  Fill left of thumb: `var(--vscode-focusBorder)`.
- Thumb: 14px circle, `var(--vscode-focusBorder)`, subtle shadow.
- Labeled stops (for temperature) render as tick marks below the track with labels.
- **Completion Criteria:** Sliders look consistent with the Parallx dark theme.
  Labeled stops are visible and clicking them snaps the slider.

---

## Implementation Order

Execute tasks in this exact order. Each group must be fully working and tested before
moving to the next group.

```
Group A — Foundation (must complete before any UI)
  Task 1.1  Types + Defaults
  Task 1.2  System Prompt Generator + unit test
  Task 1.3  AISettingsService (core: persist, load, emit events) + unit test
  Task 1.4  Register in DI (serviceTypes.ts + workbenchServices.ts)

Group B — Wiring (connect service layer to existing chat + suggestions)
  Task 1.5  Wire chat participant to settings service
  Task 1.6  Wire proactive suggestions to settings service

Group C — UI Primitives (must complete before panel sections)
  Task 2.0  Create Slider, Toggle, Dropdown, SegmentedControl, Textarea in src/ui/

Group D — Core UI (panel shell + all sections)
  Task 2.1  PresetSwitcher
  Task 2.2  Section Nav + Panel Shell
  Task 2.3  Persona Section
  Task 2.4  Chat Section
  Task 2.5  Suggestions Section
  Task 2.6  Model Section
  Task 2.7  Advanced Section (import/export, reset all)
  Task 2.8  Preview Panel
  Task 2.9  Register view + commands + status bar
  Task 4.1  Panel Base Styling
  Task 4.2  Slider Styling

Group E — Persistence & Validation
  Task 3.1  Storage key design audit
  Task 3.2  Live change propagation test
  Task 3.3  Settings health check on startup
```

**Do not implement the UI before the service layer.** The panel is useless without a
working `IAISettingsService` behind it.

---

## Common Pitfalls

**1. Storing model names in the settings profile.**
The settings profile controls *behavior* (tone, temperature, focus). It does not control
*which Ollama model* is loaded. Model selection is handled by `ILanguageModelsService`
and the model picker. Do not add `chatModel` or `agentModel` to `AISettingsProfile`.

**2. Not deep-merging `updateActiveProfile` patches.**
A patch of `{ suggestions: { tone: 'concise' } }` must not erase all other `suggestions`
fields. Use deep merge: `{ ...existing.suggestions, ...patch.suggestions }`.

**3. Regenerating the system prompt when `systemPromptIsCustom` is true.**
If the user has enabled Override and written a custom prompt, changing the tone slider
must NOT overwrite their custom prompt. Always check `systemPromptIsCustom` before calling
the generator.

**4. Modifying built-in presets.**
Any write to a profile where `isBuiltIn === true` must silently clone first. Built-in
presets are immutable reference points. Never mutate them in storage.

**5. The Preview Panel blocking the UI.**
`runPreviewTest` calls the LLM — it can take 5–15 seconds. This must be async and must
not freeze the UI. Show a spinner, keep the rest of the panel interactive.

**6. Not firing the change event.**
Every write path (`updateActiveProfile`, `setActiveProfile`, `resetSection`, `resetAll`)
must call `this._onDidChange.fire(updatedProfile)`. If even one path skips it, consumers
won't react to that change.

**7. Export/import breaking on new fields.**
The import validator must fill missing fields from `DEFAULT_PROFILE` (same health-check
logic as Task 3.3), not reject the file entirely. Old exports should still import cleanly.

**8. Search filtering hiding required fields.**
The search bar dims non-matching fields but should never fully hide them. The user must
always be able to scroll to any section even with an active search query.

**9. Using `eventBus.emit()` — does not exist.**
The codebase does NOT have an event bus. Use the `Emitter<T>` / `Event<T>` pattern.
`AISettingsService` owns `_onDidChange: Emitter<AISettingsProfile>` and exposes
`readonly onDidChange: Event<AISettingsProfile>`. Consumers call
`aiSettingsService.onDidChange((profile) => { ... })`.

**10. Using `--parallx-*` CSS variables — they don't exist.**
All CSS colors must use `var(--vscode-*)` tokens. The codebase uses the VS Code color
registry (`colorRegistry.ts`) which generates `--vscode-*` custom properties.

---

## Success Criteria

All of the following must be true for the core milestone to be complete:

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | AI Settings panel opens from Activity Bar | Click the icon |
| 2 | AI Settings panel opens from `Ctrl+Shift+A` | Keyboard shortcut |
| 3 | Status bar shows active preset name | Visual inspection |
| 4 | Three built-in presets present on first launch | Open Preset Switcher |
| 5 | Changing tone to Concise produces shorter chat responses | Chat after change |
| 6 | Changing tone to Detailed produces longer chat responses | Chat after change |
| 7 | Changing tone updates Effective system prompt preview live | Watch preview box |
| 8 | Temperature slider change affects LLM creativity | Preview test at 0.0 vs 1.0 |
| 9 | Creating a new preset clones the active profile | Create → inspect fields |
| 10 | Deleting a custom preset returns to Default | Delete → check active |
| 11 | Built-in presets cannot be deleted | Try to delete — option absent |
| 12 | Export → import round-trips cleanly | Export, edit name, import |
| 13 | Preview Panel runs LLM test and shows response | Click Run |
| 14 | "Open in chat" creates a working chat session | Click button |
| 15 | Settings persist across app restart | Change setting, close, reopen |
| 16 | Corrupted storage resets gracefully to defaults | Manually corrupt JSON |
| 17 | Search "temperature" highlights the temperature slider | Type in search bar |
| 18 | Modifying a built-in preset clones it automatically | Edit Default preset |
| 19 | All new UI primitives render correctly | Visual + unit tests |
| 20 | `tsc --noEmit` passes, `npx vitest run` all green | CI check |

---

## Deferred Capabilities (Post-Core)

The following capabilities are scoped but deferred until the core (Capabilities 1–4) is
stable and tested. They should be implemented in follow-up work after the core ships.

---

### Capability 5 — Ollama Model Manager

Users can list installed models, switch which model is active, pull new models with a
live progress bar, and delete models — all without a terminal.

**Task 5.1** — Implement `OllamaModelService` (talks to `/api/tags`, `/api/pull`, `/api/delete`, `/api/ps`, `/api/show`)
**Task 5.2** — Implement Model Manager Section UI (active model selector, installed table, pull interface)
**Task 5.3** — Ollama offline warning banner

---

### Capability 6 — Per-Workspace AI Settings

Workspace-level overrides in `.parallx/ai-settings.json` that merge onto the global
profile. Mirrors VS Code's User Settings < Workspace Settings pattern.

**Task 6.1** — Define `WorkspaceAIOverride` type (already in types file)
**Task 6.2** — Load and merge workspace overrides in `AISettingsService`
**Task 6.3** — Workspace section UI with override badges

---

### Capability 7 — Preset Sharing Hub

Import presets by URL. Export as shareable JSON. Static gallery of curated community presets.

**Task 7.1** — Import preset by URL
**Task 7.2** — Export / share preset
**Task 7.3** — Featured community presets gallery

---

### Capability 8 — AI-Assisted Prompt Builder

A wizard that interviews the user and calls the LLM to generate a polished system prompt.

**Task 8.1** — Prompt Builder wizard UI (4-step modal)
**Task 8.2** — `runPromptBuilder(answers: PromptBuilderAnswers)` implementation
**Task 8.3** — Wire "Help me write this" links in Chat and Suggestions sections

---

### Capability 9 — Per-Observer Fine-Grained Settings

Per-observer overrides so each suggestion source can have different confidence thresholds.

**Task 9.1** — Define `ObserverSettings` type
**Task 9.2** — Apply per-observer settings in `ProactiveSuggestionsService`
**Task 9.3** — Per-observer settings UI (collapsible sub-section)

---

### Capability 10 — Cloud Sync

Opt-in export/import via a user-chosen sync folder (Dropbox, OneDrive, etc.).

**Task 10.1** — Implement `SyncService`
**Task 10.2** — Sync settings UI

---

### Capability 11 — Appearance & Theme Settings

Basic appearance controls: color scheme, density, font size, accent color.

**Task 11.1** — Define `AppearanceSettings` type
**Task 11.2** — Apply appearance CSS variables to workbench
**Task 11.3** — Appearance section UI

---

## Notes for the Implementing Agent

**Run the pre-implementation protocol.** The `grep` commands at the top of this document
will confirm the integration points before writing any code.

**The system prompt generator is the product.** The most important function in this
milestone is `generateChatSystemPrompt()`. A user who sets "Concise + Finance + Short
response" must get a radically different AI experience than "Detailed + Writing + Long
response." Test both extremes manually before moving on.

**Service first, UI second.** `IAISettingsService` must fully work (including persisting,
reloading, and emitting events) before building any UI. The UI is a thin skin over the
service.

**Follow the existing view contribution pattern precisely.** Look at `EXPLORER_MANIFEST`
in `builtinManifests.ts` and `registerViewProvider()` in `src/built-in/explorer/main.ts`.
Replicate this exact pattern.

**Use `ILanguageModelsService` for all Ollama communication.** Do NOT call Ollama HTTP
endpoints directly from `AISettingsService`. The existing `ILanguageModelsService` +
`OllamaProvider` handle all model communication. Use them.

**The panel must be scrollable, not paginated.** All sections stack vertically. The nav
is a scroll shortcut, not a page router. Users often want to see multiple sections at once.

**Every setting needs a reset icon.** It must appear on hover for every individual field.
"Reset to default" means reset just that field to the `DEFAULT_PROFILE` value, not the
whole section. Make this granular.

**Use `var(--vscode-*)` tokens for all colors.** Check `src/theme/colorRegistry.ts` for
available tokens. Common ones: `--vscode-foreground`, `--vscode-editor-background`,
`--vscode-input-background`, `--vscode-input-border`, `--vscode-focusBorder`,
`--vscode-descriptionForeground`, `--vscode-list-activeSelectionBackground`,
`--vscode-widget-border`.

**Create UI primitives in `src/ui/` first.** Slider, Toggle, Dropdown, SegmentedControl,
and Textarea must exist as reusable components before building the sections. They may be
used by other panels in the future — they are not AI-settings-specific.
