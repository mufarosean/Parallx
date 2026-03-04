# Milestone 15 — AI Personality & Behavior Settings

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 15.
> All implementation must conform to the structures and boundaries defined here.
> Milestones 1–14 established the workbench shell, tool system, local AI chat, and the
> proactive agent (Parallx Mind). This milestone adds a first-class settings UI so the user
> can change how all AI in Parallx thinks, speaks, and behaves — **without ever touching
> code or config files directly.**

---

## Mandatory Pre-Implementation Protocol

> **Read the codebase before writing anything.** Every assumption made without reading
> the source will produce integration failures. Run all of the following before Task 1.1.

```bash
# 1. Understand what AI config already exists
grep -r "agentConfig\|AGENT_CONFIG\|agentModel\|systemPrompt\|system_prompt" src/ --include="*.ts" -l
grep -r "temperature\|tickInterval\|suggestionThreshold" src/ --include="*.ts"

# 2. Find the M13 chat config
grep -r "chatModel\|chat_model\|ollamaModel" src/ --include="*.ts"
cat src/agent/agentConfig.ts 2>/dev/null

# 3. Find the existing settings/storage system (M1 Memento/storage)
grep -r "IStorageService\|storageService\|IMemento\|memento" src/ --include="*.ts" -l

# 4. Find the settings view if one already exists
find src/ -name "*settings*" -o -name "*preference*" | grep -v node_modules | head -20

# 5. Find how M2 contributes views and commands
grep -r "contributes\|viewsContainers\|registerCommand" src/ --include="*.ts" -l | head -10

# 6. Find the DI container registration pattern
grep -r "registerSingleton\|registerService\|bind\b" src/services/ --include="*.ts" | head -20
```

> After running the above: if a `SettingsService` or `IStorageService` already exists,
> **use it**. Do not create a parallel persistence mechanism. If an existing settings panel
> exists from a prior milestone, extend it rather than creating a new one.

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

Every AI behavior in Parallx — the chat assistant, the proactive agent (Parallx Mind), and
future AI surfaces — is configurable through a dedicated **AI Settings panel**. The panel
looks and feels like VS Code's Settings editor: grouped sections, a search bar, human-readable
labels, and immediate effect on saving. No config file editing. No restarting the app.

The user can:
- Change the agent's name and avatar
- Pick a communication tone (Concise / Balanced / Detailed)
- Set a domain focus (Finance, Writing, General, etc.)
- Adjust creativity/temperature with a labeled slider (Precise → Creative)
- Write or override the full system prompt for both the chat model and Parallx Mind
- Create, save, and switch named **Persona Presets** ("Default", "Focused Finance", "Creative Brainstorm")
- Toggle individual agent capabilities (enable/disable canvas observation, suggestion notifications, etc.)
- Preview what the current settings produce with a live test prompt
- Reset any individual setting or the entire profile to factory defaults

### What This Is Not

- It is NOT an Ollama model downloader or model switcher (that's a separate future milestone)
- It is NOT a full appearance/theme editor (deferred)
- It is NOT multi-user or role-based (single user in M15)

### Background — What Already Exists

- **M14 `AGENT_CONFIG`** in `src/agent/agentConfig.ts` — hardcoded constants today
- **M13 chat system** — uses its own model config, likely also hardcoded
- **M1 `IStorageService`** — workspace persistence layer; this is what the new settings service will use
- **M2 view contribution system** — how the new settings panel registers itself
- **M2 command registry** — how "Parallx: AI Settings" command is registered

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
│  │                 │  │  🔍 Search settings...                │  │
│  │  ▸ Persona       │  │                                      │  │
│  │  ▸ Chat          │  │  ── Persona ─────────────────────── │  │
│  │  ▸ Parallx Mind  │  │  Name: [Parallx Mind        ]       │  │
│  │  ▸ Advanced      │  │  Tone: [ Balanced ▼ ]               │  │
│  │  ▸ Presets       │  │  Focus: [ General ▼ ]               │  │
│  │                 │  │  Creativity: |──●────| Balanced      │  │
│  └─────────────────┘  │                                      │  │
│                        │  ── Chat ────────────────────────── │  │
│  ┌─────────────────┐  │  System Prompt: [textarea]           │  │
│  │  PRESET SWITCHER │  │  Response Length: [ Medium ▼ ]      │  │
│  │                 │  │                                      │  │
│  │  ● Default       │  │  ── Parallx Mind ──────────────── │  │
│  │  ○ Finance Focus │  │  [✓] Canvas observation            │  │
│  │  ○ Creative Mode │  │  [✓] Proactive suggestions         │  │
│  │  [+ New Preset]  │  │  Tick interval: [30] seconds       │  │
│  └─────────────────┘  │                                      │  │
│                        │  ── Preview ──────────────────────  │  │
│                        │  [Test: "Hello, who are you?"] [▶] │  │
│                        │  Response: ...                      │  │
│                        └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User changes a setting
        │
        ▼
AISettingsPanel (UI) calls IAISettingsService.set(key, value)
        │
        ▼
AISettingsService persists via IStorageService (M1)
        │
        ├──▶ Emits event: 'ai-settings:changed' on event bus (M1)
        │
        ├──▶ AgentRuntimeService (M14) listens → reloads AGENT_CONFIG live
        │
        └──▶ ChatService (M13) listens → reloads chat system prompt live
```

No app restart needed. Settings take effect immediately.

---

## TypeScript Types

**File:** `src/aiSettings/aiSettingsTypes.ts`

```typescript
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
  /** Display name shown in the UI and in suggestions (e.g. "Parallx Mind") */
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
   * Maps directly to Ollama's `temperature` parameter
   */
  temperature: number;
  /** Max tokens per response (0 = model default) */
  maxTokens: number;
  /** Context window size override (0 = model default) */
  contextWindow: number;
}

export interface AIAgentSettings {
  /** Friendly tone for proactive suggestions */
  tone: AITone;
  /** Domain the agent pays extra attention to */
  focusDomain: AIFocusDomain;
  /** If focusDomain === 'custom', this free-text field describes it */
  customFocusDescription: string;
  /** Seconds between agent background ticks */
  tickIntervalSeconds: number;
  /** Minimum confidence 0–1 to surface a suggestion */
  suggestionConfidenceThreshold: number;
  /** Whether canvas text observation is active */
  canvasObservationEnabled: boolean;
  /** Whether proactive suggestion cards are shown */
  suggestionsEnabled: boolean;
  /** Whether clarification cards (ASK_USER) are enabled */
  clarificationsEnabled: boolean;
  /** Max suggestion cards in the tray at once */
  maxPendingSuggestions: number;
  /**
   * The planning system prompt injected into the agent's reasoning.
   * Generated from tone/focus settings, but overrideable.
   */
  agentSystemPrompt: string;
  agentSystemPromptIsCustom: boolean;
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
  agent: AIAgentSettings;
  createdAt: number;
  updatedAt: number;
}

// ─── Service Interface ─────────────────────────────────────────────────────

export interface IAISettingsService {
  /** Get the currently active profile */
  getActiveProfile(): AISettingsProfile;

  /** Get a specific profile by ID */
  getProfile(id: string): AISettingsProfile | undefined;

  /** List all saved profiles */
  getAllProfiles(): AISettingsProfile[];

  /** Switch the active profile — fires 'ai-settings:changed' */
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
  resetSection(section: keyof Omit<AISettingsProfile, 'id' | 'presetName' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>): Promise<void>;

  /** Reset the entire active profile to factory defaults */
  resetAll(): Promise<void>;

  /** Generate a system prompt string from the current friendly settings */
  generateSystemPrompt(settings: AIAgentSettings & AIChatSettings): string;

  /** Test: send a single message to the chat model and return the response */
  runPreviewTest(userMessage: string): Promise<string>;

  /** Subscribe to settings changes */
  onDidChange(listener: (profile: AISettingsProfile) => void): IDisposable;
}

// ─── Utility ───────────────────────────────────────────────────────────────

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
```

---

## Factory Defaults

**File:** `src/aiSettings/aiSettingsDefaults.ts`

```typescript
import { AISettingsProfile } from './aiSettingsTypes';

export const DEFAULT_PROFILE: AISettingsProfile = {
  id: 'default',
  presetName: 'Default',
  isBuiltIn: true,
  persona: {
    name: 'Parallx Mind',
    description: 'Your intelligent workspace assistant',
    avatarEmoji: '🧠',
  },
  chat: {
    systemPrompt: generateSystemPromptFromDefaults(),
    systemPromptIsCustom: false,
    responseLength: 'adaptive',
  },
  model: {
    temperature: 0.7,
    maxTokens: 0,       // model default
    contextWindow: 0,   // model default
  },
  agent: {
    tone: 'balanced',
    focusDomain: 'general',
    customFocusDescription: '',
    tickIntervalSeconds: 30,
    suggestionConfidenceThreshold: 0.65,
    canvasObservationEnabled: true,
    suggestionsEnabled: true,
    clarificationsEnabled: true,
    maxPendingSuggestions: 5,
    agentSystemPrompt: generateAgentPromptFromDefaults(),
    agentSystemPromptIsCustom: false,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

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
    agent: {
      ...DEFAULT_PROFILE.agent,
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
    agent: {
      ...DEFAULT_PROFILE.agent,
      tone: 'detailed',
      focusDomain: 'writing',
    },
  },
];
```

---

## System Prompt Generator

**File:** `src/aiSettings/systemPromptGenerator.ts`

This is a critical piece. The friendly UI controls (tone, focus, response length) generate
a proper system prompt string automatically. The user never has to write a prompt unless
they want to — but they always can.

```typescript
import { AIAgentSettings, AIChatSettings, AITone, AIFocusDomain, AIResponseLength } from './aiSettingsTypes';

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

export function generateChatSystemPrompt(settings: AIChatSettings & { tone: AITone; focusDomain: AIFocusDomain; customFocusDescription: string }): string {
  const focusLine = settings.focusDomain === 'custom'
    ? `Pay particular attention to: ${settings.customFocusDescription}.`
    : FOCUS_INSTRUCTIONS[settings.focusDomain];

  const parts = [
    `You are a helpful, intelligent assistant embedded in the Parallx workspace.`,
    TONE_INSTRUCTIONS[settings.tone],
    LENGTH_INSTRUCTIONS[settings.responseLength],
    focusLine,
  ].filter(Boolean);

  return parts.join('\n');
}

export function generateAgentSystemPrompt(settings: AIAgentSettings): string {
  const focusLine = settings.focusDomain === 'custom'
    ? `Focus area: ${settings.customFocusDescription}.`
    : FOCUS_INSTRUCTIONS[settings.focusDomain];

  const toneGuide: Record<AITone, string> = {
    concise:  'Keep suggestion messages brief — one sentence max. No preamble.',
    balanced: 'Write suggestion messages that are clear and natural. Two sentences max.',
    detailed: 'Suggestion messages may include brief context. Up to three sentences.',
  };

  return [
    `You are Parallx Mind, an autonomous background assistant.`,
    toneGuide[settings.tone],
    focusLine,
    `Confidence threshold: ${settings.suggestionConfidenceThreshold}. Below this, prefer ASK_USER or NO_ACTION.`,
  ].filter(Boolean).join('\n');
}
```

---

## File Structure

All new files go in `src/aiSettings/`. The executing AI must use this exact layout.

```
src/
└── aiSettings/
    ├── aiSettingsTypes.ts          # All types and IAISettingsService interface
    ├── aiSettingsDefaults.ts       # DEFAULT_PROFILE and BUILT_IN_PRESETS
    ├── aiSettingsService.ts        # IAISettingsService implementation
    ├── systemPromptGenerator.ts    # generateChatSystemPrompt / generateAgentSystemPrompt
    └── ui/
        ├── aiSettingsPanel.ts      # Main panel — registered as a Parallx view
        ├── sections/
        │   ├── personaSection.ts   # Name, description, emoji avatar
        │   ├── chatSection.ts      # Response length, chat system prompt editor
        │   ├── agentSection.ts     # Tone, focus, tick interval, toggles
        │   ├── modelSection.ts     # Temperature slider, token limits
        │   └── advancedSection.ts  # Raw system prompt overrides, JSON export
        ├── presetSwitcher.ts       # Preset list + create/delete/rename
        └── previewPanel.ts         # Live test prompt → response
```

---

## Capability 1 — AI Settings Service

### Description
The persistence backbone. Reads and writes AI settings profiles using M1's `IStorageService`.
Emits change events so all consumers (agent, chat) react immediately without a restart.

---

### Task 1.1 — Define Types and Defaults
- **Files:** `src/aiSettings/aiSettingsTypes.ts`, `src/aiSettings/aiSettingsDefaults.ts`
- Copy the types exactly from the Types section above.
- `DEFAULT_PROFILE` defines the factory state every fresh installation starts with.
- The three built-in presets (Default, Finance Focus, Creative Mode) are always present
  and cannot be deleted.
- **Completion Criteria:** Both files compile with zero errors. All downstream files
  import types only from `aiSettingsTypes.ts`.

---

### Task 1.2 — Implement System Prompt Generator
- **File:** `src/aiSettings/systemPromptGenerator.ts`
- Implement `generateChatSystemPrompt()` and `generateAgentSystemPrompt()` exactly as
  shown in the System Prompt Generator section above.
- **The generator is the bridge between the friendly UI and the raw LLM instruction.**
  When the user moves the tone slider from "Balanced" to "Concise", only this function
  is called — the user never needs to know what words end up in the prompt.
- Add a third function: `generateSystemPromptPreview(profile: AISettingsProfile): { chatPrompt: string; agentPrompt: string }` that generates both prompts and returns them for display.
- **Completion Criteria:** For each of the three built-in presets, calling `generateChatSystemPrompt()` produces a non-empty, sensible string. Write a unit test with three assertions.

---

### Task 1.3 — Implement AISettingsService
- **File:** `src/aiSettings/aiSettingsService.ts`
- Persists to M1's `IStorageService` under the key `'ai-settings.profiles'` (JSON array
  of `AISettingsProfile`) and `'ai-settings.activeProfileId'` (string).
- On construction: load persisted profiles from storage; if none exist, seed with
  `BUILT_IN_PRESETS`.
- Key rules:
  - Built-in presets (`isBuiltIn: true`) can never be deleted.
  - Updating a built-in preset's settings silently clones it to a new profile named
    `"${presetName} (Modified)"` and switches active to that clone. The original stays clean.
  - `updateActiveProfile(patch)` merges the patch deeply, then calls
    `generateChatSystemPrompt()` / `generateAgentSystemPrompt()` unless the corresponding
    `*IsCustom` flag is `true`.
  - Every write fires `eventBus.emit('ai-settings:changed', updatedProfile)`.
- **`runPreviewTest` implementation:**
  ```typescript
  async runPreviewTest(userMessage: string): Promise<string> {
    const profile = this.getActiveProfile();
    // Use the M13 Ollama client (find it in the codebase before implementing)
    const response = await ollama.chat({
      model: AGENT_CONFIG.agentModel,  // or chat model — check M13 config
      messages: [
        { role: 'system', content: profile.chat.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      options: {
        temperature: profile.model.temperature,
        num_ctx: profile.model.contextWindow || undefined,
        num_predict: profile.model.maxTokens || undefined,
      },
      stream: false,
    });
    return response.message.content;
  }
  ```
- **Completion Criteria:**
  - On first launch: three built-in presets in storage, active profile is "Default".
  - `updateActiveProfile({ agent: { tone: 'concise' } })` saves the change, regenerates
    the agent system prompt (if not custom), and fires the change event.
  - `setActiveProfile('finance-focus')` switches the active profile and fires the event.
  - `createProfile('My Custom', 'default')` creates a clone of Default with a new ID.
  - `runPreviewTest('Hello!')` returns a non-empty string from the LLM.

---

### Task 1.4 — Register Service in DI
- **File:** `src/services/serviceCollection.ts` (or wherever M1/M2 DI registration lives)
- Register `IAISettingsService` → `AISettingsService` using the same pattern as M2.
- The service must be available before the agent runtime starts.
- **Completion Criteria:** DI resolves `IAISettingsService` without error. Console shows
  `[AISettingsService] Loaded 3 profiles` (or however many exist) on startup.

---

### Task 1.5 — Wire Agent Runtime to Settings Service
- **File:** `src/agent/agentRuntimeService.ts` (M14)
- Subscribe to `'ai-settings:changed'` on the event bus.
- On change: read the new profile from `IAISettingsService.getActiveProfile()`, update
  `AGENT_CONFIG` in memory, specifically:
  - `temperature` from `profile.model.temperature`
  - `tickIntervalMs` from `profile.agent.tickIntervalSeconds * 1000`
  - `suggestionThreshold` from `profile.agent.suggestionConfidenceThreshold`
  - `maxPendingSuggestions` from `profile.agent.maxPendingSuggestions`
  - The planning system prompt used in `PlanningPrompt.build()`
  - Observer enable/disable flags (`canvasObservationEnabled`, `suggestionsEnabled`)
- **Completion Criteria:** Changing tone to "Concise" in the UI and waiting 5 seconds
  shows the next suggestion card using a shorter message style. Disabling canvas
  observation in the UI stops canvas-triggered suggestions immediately.

---

### Task 1.6 — Wire Chat Service to Settings Service
- **File:** Find the M13 chat service (grep for `ollama.chat` or the chat session manager)
- Subscribe to `'ai-settings:changed'`.
- On change: update the in-memory system prompt used for all new chat turns.
- **Note:** Existing chat sessions are not retroactively changed — only new messages after
  the change will use the new system prompt.
- **Completion Criteria:** Changing tone to "Detailed" in the settings panel, then opening
  a new chat and asking "What is 2+2?" returns a noticeably more verbose response than
  with "Concise" tone.

---

## Capability 2 — AI Settings Panel (UI)

### Description
The visual settings editor. Registered as a Parallx view panel using M2's contribution
system. Opens from the activity bar icon, command palette, and status bar click.

The design is deliberately VS Code-flavored: a left nav for sections, a search bar across
the top, and content that renders the relevant form fields when a section is active.
Every field shows a brief description below it. Every field has a reset-to-default button.

---

### Task 2.1 — Implement PresetSwitcher
- **File:** `src/aiSettings/ui/presetSwitcher.ts`
- Renders a vertical list of saved profiles. The active one has a filled dot (●); others
  have hollow dots (○). Built-in presets show a small "built-in" badge.
- **Controls:**
  - Click a profile → calls `aiSettingsService.setActiveProfile(id)`. List re-renders.
  - **[+ New Preset]** button → prompts for a name (using the M2 `InputBox` pattern) →
    calls `createProfile(name)` → new item appears in list, selected.
  - Right-click / three-dot menu on a custom preset → options: **Rename**, **Duplicate**, **Delete**.
  - Right-click on a built-in preset → options: **Duplicate** only.
- **Completion Criteria:** All five controls work. Deleting a custom profile returns the
  user to the Default preset. The UI immediately reflects the change.

---

### Task 2.2 — Implement Section Navigation
- **File:** `src/aiSettings/ui/aiSettingsPanel.ts`
- The panel has two columns:
  - **Left (200px):** section nav + preset switcher
  - **Right (flex):** search bar + active section content
- **Sections (in order):**
  1. Persona
  2. Chat
  3. Parallx Mind
  4. Model
  5. Advanced
  6. Preview
- Clicking a section in the nav scrolls the content to that section header (smooth scroll),
  VS Code-style — all sections are rendered and stacked; the nav is just a scroll shortcut.
- **Search bar:** filters visible settings in real time by label or description text.
  If the search query matches a setting in a non-visible section, that section expands
  automatically. Results outside the query are dimmed, not hidden.
- **Completion Criteria:** All six sections render. Search "temperature" highlights the
  temperature slider. Search "canvas" highlights the canvas toggle.

---

### Task 2.3 — Implement Persona Section
- **File:** `src/aiSettings/ui/sections/personaSection.ts`
- **Fields:**

  | Field | Control | Description shown to user |
  |-------|---------|--------------------------|
  | Agent Name | Text input | The name used in suggestion cards and chat headers |
  | Description | Text input (short) | One-line description of this persona |
  | Avatar | Emoji picker (12 emoji options + text fallback) | Icon shown next to suggestions |

- Emoji options: 🧠 💼 ✍️ 💰 🔬 📊 🎯 🤖 🦊 🌊 ⚡ 🧩
- Every field has a small reset (↺) icon that calls `resetSection('persona')` for that
  field only. A section-level "Reset section to defaults" link appears at the bottom.
- **Completion Criteria:** Changing the agent name to "Friday" and saving shows "Friday"
  in the suggestion tray's header within 2 seconds.

---

### Task 2.4 — Implement Chat Section
- **File:** `src/aiSettings/ui/sections/chatSection.ts`
- **Fields:**

  | Field | Control | Notes |
  |-------|---------|-------|
  | Response Length | Dropdown: Short / Medium / Long / Adaptive | Adaptive = length matches question complexity |
  | Communication Tone | Segmented button: Concise / Balanced / Detailed | Also affects agent suggestions |
  | Domain Focus | Dropdown: General / Finance / Writing / Coding / Research / Custom | Shows custom text field when "Custom" selected |
  | Custom Focus | Text area (only visible when Domain = Custom) | Describe what the AI should pay extra attention to |
  | Chat System Prompt | Collapsible textarea (collapsed by default) | Labelled: "System Prompt (auto-generated)" |
  | Override System Prompt | Toggle switch | When on, textarea becomes fully editable and `systemPromptIsCustom` = true. When off, prompt regenerates from fields above. |

- **Generated prompt display:** Below the main fields, a read-only preview box shows the
  system prompt that will be used, updating live as the user changes fields above.
  Label: `"Effective system prompt"`. A copy icon lets the user copy it.
- **When Override is ON:** the textarea becomes white/editable. A yellow warning strip
  shows: `"You're using a custom system prompt. Changes to Tone and Domain will not affect it."` with a link `"Revert to generated"` that turns Override off.
- **Completion Criteria:**
  - Changing tone from Balanced → Concise updates the "Effective system prompt" preview
    immediately.
  - Enabling Override and typing a custom prompt persists it. Turning Override off
    regenerates from the current tone/domain fields.

---

### Task 2.5 — Implement Parallx Mind Section
- **File:** `src/aiSettings/ui/sections/agentSection.ts`
- **Fields:**

  | Field | Control | Default | Description |
  |-------|---------|---------|-------------|
  | Proactive Suggestions | Toggle | ON | Show suggestion cards in the Parallx Mind tray |
  | Clarification Questions | Toggle | ON | Allow agent to ask clarifying questions (ASK_USER) |
  | Canvas Observation | Toggle | ON | Watch document text for signals |
  | Suggestion Confidence | Slider 0–100% | 65% | Min confidence before a suggestion appears. Lower = more suggestions. Higher = fewer, better ones. |
  | Suggestion Backlog Limit | Number input (1–20) | 5 | Max cards in tray at once |
  | Background Check Interval | Segmented: 15s / 30s / 60s / 5min | 30s | How often Parallx Mind scans for signals |
  | Agent System Prompt | Collapsible textarea + Override toggle | auto | Same pattern as Chat Section |

- Under the Confidence slider: a plain-English tooltip that updates as the slider moves:
  - 0–40%: `"Very sensitive — you'll see many suggestions, some may be low quality"`
  - 41–70%: `"Balanced — good mix of frequency and quality"`
  - 71–90%: `"Selective — only high-confidence suggestions surface"`
  - 91–100%: `"Very selective — most signals will be silently ignored"`
- **Completion Criteria:**
  - Toggling "Proactive Suggestions" off immediately stops new cards appearing in the tray.
  - Moving Confidence slider from 65% to 85% visibly reduces card frequency (test by
    running the mock email server from M14).

---

### Task 2.6 — Implement Model Section
- **File:** `src/aiSettings/ui/sections/modelSection.ts`
- **Fields:**

  | Field | Control | Default | Description |
  |-------|---------|---------|-------------|
  | Creativity / Temperature | Slider 0.0–1.0 with 5 labeled stops | 0.7 | Controls output randomness |
  | Max Response Tokens | Number input (0 = model default) | 0 | Hard cap on response length in tokens |
  | Context Window | Number input (0 = model default) | 0 | How much conversation history the model can see |

- **Creativity slider labeled stops:**
  ```
  |─────●─────────────|
  Precise  Balanced   Creative
  (0.0)    (0.5–0.7)  (1.0)
  ```
  Five stops: Precise (0.0) · Focused (0.25) · Balanced (0.5) · Expressive (0.75) · Creative (1.0)
  Clicking a labeled stop snaps the slider to that value.
- Below the slider: `"Current value: 0.70"` shown as plain text, updating live.
- **Warning for max tokens:** If set below 200, show inline warning: `"Very low — the AI may truncate responses mid-sentence."`
- **Completion Criteria:** Dragging temperature to 0.0 and running a preview test returns
  a noticeably consistent response. Dragging to 1.0 and re-running returns more variation.

---

### Task 2.7 — Implement Advanced Section
- **File:** `src/aiSettings/ui/sections/advancedSection.ts`
- This section is for users who want full control. It surfaces raw levers that the
  friendly sections hide.
- **Fields:**

  | Field | Control |
  |-------|---------|
  | Export Profile | Button: "Export as JSON" — downloads current profile as `.json` |
  | Import Profile | File picker: accepts `.json`, validates against `AISettingsProfile` schema, imports as new custom profile |
  | Reset All | Dangerous button (red, confirmation dialog): resets active profile to factory defaults |
  | Generated Prompt Preview | Read-only: shows both chat and agent system prompts side by side |

- Import validation: if the JSON is missing required fields, show a specific error
  message: `"Invalid profile: missing field 'agent.tone'. Check the export format."`.
- Export produces a file named `parallx-profile-{presetName}-{date}.json`.
- **Completion Criteria:** Export → edit → import round-trips cleanly. The imported
  profile appears in the preset switcher.

---

### Task 2.8 — Implement Preview Panel
- **File:** `src/aiSettings/ui/previewPanel.ts`
- **Purpose:** The user can type a test message and instantly see how the AI responds
  with the current settings — before committing or switching to a full chat session.
- **Layout:**
  ```
  ── Preview ───────────────────────────────────────────────
  [Test message: Hello, who are you?         ] [▶ Run]
  ─────────────────────────────────────────────────────────
  Response:
  Hi! I'm Parallx Mind — your workspace assistant...
  ─────────────────────────────────────────────────────────
  Using: Default preset · temperature 0.70 · tone: balanced
  [Copy response]  [Open in chat]
  ```
- The test box has three starter prompts as clickable chips (so the user doesn't need to
  type just to test): `"Hello, who are you?"` · `"Summarize what you know about me."` ·
  `"What would you suggest I do today?"`
- While waiting for the response: show a subtle spinner inside the response box.
- If the LLM call fails: show the error inline with a "Retry" button.
- **"Open in chat"** button creates a new chat session pre-seeded with the current system
  prompt and opens it in the main editor area.
- **Completion Criteria:**
  - Clicking "Run" with the default starter prompt returns a response within the model's
    normal latency.
  - Changing tone to "Concise" and re-running shows a visibly shorter response.
  - "Open in chat" creates a working chat session.

---

### Task 2.9 — Register Panel as a Parallx View
- **File:** `src/aiSettings/ui/aiSettingsPanel.ts` (contribution declaration)
- Register as a view in the Parallx Activity Bar using M2's contribution system:
  ```json
  {
    "contributes": {
      "viewsContainers": {
        "activitybar": [{
          "id": "parallx-ai-settings",
          "title": "AI Settings",
          "icon": "$(settings-gear)"
        }]
      },
      "views": {
        "parallx-ai-settings": [{
          "id": "ai-settings-view",
          "name": "AI Settings"
        }]
      }
    }
  }
  ```
- Register command `Parallx: Open AI Settings` in the M2 command registry.
  Bind to keyboard shortcut `Ctrl+Shift+A` (Windows/Linux) / `Cmd+Shift+A` (Mac).
- Add a clickable entry in the status bar (right side, next to the Parallx Mind indicator
  from M14): `⚙ AI: Default` that shows the active preset name and opens the panel on click.
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
- These keys must be namespaced to avoid collision with M1/M2 keys.
- **Never** store raw Ollama model names inside the settings profile — those come from
  `AGENT_CONFIG` which is separately configured. The settings profile controls behavior,
  not which model binary is loaded.
- **Completion Criteria:** Open app, change tone, close app, reopen app. Tone is still
  changed. Profile count is the same.

---

### Task 3.2 — Live Change Propagation
- `AISettingsService` fires `eventBus.emit('ai-settings:changed', profile)` after every
  successful write.
- `AgentRuntimeService` and `ChatService` both subscribe to this event (Tasks 1.5 and 1.6).
- Changes must take effect on the **next** LLM call — not requiring restart.
- **Completion Criteria:** While Parallx is running, toggle "Concise" mode and immediately
  type a chat message. The response is noticeably shorter than before the change.

---

### Task 3.3 — Settings Health Check on Startup
- On startup, `AISettingsService` validates the loaded profiles against the current type
  schema. If a field is missing (e.g., a new field added in a code update), fill it from
  `DEFAULT_PROFILE` silently.
- If the stored profile JSON is unparseable, reset to `BUILT_IN_PRESETS` and log a warning.
- **Completion Criteria:** Manually corrupt the stored JSON. App still opens. Warning
  appears in DevTools console. Three built-in presets are present.

---

## Capability 4 — Styling

### Description
The settings panel must feel like a native Parallx panel, not a hacked-in settings page.
It follows the same dark-theme styling conventions as the rest of the workbench.

---

### Task 4.1 — Panel Base Styling
- **File:** `src/aiSettings/ui/aiSettings.css` (or inline in the component — match the
  convention already used in M3's panel components)
- Key style rules:
  - Two-column layout: 200px nav + flex content
  - Section headers: `font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--parallx-color-foreground-muted); letter-spacing: 0.08em;`
  - Setting rows: `display: flex; flex-direction: column; padding: 8px 0; border-bottom: 1px solid var(--parallx-border-subtle);`
  - Setting label: `font-size: 13px; font-weight: 500; color: var(--parallx-color-foreground);`
  - Setting description: `font-size: 11px; color: var(--parallx-color-foreground-muted); margin-top: 2px;`
  - Reset icon: appears on hover only (`opacity: 0` by default, `opacity: 1` on `.setting-row:hover`)
  - Active preset in switcher: `background: var(--parallx-color-accent-muted);`

---

### Task 4.2 — Slider Styling
- Temperature and confidence sliders use a custom-styled HTML `<input type="range">` —
  not the browser default.
- Track: thin line in `var(--parallx-border)`. Fill left of thumb: `var(--parallx-color-accent)`.
- Thumb: 14px circle, `var(--parallx-color-accent)`, subtle shadow.
- Labeled stops (for temperature) render as tick marks below the track with labels.
- **Completion Criteria:** Sliders look consistent with the rest of the Parallx dark theme.
  Labeled stops are visible and clicking them snaps the slider.

---

## Implementation Order

Execute tasks in this exact order:

```
Task 1.1 (Types + Defaults)
  └─▶ Task 1.2 (System Prompt Generator)
        └─▶ Task 1.3 (AISettingsService — full implementation)
              └─▶ Task 1.4 (Register in DI)
                    └─▶ Task 1.5 (Wire to Agent Runtime)
                    └─▶ Task 1.6 (Wire to Chat Service)
                          └─▶ Task 2.1 (PresetSwitcher — simplest UI piece)
                                └─▶ Task 2.2 (Section Nav + Panel Shell)
                                      └─▶ Task 2.3 (Persona Section)
                                      └─▶ Task 2.4 (Chat Section)
                                      └─▶ Task 2.5 (Parallx Mind Section)
                                      └─▶ Task 2.6 (Model Section)
                                      └─▶ Task 2.7 (Advanced Section)
                                      └─▶ Task 2.8 (Preview Panel)
                                            └─▶ Task 2.9 (Register view + commands)
                                                  └─▶ Task 3.1 (Storage key design)
                                                  └─▶ Task 3.2 (Live propagation test)
                                                  └─▶ Task 3.3 (Health check)
                                                        └─▶ Task 4.1 (Styling)
                                                        └─▶ Task 4.2 (Slider styling)
```

**Do not implement the UI before the service layer.** The panel is useless without a
working `IAISettingsService` behind it.

---

## Common Pitfalls

**1. Storing model names in the settings profile.**
The settings profile controls *behavior* (tone, temperature, focus). It does not control
*which Ollama model* is loaded. Model selection is a separate concern handled by
`AGENT_CONFIG`. Do not add `agentModel` to `AISettingsProfile`.

**2. Not deep-merging `updateActiveProfile` patches.**
A patch of `{ agent: { tone: 'concise' } }` must not erase all other `agent` fields.
Use deep merge: `{ ...existing.agent, ...patch.agent }`.

**3. Regenerating the system prompt when `*IsCustom` is true.**
If the user has enabled Override and written a custom prompt, changing the tone slider
must NOT overwrite their custom prompt. Always check the `*IsCustom` flag before calling
the generator.

**4. Modifying built-in presets.**
Any write to a profile where `isBuiltIn === true` must silently clone first. Built-in
presets are immutable reference points. Never mutate them in storage.

**5. The Preview Panel blocking the UI.**
`runPreviewTest` calls the LLM — it can take 5–15 seconds. This must be async and must
not freeze the UI. Show a spinner, keep the rest of the panel interactive.

**6. Not firing the change event.**
Every write path (updateActiveProfile, setActiveProfile, resetSection, resetAll) must call
`eventBus.emit('ai-settings:changed', ...)`. If even one path skips it, the agent runtime
won't react to that change.

**7. Export/import breaking on new fields.**
The import validator must fill missing fields from `DEFAULT_PROFILE` (same health-check
logic as Task 3.3), not reject the file entirely. Old exports should still import cleanly.

**8. Search filtering hiding required fields.**
The search bar dims non-matching fields but should never fully hide them. The user must
always be able to scroll to any section even with an active search query.

---

## Success Criteria

All of the following must be true for the milestone to be complete:

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | AI Settings panel opens from Activity Bar | Click the icon |
| 2 | AI Settings panel opens from `Ctrl+Shift+A` | Keyboard shortcut |
| 3 | Status bar shows active preset name | Visual inspection |
| 4 | Three built-in presets present on first launch | Open Preset Switcher |
| 5 | Changing tone to Concise produces shorter chat responses | Chat after change |
| 6 | Changing tone to Detailed produces longer chat responses | Chat after change |
| 7 | Changing tone updates the Effective system prompt preview live | Watch preview box |
| 8 | Temperature slider change affects LLM creativity | Run preview test twice at 0.0, twice at 1.0 |
| 9 | Disabling canvas observation stops canvas cards | Toggle off, type in canvas |
| 10 | Disabling suggestions stops all suggestion cards | Toggle off, run mock email |
| 11 | Creating a new preset clones the active profile | Create → inspect fields |
| 12 | Deleting a custom preset returns to Default | Delete → check active |
| 13 | Built-in presets cannot be deleted | Try to delete — button absent or blocked |
| 14 | Export → import round-trips cleanly | Export, edit name, import |
| 15 | Preview Panel runs LLM test and shows response | Click [▶ Run] |
| 16 | "Open in chat" creates a working chat session | Click button, chat works |
| 17 | Settings persist across app restart | Change setting, close, reopen |
| 18 | Corrupted storage resets gracefully to defaults | Manually corrupt JSON |
| 19 | Search "canvas" highlights the canvas toggle | Type in search bar |
| 20 | Modifying a built-in preset clones it automatically | Edit Default preset |

---

## Capability 5 — Ollama Model Manager

### Description
Users should never need to open a terminal to pull, switch, or delete a local model.
This section adds a **Model Manager** tab inside the AI Settings panel that talks directly
to Ollama's REST API (`http://localhost:11434`). It shows installed models, lets the user
switch which model Parallx uses for chat and for the agent, pull new models with a live
progress bar, and delete models to free disk space.

Key Ollama API endpoints used:
- `GET  /api/tags`  — list installed models with size, family, quantization
- `POST /api/pull`  — stream-download a model; response is NDJSON with `{ status, total, completed }`
- `DELETE /api/delete` — remove a model by name
- `GET  /api/ps`    — list models currently loaded in GPU/CPU memory
- `POST /api/show`  — get details for a specific model (parameter count, context length, license)

---

### Task 5.1 — Implement OllamaModelService
- **File:** `src/aiSettings/ollamaModelService.ts`
- Interface:
  ```typescript
  interface IOllamaModelService {
    listInstalled(): Promise<OllamaModel[]>;
    listRunning(): Promise<OllamaRunningModel[]>;
    getDetails(name: string): Promise<OllamaModelDetails>;
    pull(name: string, onProgress: (p: PullProgress) => void): Promise<void>;
    cancelPull(name: string): void;
    delete(name: string): Promise<void>;
    isOllamaRunning(): Promise<boolean>;
  }

  interface OllamaModel {
    name: string;          // e.g. "qwen3:8b"
    size: number;          // bytes
    family: string;        // e.g. "llama", "qwen"
    parameterSize: string; // e.g. "8B"
    quantization: string;  // e.g. "Q4_K_M"
    modifiedAt: string;
  }

  interface PullProgress {
    status: string;
    total: number;
    completed: number;
    percent: number;       // 0–100, computed
  }
  ```
- Pull is implemented by streaming the NDJSON response from `/api/pull` and calling
  `onProgress` after parsing each line. Track in-flight pulls by model name so the UI
  can show progress or cancel.
- **Completion Criteria:** `listInstalled()` returns at least one model (the one already
  powering M13/M14). `pull('smollm2:135m', ...)` downloads a tiny model and fires
  progress events. `delete()` removes it and it disappears from `listInstalled()`.

---

### Task 5.2 — Implement Model Manager Section UI
- **File:** `src/aiSettings/ui/sections/modelManagerSection.ts`
- This section has two sub-areas:

  **A. Active Model Selector**
  Two dropdowns, both populated from `listInstalled()`:
  - `Chat model:` — the model used for M13 chat sessions
  - `Agent model:` — the model used by Parallx Mind (M14)
  These can be the same model or different ones. Changing either fires
  `'ai-settings:changed'` so the respective services reload immediately.
  Below each dropdown: one line of model metadata —
  `"qwen3:8b · 5.2 GB · Q4_K_M · 8B params"`.

  **B. Installed Models Table**
  Columns: Name · Size · Family · Params · Quantization · In Memory · Actions
  - **In Memory:** a green dot (●) if the model is currently loaded in GPU/CPU (`/api/ps`),
    grey dot otherwise.
  - **Actions column:** Delete button (🗑) with confirmation dialog.
    If this model is the currently active chat or agent model, show a warning:
    `"This model is in use. Deleting it will fall back to the first available model."`

  **C. Pull New Model**
  A search/text field at the bottom labelled `"Pull a model from Ollama library"`.
  Below the field: a row of quick-pick chip buttons for the most useful models:
  `qwen3:8b` · `llama3.2:3b` · `mistral:7b` · `phi4-mini` · `nomic-embed-text`
  Clicking a chip fills the field. Clicking **Pull** starts the download.

  **Download progress row** (appears while pulling):
  ```
  ↓ qwen3:8b   [████████░░░░░░░░░░░░]  42%  1.2 GB / 2.8 GB   [✕ Cancel]
  ```
  Multiple concurrent downloads are each shown as their own row.
  On completion: row turns green briefly, then the model appears in the table.

- **Completion Criteria:**
  - Switching active chat model in the dropdown and sending a chat message uses the
    new model within 2 seconds of switching.
  - Pulling a model shows a live progress bar updating every ~500ms.
  - Deleting a non-active model removes it from the table.

---

### Task 5.3 — Ollama Offline Warning
- If `isOllamaRunning()` returns false, the entire Model Manager section renders a
  banner instead of the table:
  ```
  ⚠ Ollama is not running.
  Start it with: ollama serve
  [Retry connection]
  ```
- The [Retry] button calls `isOllamaRunning()` again and refreshes the section.
- **Completion Criteria:** With Ollama stopped, the banner appears. Starting Ollama and
  clicking Retry shows the model table.

---

## Capability 6 — Per-Workspace AI Settings

### Description
Some AI behaviors should differ by project. A coding project might want "Coding" focus
and high precision (temperature 0.2). A writing project might want "Detailed" tone and
higher creativity (temperature 0.8). The global profile handles the default, but a
workspace-level override lets each open folder customize just the fields that differ.

The pattern mirrors VS Code exactly: **Global (user) settings < Workspace override**.
Only the fields the workspace explicitly overrides are different; everything else inherits
from the active global profile.

---

### Task 6.1 — Define Workspace Override Type
- **File:** `src/aiSettings/aiSettingsTypes.ts` (add to existing file)
  ```typescript
  /**
   * A sparse patch of AISettingsProfile fields.
   * Only the fields present here override the global active profile.
   * Stored in .parallx/ai-settings.json inside the workspace root.
   */
  export type WorkspaceAIOverride = DeepPartial<
    Pick<AISettingsProfile, 'chat' | 'model' | 'agent'>
  > & {
    /** Human label shown in the status bar when override is active */
    label?: string;
  };
  ```
- **Completion Criteria:** Type compiles. A valid minimal override is
  `{ label: "Finance Project", agent: { focusDomain: "finance" } }`.

---

### Task 6.2 — Load and Merge Workspace Overrides
- **File:** `src/aiSettings/aiSettingsService.ts` (extend existing)
- On startup (and whenever the active workspace changes), check for
  `.parallx/ai-settings.json` in the workspace root.
- If found: deep-merge the override onto the active global profile to produce the
  **effective profile**. The effective profile is what all consumers (chat, agent) actually see.
- The global profile stored in `IStorageService` is never mutated by workspace overrides.
- `AISettingsService.getActiveProfile()` always returns the effective (merged) profile.
- `AISettingsService.getGlobalProfile()` returns the un-merged global profile (needed by
  the UI to show which fields are overridden).
- Fire `'ai-settings:changed'` when the workspace override is loaded or unloaded.
- **Completion Criteria:** Create `.parallx/ai-settings.json` with
  `{ "agent": { "focusDomain": "coding" } }` in a test workspace. Open the workspace.
  The AI Settings panel Parallx Mind section shows `"Coding"` in the Domain Focus dropdown,
  with a small `[workspace]` badge next to it.

---

### Task 6.3 — Workspace Override UI
- **File:** `src/aiSettings/ui/sections/workspaceSection.ts` (new section, added to nav)
  Add a **"Workspace"** section to the settings nav, between "Advanced" and "Preview".

  Layout:
  ```
  ── Workspace ────────────────────────────────────────
  Workspace:  ~/projects/my-finance-app

  Workspace override:  [✓ Active]   [Edit .parallx/ai-settings.json]

  Overridden fields:
    agent.focusDomain  →  "coding"   [global: "general"]
    model.temperature  →  0.2        [global: 0.7]

  [Clear all workspace overrides]
  ─────────────────────────────────────────────────────
  No workspace open? Workspace overrides are disabled.
  ```
- Each overridden field shows: field name, workspace value, and what the global value
  would be in grey.
- **[Edit .parallx/ai-settings.json]** opens the file in the Parallx text editor (or
  system default if not available).
- **[Clear all workspace overrides]** deletes the file (with confirmation).
- Fields overridden by workspace are shown with a `[workspace]` badge in their respective
  sections (Persona, Chat, Parallx Mind, Model). This visual indicator appears regardless
  of which section the user is in — it's global across the panel.
- **Completion Criteria:** The Workspace section correctly lists all overridden fields.
  The `[workspace]` badge appears on overridden fields in other sections. Clearing
  overrides removes all badges and reverts all values to global.

---

## Capability 7 — Preset Sharing Hub

### Description
Users can publish their custom presets to a lightweight community sharing system and
import presets shared by others via URL. This requires no server infrastructure —
presets are JSON files that can be shared via any URL (GitHub Gist, Pastebin, direct
file hosting, etc.). The "hub" is simply the ability to import-by-URL and a curated
list of featured community presets bundled with the app.

---

### Task 7.1 — Import Preset by URL
- **File:** `src/aiSettings/aiSettingsService.ts` (add method)
  ```typescript
  importPresetFromUrl(url: string): Promise<AISettingsProfile>;
  ```
- Fetches the URL, validates the response as a valid `AISettingsProfile` JSON
  (same validation as Task 2.7 file import), sets `isBuiltIn = false` and assigns
  a new UUID.
- Error handling: network failure, invalid JSON, schema mismatch — each shows a specific
  inline error.
- **Completion Criteria:** A valid preset JSON hosted at any accessible URL imports
  cleanly and appears in the preset switcher.

---

### Task 7.2 — Export Preset as Shareable Link
- **File:** `src/aiSettings/ui/presetSwitcher.ts` (add to three-dot menu)
- Add **"Share preset..."** to the context menu of any custom preset.
- Opens a dialog:
  ```
  ── Share "Finance Focus" ─────────────────────────
  Your preset has been copied to the clipboard as JSON.
  To share it:
  1. Paste the JSON into a GitHub Gist (gist.github.com)
     or any public file host.
  2. Share the raw file URL.
  3. Anyone can import it via: AI Settings → Advanced → Import from URL

  [Copy JSON to clipboard]   [Open GitHub Gist ↗]
  ─────────────────────────────────────────────────
  ```
- **Completion Criteria:** Clicking "Share preset..." copies valid JSON to clipboard.
  Pasting into a new file and importing it back via URL round-trips cleanly.

---

### Task 7.3 — Featured Community Presets Gallery
- **File:** `src/aiSettings/ui/sections/gallerySection.ts` (new section, added after Presets)
- A small curated gallery of presets bundled with the app (hardcoded JSON, not
  requiring network access):
  ```
  ── Preset Gallery ──────────────────────────────────
  Discover community presets. Click any to preview, then install.

  [🎓 Academic Researcher]  [🛠 Senior Engineer]  [📣 Marketing Writer]
  [🔍 Fact Checker]         [💬 Casual Companion]  [⚖️ Devil's Advocate]

  Or import by URL: [https://...               ] [Import]
  ─────────────────────────────────────────────────────
  ```
- Clicking a gallery card shows a preview panel:
  - Preset name, description, key settings (tone, focus, temperature)
  - The full generated system prompt (read-only)
  - **[Install as custom preset]** button — clones into the user's preset list
- **Bundled preset JSON lives in** `src/aiSettings/communityPresets.ts` — a static
  TypeScript array of `AISettingsProfile` objects so no network call is needed.
- **Completion Criteria:** All six gallery cards render. Clicking "Install" adds the
  preset to the switcher. Import-by-URL works from this section.

---

## Capability 8 — AI-Assisted Prompt Builder

### Description
Writing a system prompt from scratch is hard for non-technical users. This capability
adds a **Prompt Builder wizard** that interviews the user with a series of short
questions and then calls the local LLM to generate a polished system prompt.

The output is written into the raw system prompt field with `*IsCustom = true`, as if
the user had typed it themselves. The wizard is accessible via a **"Help me write this"**
link next to both the chat and agent system prompt textareas.

---

### Task 8.1 — Implement Prompt Builder Wizard UI
- **File:** `src/aiSettings/ui/promptBuilder.ts`
- The wizard is a modal overlay (or a slide-in panel from the right) that walks through
  four steps. Each step is a single question with a short answer field or select.

  **Step 1 — Role**
  > "What role should the AI play?"
  > Quick picks: `Assistant` · `Expert Advisor` · `Tutor` · `Writing Partner` · `Code Reviewer` · `Custom`
  > If Custom: free text field.

  **Step 2 — Audience**
  > "Who will it be talking to?"
  > Quick picks: `Just me` · `My team` · `Customers` · `Students`
  > + optional free text: "Any details about them?"

  **Step 3 — Expertise**
  > "What topics should it know deeply?"
  > Multi-select chips: Finance · Software · Writing · Science · Law · Marketing · Design · Other
  > + optional free text for "Other".

  **Step 4 — Constraints**
  > "Any rules it should always follow?"
  > Examples shown as placeholder: "Always cite sources · Never use jargon · Keep responses under 3 sentences"
  > Free text area.

- After Step 4: a **[Generate prompt]** button calls `runPromptBuilder()` (Task 8.2).
- While generating: spinner with label `"Thinking..."`
- When done: shows generated prompt in a read-only preview with two actions:
  - **[Use this prompt]** — writes into the system prompt field, sets `*IsCustom = true`, closes wizard
  - **[Regenerate]** — calls `runPromptBuilder()` again

---

### Task 8.2 — Implement runPromptBuilder
- **File:** `src/aiSettings/aiSettingsService.ts` (add method)
  ```typescript
  async runPromptBuilder(answers: PromptBuilderAnswers): Promise<string>
  ```
- Constructs a meta-prompt and calls the active chat model via Ollama:
  ```typescript
  const metaPrompt = `You are an expert at writing AI system prompts.
  Write a concise, effective system prompt for an AI assistant with these characteristics:
  - Role: ${answers.role}
  - Audience: ${answers.audience} (${answers.audienceDetails})
  - Expertise areas: ${answers.expertiseAreas.join(', ')}
  - Constraints: ${answers.constraints}

  Return ONLY the system prompt text. No explanation, no preamble.
  Write it in second person ("You are..."). Keep it under 200 words.`;

  const response = await ollama.chat({
    model: activeProfile.model.chatModel,
    messages: [{ role: 'user', content: metaPrompt }],
    options: { temperature: 0.7 },
    stream: false,
  });
  return response.message.content.trim();
  ```
- **Completion Criteria:** Completing all four wizard steps and clicking Generate returns
  a coherent system prompt that reflects the answers. The prompt is written into the
  system prompt field when "Use this prompt" is clicked.

---

### Task 8.3 — Wire "Help me write this" Links
- In `chatSection.ts` and `agentSection.ts`, add a small link below the system prompt
  textarea: `✨ Help me write this`
- Clicking it opens the Prompt Builder wizard pre-configured for the respective context
  (chat vs agent context sets slightly different meta-prompt framing).
- **Completion Criteria:** Both links open the wizard. Wizard output correctly populates
  the respective system prompt field.

---

## Capability 9 — Per-Observer Fine-Grained Settings

### Description
M14 has three observers: `DataObserver` (email/transactions), `CanvasObserver` (document
text), and `ContextObserver` (clipboard/recent files). Each observer currently shares
the same global agent settings. This capability adds per-observer overrides so the user
can tune each one independently — for example, keeping DataObserver at high confidence
(fewer suggestions) while CanvasObserver is more permissive (catches more writing ideas).

---

### Task 9.1 — Define Per-Observer Override Type
- **File:** `src/aiSettings/aiSettingsTypes.ts` (extend)
  ```typescript
  export interface ObserverSettings {
    enabled: boolean;
    confidenceThreshold: number;   // overrides agent.suggestionConfidenceThreshold
    tone: AITone;                  // overrides agent.tone for this observer's suggestions
    maxSuggestionsPerTick: number; // how many signals this observer can surface per tick
  }

  // Add to AIAgentSettings:
  observerOverrides: {
    data: Partial<ObserverSettings>;
    canvas: Partial<ObserverSettings>;
    context: Partial<ObserverSettings>;
  };
  ```
- Fields in `observerOverrides` that are `undefined` fall back to the global agent settings.
- **Completion Criteria:** Type compiles. The default profile's `observerOverrides` has all
  three keys with empty objects `{}` (full inheritance from global).

---

### Task 9.2 — Apply Per-Observer Settings in Agent Runtime
- **File:** `src/agent/agentRuntimeService.ts` (M14)
- When each observer fires a signal, resolve its effective settings:
  ```typescript
  function resolveObserverSettings(
    observerKey: 'data' | 'canvas' | 'context',
    profile: AISettingsProfile
  ): ObserverSettings {
    const global = profile.agent;
    const override = profile.agent.observerOverrides[observerKey];
    return {
      enabled: override.enabled ?? global[`${observerKey}ObservationEnabled`] ?? true,
      confidenceThreshold: override.confidenceThreshold ?? global.suggestionConfidenceThreshold,
      tone: override.tone ?? global.tone,
      maxSuggestionsPerTick: override.maxSuggestionsPerTick ?? 2,
    };
  }
  ```
- Pass the resolved settings into the observer so it can apply them during reasoning.
- **Completion Criteria:** Setting DataObserver confidence to 0.90 while CanvasObserver
  stays at 0.65 produces noticeably fewer data suggestions but the same canvas suggestion
  frequency.

---

### Task 9.3 — Per-Observer Settings UI
- **File:** `src/aiSettings/ui/sections/agentSection.ts` (extend Task 2.5)
- Below the global Parallx Mind settings, add a collapsible sub-section:
  `▸ Per-observer fine-tuning` (collapsed by default)

  When expanded, shows a three-tab or accordion layout — one per observer:
  **Data Observer** · **Canvas Observer** · **Context Observer**

  Each observer panel has:
  | Field | Control | Default |
  |-------|---------|---------|
  | Enabled | Toggle | ON (inherits global) |
  | Confidence threshold | Slider 0–100% | — (shows "Inheriting global: 65%") |
  | Suggestion tone | Segmented: Concise / Balanced / Detailed | — (shows "Inheriting global: Balanced") |
  | Max signals per tick | Number 1–10 | 2 |

  When a field inherits from global (not overridden), it shows its current effective value
  in grey with label `"(global)"`. Clicking the field activates override mode for just that
  field.
- **Completion Criteria:** Overriding DataObserver confidence to 90% shows `[observer]`
  badge on that field. The global confidence slider is unaffected.

---

## Capability 10 — Cloud Sync

### Description
Settings profiles should follow the user across machines. Cloud sync is implemented as
an **opt-in export/import via a user-chosen sync file** — Parallx writes a single JSON
file to a user-designated folder (e.g. their Dropbox, iCloud Drive, OneDrive, or any
network share) and reads from it on startup. This is deliberately simple: no
authentication, no proprietary cloud API, no new server. The user just points Parallx
at a folder they already sync.

---

### Task 10.1 — Implement SyncService
- **File:** `src/aiSettings/syncService.ts`
  ```typescript
  interface ISyncService {
    getSyncFolderPath(): string | null;
    setSyncFolderPath(path: string): Promise<void>;
    clearSyncFolder(): Promise<void>;
    exportNow(): Promise<void>;
    importNow(): Promise<void>;
    getLastSyncTime(): Date | null;
    isSyncEnabled(): boolean;
    onSyncComplete(listener: () => void): IDisposable;
  }
  ```
- Sync file format: `parallx-settings-sync.json` inside the chosen folder.
  Contents: `{ version: 1, profiles: AISettingsProfile[], activeProfileId: string, exportedAt: string }`.
- `exportNow()`: write the current `AISettingsService` state to the sync file.
- `importNow()`: read the sync file, validate, merge profiles into local storage
  (conflict resolution: **remote wins** — the imported file's profiles replace local
  ones with the same ID; local-only profiles are kept).
- Auto-export: after every `'ai-settings:changed'` event, schedule a debounced export
  (500ms debounce, so rapid changes don't cause file thrashing).
- Auto-import on startup: if a sync folder is configured and the sync file is newer than
  the last import time, import automatically before the app finishes booting.
- **Completion Criteria:**
  - Configure sync folder → make a settings change → check folder for `parallx-settings-sync.json`.
  - Modify the file manually → restart app → change appears in settings.

---

### Task 10.2 — Sync Settings UI
- **File:** `src/aiSettings/ui/sections/syncSection.ts` (new section, added after Workspace)

  Layout when sync is **disabled**:
  ```
  ── Cloud Sync ──────────────────────────────────────
  Keep your AI settings consistent across all your machines.
  Parallx syncs via a folder you already use (Dropbox, iCloud,
  OneDrive, or any shared drive). No account needed.

  [Choose sync folder...]
  ─────────────────────────────────────────────────────
  ```

  Layout when sync is **enabled**:
  ```
  ── Cloud Sync ──────────────────────────────────────
  ✓ Sync enabled
  Folder: ~/Dropbox/Parallx                [Change] [Disable]
  Last synced: 2 minutes ago              [Sync now]
  Profiles synced: 4

  ⚠ Conflict resolution: remote wins.
    Local-only presets are always kept.
  ─────────────────────────────────────────────────────
  ```

- **[Choose sync folder...]** opens a native folder picker dialog (via Electron's
  `dialog.showOpenDialog` or the M1 equivalent).
- **[Sync now]** calls `exportNow()` then `importNow()` and shows a brief
  `"Synced ✓"` confirmation.
- **Completion Criteria:** Choosing a folder saves the path. Settings change → file
  appears in folder within 1 second. Modifying the JSON file externally → clicking
  "Sync now" → the change appears in the preset switcher.

---

## Capability 11 — Appearance & Theme Settings

### Description
Parallx's color theme and UI density should be configurable without touching config files.
This is a focused Appearance section — not a full theming engine, but the most commonly
wanted controls: color scheme, panel density, font size, and accent color.

---

### Task 11.1 — Define AppearanceSettings Type
- **File:** `src/aiSettings/aiSettingsTypes.ts` (add)
  ```typescript
  export type ColorScheme = 'dark' | 'light' | 'system';
  export type UIDensity  = 'compact' | 'comfortable' | 'spacious';

  export interface AppearanceSettings {
    colorScheme: ColorScheme;
    uiDensity: UIDensity;
    /** Base font size for the workbench UI in px (12–18) */
    fontSize: number;
    /** Accent color as a hex string e.g. "#4a9eff" */
    accentColor: string;
    /** Whether the Parallx Mind tray is shown by default */
    agentTrayVisible: boolean;
  }
  ```
- Appearance settings are **global only** — no workspace override.
- Stored in `IStorageService` under key `'appearance.settings'`, separate from AI profiles.
- Fire `'appearance:changed'` event on the event bus after every write.
- **Completion Criteria:** Type compiles. Default values: dark, comfortable, 13px, "#4a9eff", tray visible.

---

### Task 11.2 — Apply Appearance Settings to the Workbench
- **File:** `src/workbench.ts` (or wherever M1/M2 applies CSS variables)
- Subscribe to `'appearance:changed'`. On change, apply CSS variables to the root element:
  ```typescript
  document.documentElement.style.setProperty('--parallx-font-size-base', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--parallx-color-accent', settings.accentColor);
  document.documentElement.dataset.colorScheme = settings.colorScheme;
  document.documentElement.dataset.density = settings.uiDensity;
  ```
- For `colorScheme: 'system'`: use `window.matchMedia('(prefers-color-scheme: dark)')` to
  detect and apply the OS preference, and re-apply if the OS preference changes.
- For `uiDensity`: add a data attribute to `<body>` that CSS selectors key off:
  - `compact`: reduce padding by ~30%, smaller line heights
  - `comfortable`: current defaults (no change needed)
  - `spacious`: increase padding by ~30%, larger line heights
- **Completion Criteria:** Changing color scheme to "Light" immediately switches the
  workbench to light mode. Changing density to "Compact" visibly reduces panel padding.
  Font size 16px makes all workbench text noticeably larger.

---

### Task 11.3 — Implement Appearance Section UI
- **File:** `src/aiSettings/ui/sections/appearanceSection.ts`
- Add as the **first section** in the settings nav (above Persona). Appearance is
  something users want to change first; put it where they'll find it immediately.

  | Field | Control | Default |
  |-------|---------|---------|
  | Color Scheme | Segmented: Dark / Light / System | Dark |
  | UI Density | Segmented: Compact / Comfortable / Spacious | Comfortable |
  | Font Size | Slider 12–18px with labels: Small (12) · Default (13) · Large (16) · XL (18) | 13 |
  | Accent Color | 8 color swatches + hex input | #4a9eff |
  | Agent Tray | Toggle: Show Parallx Mind tray | ON |

  **Color swatches** (8 options):
  `#4a9eff` (Blue) · `#a78bfa` (Purple) · `#34d399` (Green) · `#fb923c` (Orange) ·
  `#f87171` (Red) · `#facc15` (Yellow) · `#22d3ee` (Cyan) · `#f472b6` (Pink)
  Selecting a swatch fills the hex input. The hex input accepts any valid 6-digit hex.

  All changes apply **instantly** (live preview) — no save button needed.
  A **[Reset appearance to defaults]** link at the bottom.

- **Completion Criteria:** All five controls work. Changes are instant. Resetting
  restores all five fields to defaults. Settings survive app restart.

---

## Updated Implementation Order

Execute all tasks in this order. Do not proceed to the next group until the current
group is fully working and tested.

```
Group A — Foundation (must complete before any UI)
  Task 1.1  Types + Defaults
  Task 1.2  System Prompt Generator
  Task 1.3  AISettingsService (core: persist, load, emit events)
  Task 1.4  Register in DI
  Task 5.1  OllamaModelService
  Task 11.1 AppearanceSettings type
  Task 10.1 SyncService
  Task 6.1  WorkspaceOverride type

Group B — Wiring (connect service layer to existing M13/M14)
  Task 1.5  Wire to Agent Runtime
  Task 1.6  Wire to Chat Service
  Task 6.2  Load and merge workspace overrides
  Task 9.1  Per-observer override type
  Task 9.2  Apply per-observer settings in agent runtime
  Task 11.2 Apply appearance settings to workbench

Group C — Core UI (panel shell + first three sections)
  Task 2.1  PresetSwitcher
  Task 2.2  Section Nav + Panel Shell
  Task 11.3 Appearance Section (place first in nav)
  Task 2.3  Persona Section
  Task 2.4  Chat Section (includes Help me write this link — Task 8.3)
  Task 2.5  Parallx Mind Section (includes per-observer sub-section — Task 9.3)
  Task 2.6  Model Section
  Task 4.1  Panel Base Styling
  Task 4.2  Slider Styling

Group D — Extended UI sections
  Task 5.2  Model Manager Section
  Task 5.3  Ollama Offline Warning
  Task 6.3  Workspace Override Section + badges
  Task 7.3  Gallery Section (bundles community presets)
  Task 10.2 Sync Section
  Task 2.7  Advanced Section (import/export, reset all)
  Task 2.8  Preview Panel
  Task 2.9  Register view + commands + status bar

Group E — Advanced features
  Task 7.1  Import preset by URL
  Task 7.2  Export / share preset
  Task 8.1  Prompt Builder Wizard UI
  Task 8.2  runPromptBuilder implementation
  Task 8.3  Wire "Help me write this" links

Group F — Validation and polish
  Task 3.1  Storage key design audit
  Task 3.2  Live change propagation test
  Task 3.3  Settings health check on startup
```

---

## Additional Pitfalls (for newly in-scope capabilities)

**9. Ollama pull streaming — don't block the event loop.**
`/api/pull` returns NDJSON that can stream for minutes. Read it as an async generator
or readable stream. Parse each newline as a JSON object. Never `await` the entire body.

**10. Workspace override merging must not mutate the global profile.**
`getActiveProfile()` returns a new object every time (deep clone + merge). The global
profile stored in `IStorageService` is never touched by workspace logic.

**11. Sync conflict resolution must preserve local-only presets.**
When importing from the sync file: match profiles by `id`. Profiles in the sync file
replace matching local ones (remote wins). Profiles with IDs not in the sync file are
kept locally. Never silently delete a local preset during sync.

**12. Appearance changes must be instant — no "Apply" button.**
Color scheme, density, font size, and accent color must update the workbench in real
time as the user interacts with the controls. Do not debounce the visual update (though
the storage write can be debounced at 300ms).

**13. Per-observer overrides must fall back cleanly.**
If `observerOverrides.data` is `{}` (empty), `resolveObserverSettings('data', profile)`
must return pure global values — no undefined fields, no errors. Always use `?? global.field`
not just `|| global.field` (to handle `0` and `false` correctly).

**14. The Prompt Builder must handle LLM refusals.**
Some models will add preamble like "Sure! Here's your prompt:" instead of returning raw
text. Strip everything before the first "You are" occurrence. If no "You are" found,
use the full response as-is. Never show an empty result.

**15. Model Manager must not allow deleting the only installed model.**
If there's only one model installed, disable the delete button with tooltip:
`"Can't delete — this is the only available model."`

**16. The sync file is user-readable — never put secrets in it.**
The sync file contains only `AISettingsProfile` data. It must never contain Ollama API
keys, tokens, or any authentication material.

---

## Updated Success Criteria

All of the following must be true for the milestone to be complete:

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
| 9 | Disabling canvas observation stops canvas suggestion cards | Toggle off, type in canvas |
| 10 | Disabling suggestions stops all suggestion cards | Toggle off, run mock email |
| 11 | Creating a new preset clones the active profile | Create → inspect fields |
| 12 | Deleting a custom preset returns to Default | Delete → check active |
| 13 | Built-in presets cannot be deleted | Try to delete — option absent or blocked |
| 14 | Export → import round-trips cleanly | Export, edit name, import |
| 15 | Preview Panel runs LLM test and shows response | Click [▶ Run] |
| 16 | "Open in chat" creates a working chat session | Click button, chat works |
| 17 | Settings persist across app restart | Change setting, close, reopen |
| 18 | Corrupted storage resets gracefully to defaults | Manually corrupt JSON |
| 19 | Search "canvas" highlights the canvas toggle | Type in search bar |
| 20 | Modifying a built-in preset clones it automatically | Edit Default preset |
| 21 | Installed Ollama models listed in Model Manager | Open Model Manager section |
| 22 | Switching active chat model takes effect immediately | Switch model, send message |
| 23 | Pulling a model shows live progress bar | Pull smollm2:135m |
| 24 | Deleting a non-active model removes it from table | Delete → table updates |
| 25 | Ollama offline banner shown when Ollama is not running | Kill Ollama, open settings |
| 26 | Workspace override file changes take effect on open | Create .parallx/ai-settings.json |
| 27 | Overridden fields show [workspace] badge | Create workspace override |
| 28 | Clearing workspace overrides removes all badges | Click Clear |
| 29 | Import preset from URL works | Host a preset JSON, import it |
| 30 | Share preset copies valid JSON to clipboard | Click Share preset |
| 31 | Gallery presets visible and installable | Open Gallery section |
| 32 | Prompt Builder wizard generates a system prompt | Complete all 4 steps |
| 33 | "Help me write this" link opens Prompt Builder | Click link in Chat section |
| 34 | DataObserver confidence override reduces data card frequency | Set to 90%, run mock email |
| 35 | Sync folder export creates sync file within 1 second | Configure folder, change setting |
| 36 | Sync import on startup loads remote presets | Modify sync file, restart app |
| 37 | Color scheme Light/Dark/System all work | Switch each in Appearance section |
| 38 | UI density Compact visibly reduces padding | Switch to Compact |
| 39 | Accent color change updates across workbench instantly | Pick new color |
| 40 | Font size 16 makes workbench text noticeably larger | Set font size to 16 |

---

## Notes for the Executing AI (Copilot in VS Code)

**Run the pre-implementation protocol.** The five `grep` commands at the top of this
document will prevent 80% of integration failures.

**The system prompt generator is the product.** The most important function in this
milestone is `generateChatSystemPrompt()`. A user who sets "Concise + Finance + Short
response" must get a radically different AI experience than "Detailed + Writing + Long
response." Test both extremes manually before moving on.

**Service first, UI second.** `IAISettingsService` must fully work (including persisting,
reloading, and emitting events) before building any UI. The UI is a thin skin over the
service.

**Follow the M2 view contribution pattern precisely.** Do not invent a new registration
mechanism. Find how M14's suggestion tray registered itself and replicate it.

**The panel must be scrollable, not paginated.** All sections stack vertically. The nav
is a scroll shortcut, not a page router. This is intentional — users often want to see
multiple sections at once.

**Every setting needs a reset icon.** It must appear on hover for every individual field.
"Reset to default" means reset just that field to the `DEFAULT_PROFILE` value, not the
whole section or whole profile. Make this granular — it's what separates a good settings
editor from a frustrating one.
