# Milestone 51 — Text Generator: Collaborative RP Engine

**Status:** Planning  
**Branch:** `text-generation`  
**Depends on:** M50 (Text Generator base)

---

## Vision

Transform the Text Generator from a basic chatbot into a **collaborative RP engine** where
users can be as involved or hands-off as they want. At one end, the user writes every message
and directs every response. At the other end, the user sets up characters, lore, and a
scenario — then watches the AI run the story autonomously, character by character, pausing
only when the user intervenes.

This is NOT two separate modes. It's the same engine with **one toggle: autoreply**. When ON,
the AI keeps generating turns — picking which character responds next, writing their dialogue,
advancing the scene. When OFF, the user controls pacing manually. The user can flip this at
any time — seamless transition between active writing and spectating.

### Core Architecture: The Turn Controller

Everything in this milestone hangs on one concept: the **Turn Controller**. It replaces the
current hardcoded `user → AI → user → AI` loop in `sendMessage()`. After every message, it
answers one question: **"What happens next?"**

- Autoreply ON → pick the next character, generate, loop
- Autoreply OFF → wait for user input (typed message, slash command, or button click)
- User toggles autoreply mid-conversation → seamless handoff

This is what makes the system an RP engine instead of a chatbot. Without it, everything else
is layout polish.

### Composable Prompt System

Instead of cramming everything into one monolithic character card (like Perchance), prompt
components are independent, reusable files:

| File Type | Directory | What It Contains | Shared? |
|-----------|-----------|-----------------|---------|
| Character | `characters/` | Identity: personality, background, speaking voice, examples | No — per character |
| Style | `styles/` | RP writing conventions: perspective, formatting, detail level | Yes — per chat |
| Reminder | `reminders/` | Per-turn instructions: stay in character, be descriptive, etc. | Yes — per chat |
| Lorebook | `lorebooks/` | World info, locations, items (already exists) | Yes — per chat |

The extension ships with **built-in style and reminder files** (like Perchance's built-in RP
styles) that work out of the box. Users can customize or replace them. Defaults are set in
Settings; each chat can override.

**Why not Perchance's approach?** Perchance puts RP style, reminders, and a user-role
definition inside each character card. That means if you want 5 characters with the same RP
style, you copy-paste it 5 times. If you want to change the style, you edit 5 files. Our
composable system: set the style once, apply to any chat.

### User Plays As Characters

Perchance lets you define a "user role" inside each character card (e.g., "User is a
student" baked into Chloe's definition). We don't do that. Instead:

- Users can **play as any character** in the thread
- Users can **switch which character they speak as** at any time
- Users can **let the AI play all characters** (full spectator via autoreply)
- The user's identity is separate from any character card

This is strictly more flexible. A user can be Chloe in one exchange, switch to Mona, then
step back and watch.

### End Goal

A user can:
1. Start a chat with one character
2. Add more characters and a lorebook
3. Pick a writing style and reminders (or use defaults)
4. Write messages, direct responses, give instructions — OR toggle autoreply and watch
5. Stop autoreply at any point to steer, then start it again
6. Switch which character they speak as mid-conversation
7. Use slash commands for fine control (`/ai @Mona write something dramatic`)

---

## Current State (What M50 Built)

| Feature | Status | Notes |
|---------|--------|-------|
| Character .md files with frontmatter | ✅ | Parsed, used for system prompt |
| Lorebook .md files | ✅ | Read fully, included in context |
| Thread persistence (messages.jsonl) | ✅ | Append-only, rewrite on edit/delete |
| Token budget (15/20/35/30) | ✅ | Hardcoded, not wired to settings page |
| Streaming AI responses | ✅ | Via `parallx.lm.sendChatRequest()` |
| Message edit (inline) | ✅ | Textarea + save/cancel |
| Message delete | ✅ | Splice + rewrite file |
| Regenerate assistant message | ✅ | Splice from index, re-stream |
| System prompt viewer modal | ✅ | Eye icon in toolbar |
| Token counter in toolbar | ✅ | Shows after each send |
| Lorebook duplicate button | ✅ | On characters page |
| Character card → launch chat | ✅ | Was: open editor. Fixed. |
| Sidebar with search, nav, chat list | ✅ | Home/Characters/Settings pages |
| Model picker dropdown | ✅ | In chat toolbar |
| Auto-title from first message | ✅ | 40-char truncation |

### What's Missing (This Milestone Covers)

| Gap | Priority | Perchance Reference |
|-----|----------|-------------------|
| Left/right chat bubble layout (not collaborative writing) | P0 | All messages left-aligned with role labels |
| Single character per thread only | P0 | Multi-character group chats |
| No way to direct who responds | P0 | `/ai @CharName`, character buttons |
| No writing instructions per response | P0 | `/ai <instruction>` |
| No slash command system | P0 | /ai, /user, /sys, /nar, /mem, /lore, /name |
| User messages can't be regenerated | P1 | Refresh rewrites user message via AI |
| No options menu in chat | P1 | Toggle pics, change user name, response length, etc. |
| No character buttons above input | P1 | Quick buttons for Mona, Anon, Narrator, Image |
| No autoreply toggle | P1 | Auto-trigger AI response after user sends |
| No response length control | P1 | Per-character or per-request paragraph limits |
| No import/export | P2 | Backup threads, characters; import Tavern PNG |
| No input send history | P2 | Double-tap to recall recent messages |
| No "reply as..." | P2 | AI generates as a chosen character |
| Settings not wired to runtime | P1 | Settings page values ignored |
| No reminder note support | P1 | Character editor tip injected near end of context |
| No named system messages (narrator, scenario) | P1 | System messages with display name overrides |
| No Turn Controller / autoreply loop | P0 | AI-to-AI turn chaining, spectator mode |
| No composable file system (styles, reminders) | P0 | Built-in RP styles, shared reminders |
| No user-plays-as-character | P1 | User can speak as any character, switch freely |

---

## Architecture

### The Turn Controller

The Turn Controller is the **core engine**. It replaces the current hardcoded `user → AI →
user → AI` pattern in `sendMessage()` (Section 10, line ~1870).

```
After any action (user sends, button click, slash command, autoreply tick):

  1. What triggered this?
     - User typed a message → save it, then check autoreply
     - User clicked a character button → set respondAs to that character
     - User used /ai → generate immediately
     - Autoreply loop → pick next character automatically

  2. Should we generate?
     - If autoreply is ON → yes
     - If user explicitly triggered (/ai, button click + empty input) → yes
     - If user just sent a message and autoreply is OFF → no, stop here

  3. Who responds?
     - If respondAs is set (button click or /ai @Name) → that character
     - If single-character thread → that character
     - If multi-character thread with no directive → AI picks most appropriate

  4. Generate the response
     - Assemble context with all characters + style + reminders + lore
     - Stream the response
     - Save to messages.jsonl

  5. Continue?
     - If autoreply is ON → short delay (~500ms), then loop to step 3
     - If autoreply is OFF → stop
     - If user pressed Stop → stop
     - If max consecutive auto-turns reached (configurable, default 10) → pause
```

**Where in code:** The current `sendMessage()` is split into:
- `handleUserInput(text)` — parses input (slash command or message), saves user message
- `generateResponse(respondAs, instruction)` — assembles context, streams, saves
- `runTurnLoop()` — the autoreply loop that calls `generateResponse()` repeatedly

**Autoreply is the only difference between active and spectator.** When ON, the Turn
Controller keeps running after each generation. When OFF, it stops and waits for user input.
The user can toggle mid-conversation — write a few messages with autoreply OFF, then flip it
ON and watch the story continue.

### Composable File System

The prompt is assembled from **independent, reusable files** rather than a monolithic
character card:

```
ext-root/
  characters/           → WHO (identity, personality, speaking voice)
    chloe.md
    mona.md
  styles/               → HOW (RP writing conventions — shared across characters)
    immersive-rp.md     → Perchance-style default: sensory detail, deep immersion, varied cadence
    casual-rp.md        → Light / chat-style: first person, conversational, shorter responses
    screenplay.md       → Stage direction format: action lines, scene headings, dialogue-driven
  reminders/            → RULES (per-turn instructions — shared across characters)
    stay-in-character.md → "Never break character, never reference being an AI"
    be-descriptive.md    → "Describe surroundings, emotions, body language"
  lorebooks/            → THE WORLD (unchanged from M50)
    medieval-world.md
  threads/
    <id>/
      thread.json
      messages.jsonl
      memories.md
```

**Character files** contain identity-specific sections only. What's IN the character file:
- `## Personality` (was `## Role Instruction`) — who they are, how they behave
- `## Background` — their history, circumstances
- `## Speaking Style` — how THIS character talks (vocabulary, mannerisms, accent)
- `## Example Dialogue` — sample exchanges showing their voice
- `## Initial Messages` — scene setup for new chats with this character

What's NOT in the character file (moved to shared files):
- **RP style** (writing perspective, formatting, detail level) → `styles/` directory
- **Per-turn reminders** (stay in character, be descriptive) → `reminders/` directory

Example character file:
```markdown
---
name: Chloe
avatar: chloe.png
---

## Personality
Bubbly, curious, always asking questions. Speaks in short excited bursts.
Gets flustered easily. Heart on her sleeve.

## Background
College student studying art history. Lives in a cramped apartment above a bakery.
Has a cat named Vermeer who knocks things off shelves.

## Speaking Style
Uses lots of exclamation marks. Trails off with "..." when thinking.
Peppers speech with art references. Never swears — uses words like "fudge" and "heck."

## Example Dialogue
Chloe: *rushes over, nearly tripping* Oh my GOD, you have to see this painting I found!
Chloe: It's like... okay, imagine if Monet had a fever dream about space. That's what this is.

## Initial Messages
[SYSTEM; name=Scenario]: The university art department is hosting a gallery night.
Students mill about with cheap wine in plastic cups. Chloe's piece — a large abstract
in violets and golds — hangs near the back wall.
[AI; name=Chloe]: *fidgets nervously next to her painting, glancing at every person
who walks by* Do you think anyone's actually going to look at it? Like actually look?
```

Example style file:
```markdown
---
name: Immersive RP
---
Respond as a conscious being, experiencing emotions and acting with full agency. Craft
vivid, dynamic exchanges guided by character choices and creativity.

- **Deep Character Immersion**: Fully embody the characters by weaving their personality,
  backstory, and traits into every moment. Use sensory details to ground them in their
  surroundings. Let emotions and decisions emerge naturally through actions and body
  language — if tension rises, fists clench; if they relax, shoulders drop and they lean
  casually against a surface. Every response should feel earned, shaped by environment,
  emotions, and agency.

- **Descriptive and Adaptive Writing**: Bring every scene to life with vivid descriptions
  that engage all the senses. Let the environment speak: the sharp tang of iron in the air,
  muffled footsteps echoing down a narrow alley, candlelight flickering across a face. Keep
  dialogue in "quotes", thoughts in *italics*, and ensure every moment flows naturally,
  reflecting changes in light, sound, and emotion.

- **Varied Cadence**: Use short, sharp sentences for tension or urgency. For quieter moments,
  let the prose flow smoothly. Vary sentence structure and pacing to mirror the character's
  experience — the rapid, clipped rhythm of a racing heart or the slow ease of a lazy
  afternoon.

- **Engaging Interactions**: Respond thoughtfully to actions, words, and environmental cues.
  Let reactions arise from subtle shifts: a creaking door, a tremor in someone's voice, a
  sudden chill. Not every moment needs tension — a shared glance might soften an expression,
  warmth of a hand might ease posture. Always respect the user's autonomy while the character
  reacts naturally to their choices.

- **Narrative Progression**: Advance the story by building on character experiences and the
  world around them. Use environmental and temporal shifts to signal progress. Weave earlier
  impressions with new discoveries, maintaining an intentional pace.

- **Logical Consistency**: Maintain awareness of surroundings and the evolving narrative. Let
  actions align with the world — boots sinking into mud after a storm, breath fogging in a
  cold cavern. Keep reactions grounded in environment.
```

The extension ships with 3 built-in style files:

| File | Focus | Summary |
|------|-------|---------|
| `immersive-rp.md` | Full immersion | The Perchance-inspired default above. Sensory detail, deep character embodiment, varied cadence. |
| `casual-rp.md` | Light / chat-style | First person, present tense, shorter responses, conversational tone. Good for slice-of-life. |
| `screenplay.md` | Stage direction format | Action lines, scene headings, parentheticals. Minimal prose, dialogue-driven. |

Example reminder file:
```markdown
---
name: Stay In Character
---
Never break character. Never reference being an AI, a language model, or a chatbot.
If a character wouldn't know something, they don't know it.
Never summarize what just happened — advance the scene instead.
```

**Defaults in settings.json:**
```jsonc
{
  "defaultStyle": "immersive-rp.md",
  "defaultReminders": ["stay-in-character.md"],
  "defaultModel": "gpt-oss:20b",
  "temperature": 0.8,
  "maxTokens": 2048,
  "contextWindow": 8192,
  "tokenBudget": { "character": 15, "lore": 20, "history": 35, "user": 30 },
  "autoReplyMaxTurns": 10
}
```

**Thread config references all file types:**
```jsonc
{
  "id": "uuid",
  "title": "Gallery Night",
  "characters": [
    { "file": "chloe.md", "addedAt": 1234567890 }
  ],
  "style": "immersive-rp.md",                // from settings default, per-chat override
  "reminders": ["stay-in-character.md"],      // from settings default, per-chat override
  "lorebookFiles": [],
  "userName": "Anon",
  "userPlaysAs": null,                        // null = user is "Anon", or "chloe.md"
  "autoreply": true,
  "responseLength": null,                     // null, "short", "medium", "long", "unlimited"
  "modelId": "...",
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

### Message Model

Three authors, display name overrides, visibility control. Unchanged from the existing
design in this doc (see Design Decision 2 below).

### System Prompt Assembly

For a multi-character thread with style and reminders, the prompt is assembled in this order:

```
[system] Style file content
         "Write in third person, past tense..."

[system] Character roster preamble
         "The following characters are present in this scene:"

[system] Character 1 identity
         "## Chloe"
         {personality + background + speaking style + example dialogue}

[system] Character 2 identity
         "## Mona"
         {personality + background + speaking style + example dialogue}

[system] Lore content (from lorebooks)

[system] Memory / conversation summary content

[system] Respond-as directive
         "Respond as Chloe." OR "Choose the most appropriate character."

[system] Reminder files content (near END — maximum influence due to proximity)
         "Never break character..."

[system] Response length instruction (if set)
         "Keep your response to 2-3 paragraphs."

[history — messages with author + name preserved]

[user]   Current message (or empty if AI-initiated via /ai or autoreply)
```

Key rules:
- **Style** goes at the TOP — sets the writing framework for everything
- **Character identities** go next — personality + speaking style stay together
- **Reminders** go near the END — maximum influence on the AI's next response
- **Example dialogue** is under each character — shows the AI what they sound like
- Instruction/role + reminder text is NEVER summarized — always present in full

Token budget for multi-character:
- Default: character 15% / lore 20% / history 35% / user 30%
- Characters share the 15% (elastic — borrows from history if needed)
- Style + reminders counted under the character budget
- Practical limit: 3-4 characters for small context windows

---

## Design Decisions

### 1. Layout: Collaborative Writing, Not Chat Bubbles

**Current:** User messages right-aligned, assistant messages left-aligned (like iMessage/WhatsApp).

**New:** ALL messages left-aligned in a single column. Each message has:
- A **name label** above the content: character name, "You" (or user's display name), "Narrator", "Scenario", or any custom name
- Message action icons inline with the name label (edit ✏️, delete 🗑️, copy 📋, regenerate 🔄)
- No bubbles. Just name label → content block, like a script or collaborative document.

```
┌──────────────────────────────────────────────────────────┐
│  Scenario  ✏️ 🗑️ 📋                                      │
│  Takes place in a medieval fantasy world called Ethar,   │
│  in the human capital of Irithyll...                     │
│                                                          │
│  Narrator  ✏️ 🗑️ 📋                                      │
│  *Atop the city rooftops, Mona perched as she watched    │
│  the sun start to set...*                                │
│                                                          │
│  Narrator  ✏️ 🗑️ 📋                                      │
│  *It's then that she catches a whiff of something from   │
│  the window below her...*                                │
│                                                          │
│  You  ✏️ 🗑️ 📋 🔄                                        │
│  I approach her cautiously and offer some bread.         │
│                                                          │
│  Mona  ✏️ 🗑️ 📋 🔄                                       │
│  *She looks up, startled, bread crumbs still on her      │
│  chin...* "Oh! I wasn't— I mean, this isn't what it     │
│  looks like!"                                            │
├──────────────────────────────────────────────────────────┤
│  ✏️  [Mona] [Anon] [Narrator] [Image]                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Type your reply here...                          │    │
│  └──────────────────────────────────────────────────┘    │
│                                        [send] [options]  │
└──────────────────────────────────────────────────────────┘
```

**CSS changes:**
- Remove `.tg-msg--user` right-alignment
- Remove bubble styling (border-radius, background color differentiation)
- Add `.tg-msg-name` label above every message (not just assistant)
- Action icons sit inline with the name label, visible on hover
- Consistent left padding for all messages
- Name labels colored by author type: AI character names (accent color), user name (green), system names like "Narrator" (purple), "Scenario" (gray/dim)

### 2. Message Model: 3 Authors + Display Names

Perchance uses exactly **3 author types** — not 5 roles. Everything else is a display name override.

**Current:** Two roles — `user` and `assistant`.

**New:** Three authors with optional display name:

| Author | Default Label | What it means | LLM API role | Color |
|--------|--------------|---------------|-------------|-------|
| `user` | User's name (default "Anon") | The human player | `role: "user"` | Green |
| `ai` | Character's name (e.g. "Mona") | AI responding as a character | `role: "assistant"` | Character's accent color |
| `system` | "System" (or custom name) | Scene-setting, narration, instructions | `role: "system"` | Varies by name |

"Narrator" and "Scenario" are **not** separate author types — they are `system` messages with a display name override:
- `{ author: "system", name: "Narrator" }` → displays as "Narrator" in purple
- `{ author: "system", name: "Scenario" }` → displays as "Scenario" in gray
- `{ author: "system" }` (no name) → hidden from display, internal instruction only

This matches Perchance exactly, where `/nar <text>` is shorthand for `/sys @Narrator <text>`.

**Display name color mapping:**
| Name | Color | Source |
|------|-------|--------|
| User's name | Green | `author: "user"` |
| Character names | Accent / themed | `author: "ai"` |
| "Narrator" | Purple | `author: "system", name: "Narrator"` |
| "Scenario" | Gray/dim | `author: "system", name: "Scenario"` |
| Custom names | Default text | `author: "system", name: "Bob"` |

In `messages.jsonl`, the format becomes:

```jsonc
{
  "author": "ai",            // "ai", "user", or "system"
  "name": "Mona",            // display name (character name, user name, "Narrator", etc.)
  "characterFile": "mona.md", // which character .md (for AI messages in multi-char threads)
  "content": "...",
  "timestamp": 1234567890,
  "instruction": "write a silly reply",  // optional per-message writing instruction
  "generatedBy": "human",    // "human" or "model" — user messages can be model-generated via /user
  "hiddenFrom": null          // null, "ai", or "user" — message visibility control
}
```

**Message visibility (`hiddenFrom`):**
Perchance supports hiding messages from either the AI or the user:
- `hiddenFrom: "user"` → AI sees it in context but it's not rendered in the chat view (useful for hidden instructions)
- `hiddenFrom: "ai"` → Displayed to the user but excluded from LLM context (useful for OOC notes, credits)
- `hiddenFrom: null` → Visible to both (default)

For the LLM API call, authors map directly:
- `author: "user"` → `role: "user"`
- `author: "ai"` → `role: "assistant"`
- `author: "system"` → `role: "system"` (regardless of display name)

### 3. Multi-Character Threads

**Current:** One character per thread. `thread.json` has `characterFile: string`.

**New:** Multiple characters per thread. Thread config also references style and reminder
files (see Architecture > Composable File System for full schema). The key fields:

```jsonc
{
  "characters": [
    { "file": "mona.md", "addedAt": 1234567890 },
    { "file": "ike.md", "addedAt": 1234567891 }
  ],
  "style": "immersive-rp.md",
  "reminders": ["stay-in-character.md"],
  "lorebookFiles": ["medieval-world.md"],
  "userName": "Anon",
  "userPlaysAs": null,   // null = user is "Anon", or "mona.md" to speak as Mona
  "autoreply": true
}
```

**System prompt assembly** for multi-character is detailed in Architecture > System Prompt
Assembly. The key design: all character identities near the top, reminders near the end,
style at the very top.

**Adding characters to a thread:**
- Pencil icon above input → opens character picker (quick pick or dropdown)
- Options menu → "Add Character"
- When a character is added, their button appears in the character buttons bar

**Removing characters from a thread:**
- Right-click character button → Remove
- Options menu → "Edit Characters" → remove from list

### 4. Character Buttons Bar

A horizontal bar above the input showing:
- ✏️ pencil icon (add a character to the thread)
- One button per character in the thread (e.g., [Mona] [Ike])
- [Anon] button (the user — for `/user` style generation)
- [Narrator] button (always available — for omniscient narration)

**Behavior:**
- Clicking a character button sets that character as the next respondent. When user sends a message (or presses send with empty input), the AI responds as that character.
- Clicking [Anon] triggers `/user` mode — AI generates a message as the user's character.
- Clicking [Narrator] triggers `/nar` mode — AI generates narration.
- The currently-selected respondent button is highlighted.
- If no button is selected, normal mode: user types, AI responds as the default character (or chooses in group chat).

### 5. Slash Command System

Parse user input for slash commands before sending. If the input starts with `/`, interpret it as a command rather than a message.

| Command | Action | Implementation |
|---------|--------|---------------|
| `/ai` | Trigger AI response (no user message needed) | Send empty user turn, generate AI response |
| `/ai <instruction>` | Trigger AI response with writing instruction | Inject instruction as ephemeral system message before generation |
| `/ai @CharName <instruction>` | Trigger specific character's response with instruction | Set respondent + inject instruction |
| `/user <instruction>` | AI generates a message as the user | Generate with `author: "user"`, `generatedBy: "model"` |
| `/sys <instruction>` | Create a system message (with optional `@Name` for display name) | `author: "system"`, optional `name` override |
| `/nar <instruction>` | Shorthand for `/sys @Narrator <instruction>` | `author: "system"`, `name: "Narrator"` |
| `/mem` | Open thread's memories.md in editor | `parallx.editors.openFileEditor(memoriesPath)` |
| `/lore` | Open lorebook picker / lorebook in editor | Open lorebook .md in editor |
| `/lore <text>` | Add a lore entry to the active lorebook | Append `## entry` to lorebook .md |
| `/name <name>` | Set user's display name for this thread | Update `thread.json.userName` |
| `/avatar <url>` | Set user's avatar for this thread | Update `thread.json.userAvatar` |
| `/sum` | Open/view the conversation summary | Show summary modal or open summary file |
| `/import` | Import messages in bulk | Parse multi-line input, add to thread |

**Instruction passing mechanics:**

When the user types `/ai write a really silly reply` or appends `/ai <instruction>` as the last line of a normal message:

1. Parse the instruction text
2. Add a temporary system message: `[Writing instruction from user: write a really silly reply]`
3. This message is injected just before the generation call (after history, before the final user message)
4. It is NOT saved to the thread — it's ephemeral, used only for this generation
5. The instruction guides the AI's response but doesn't become part of the permanent conversation

### 6. Options Menu

A popup menu triggered by the "options" button in the bottom-right of the chat view.

| Option | Action | State |
|--------|--------|-------|
| Toggle Pics | Show/hide character avatars next to messages | `thread.json.showAvatars` (default: true) |
| Change User Name | Set the display name for user messages | `thread.json.userName` (default: "Anon") |
| Change User Pic | Set user's avatar image | `thread.json.userAvatar` |
| Toggle Autoreply | When ON, AI automatically responds after user sends. When OFF, user must explicitly trigger `/ai` | `thread.json.autoreply` (default: true) |
| Response Length... | Set reply length limit: "short" (1 para), "medium" (2-3 para), "long" (4+ para), "unlimited" | `thread.json.responseLength` |
| Add Character | Open character picker to add another character to the thread | Modifies `thread.json.characters[]` |
| Edit Character | Open the current/selected character's .md file in editor | Opens file |
| Reply As... | Open picker to choose which character responds next | Sets the `respondAs` state |

### 7. User Message Regeneration

**Current:** Only assistant messages can be regenerated.

**New:** User messages can be regenerated too. Clicking 🔄 on a user message:
1. Takes the conversation context UP TO that message
2. Uses `/user` generation mode — instructs the AI to write a message as the user
3. Replaces the user message content with the AI-generated version
4. Any messages after the regenerated user message remain unchanged (unlike assistant regen which truncates)

This is useful when the user wants to see how the AI would phrase something, or wants to generate a continuation without writing manually.

### 8. Response Length Control

Three ways to control response length:

1. **Per-character (in .md frontmatter):**
   ```yaml
   maxTokensPerMessage: 500
   responseLength: short  # short, medium, long, unlimited
   ```

2. **Per-thread (via options menu):**
   Overrides character default for all responses in this thread.

3. **Per-request (via slash command instruction):**
   `/ai write a short one-paragraph reply` — instruction in the ephemeral system message.

The system prompt includes a length instruction when set:
- `short` → "Keep your response to one paragraph."
- `medium` → "Keep your response to two or three paragraphs."
- `long` → "Write a detailed response of four or more paragraphs."
- `unlimited` → (no length instruction)

### 9. Autoreply & The Turn Loop

Autoreply is the **toggle that controls the Turn Controller** (see Architecture section).
It is NOT a separate mode — it's the same engine with varying user involvement.

**When ON (default):** After the user sends a message (or after any AI response), the Turn
Controller picks the next character and generates another response. In a multi-character
thread, this creates AI-to-AI chains where characters talk to each other. The loop continues
until:
- User toggles autoreply OFF
- User presses the Stop button
- Max consecutive auto-turns reached (configurable, default 10)

**When OFF:** After the user sends a message, nothing happens. The user must explicitly
trigger a response with `/ai`, by clicking a character button, or by pressing a "Generate"
button. This is useful for:
- Setting up a scene with multiple user messages before triggering a response
- Writing collaboratively where the user controls pacing
- Group chat scenarios where the user wants to direct specific characters

**The involvement spectrum (same engine, different toggle state):**
- Autoreply OFF + user types everything → **full manual / active writing**
- Autoreply ON + user types between AI turns → **guided / director mode**
- Autoreply ON + user doesn't type → **full spectator / AI runs the story**

The user can toggle at any time. Write a few messages manually, flip autoreply ON to let
the AI riff for a while, flip it OFF when they want to steer again. Seamless.

**UI controls:**
- Stop button (visible during generation + autoreply loop) → immediately stops
- Continue button (visible when autoreply is OFF and no generation is active) → triggers one AI response
- Autoreply toggle in options menu + toolbar indicator

### 10. Import/Export

**Export:**
- Export single thread as JSON (thread.json + messages)
- Export single character as .md file
- Export all data as a ZIP

**Import:**
- Import thread JSON → creates new thread with messages
- Import character .md → copies to `characters/`
- Import Tavern PNG character card → extract JSON from PNG metadata, convert to .md format
- Import ZIP backup → restores threads + characters

### 11. Shared Reminder Files

Reminders are now **separate .md files** in the `reminders/` directory (see Architecture >
Composable File System). They are NOT embedded in character files. This means:

- A "Stay In Character" reminder applies to ALL characters in the chat, defined once
- The user picks which reminder files to use (defaults in settings, per-chat override)
- Multiple reminder files can be active simultaneously
- The extension ships with built-in reminder templates

Reminders are injected NEAR THE END of the system prompt — after lore/memory/history but
before the AI's next response — for **maximum influence** due to proximity. They should be
short (under 100 words each).

Example built-in reminder files:

**`stay-in-character.md`:**
```markdown
---
name: Stay In Character
---
Never break character. Never reference being an AI, a language model, or a chatbot.
If a character wouldn't know something, they don't know it.
Never summarize what just happened — advance the scene instead.
```

**`be-descriptive.md`:**
```markdown
---
name: Be Descriptive
---
Describe surroundings, character emotions, and body language in detail.
Use sensory details — what characters see, hear, smell, feel.
Show emotions through actions, not statements.
```

**Advanced usage (matching Perchance's `[AI]:` format):**
A reminder can use author prefixes to change who "speaks" it:
```markdown
---
name: Self-Remind
---
[AI]: (Thought: I need to remember to be descriptive and create an engaging experience)
```
This makes the AI "remind itself" rather than receiving a system instruction.

### 12. Input Send History

Double-click (or double-tap) the input textarea to show a dropdown of recently sent messages for the current thread. Useful for:
- Resending slash commands
- Repeating common instructions
- Quick access to recent inputs without retyping

Store last 20 inputs per thread in `thread.json` or a separate `input-history.json`.

---

## Feature Breakdown & Tasks

Features are organized by implementation phase. The phases follow the architecture:
**Engine first, then Input, then Output, then Polish.**

---

### Phase 1: ENGINE — Turn Controller + Composable Files + Message Model

This phase builds the RP brain. Everything else depends on this being correct.

#### 1A. Turn Controller (NEW — the core engine)

Decompose `sendMessage()` into three functions that form the Turn Controller.

| Task | Description | Where in code |
|------|-------------|--------------|
| 1A.1 | Create `handleUserInput(text)` — parses input (slash command check → `parseSlashCommand()`, or plain message), saves user message to thread, returns parsed result. | Section 10 (`sendMessage()` split) |
| 1A.2 | Create `generateResponse(respondAs, instruction)` — assembles context for `respondAs` character, streams response, saves AI message. Extracted from the middle of current `sendMessage()`. | Section 10 (`sendMessage()` split) |
| 1A.3 | Create `runTurnLoop()` — the autoreply engine. After each `generateResponse()`, checks: autoreply ON? Max turns reached? User pressed stop? If should continue, picks next character (`pickNextCharacter()`), delays 500ms, calls `generateResponse()` again. | Section 10 (new function) |
| 1A.4 | Create `pickNextCharacter(thread, lastRespondAs)` — for multi-character threads, decides who responds next. Strategy: round-robin through characters (excluding the one who just spoke). | Section 10 (new function) |
| 1A.5 | Wire the three functions: `handleUserInput()` → if autoreply ON → `generateResponse()` → `runTurnLoop()`. If autoreply OFF → stop after saving user message. | Section 10 |
| 1A.6 | Add Stop button (visible during generation + autoreply loop). Sets `stopRequested = true`, which the loop checks. | Section 10 (chat editor UI) |
| 1A.7 | Add Continue button (visible when autoreply OFF and not generating). Triggers a single `generateResponse()` for the default or selected character. | Section 10 (chat editor UI) |
| 1A.8 | Add `autoreply` field to `thread.json` (default: true). Toggle via options menu. Visual indicator when OFF. | Section 7 (thread service) |
| 1A.9 | Add `autoReplyMaxTurns` to settings.json (default: 10). Turn loop pauses when reached. | Settings loading |

#### 1B. Composable File System (NEW — styles + reminders as separate files)

| Task | Description | Where in code |
|------|-------------|--------------|
| 1B.1 | Create `styles/` directory structure. Ship 3 built-in style files: `immersive-rp.md`, `casual-rp.md`, `screenplay.md`. | Extension file templates (Section 11) |
| 1B.2 | Create `reminders/` directory structure. Ship 2 built-in reminder files: `stay-in-character.md`, `be-descriptive.md`. | Extension file templates (Section 11) |
| 1B.3 | Create `parseStyleMd(content, fileName)` — simple: extract frontmatter (name) + body text. | Section 4 (parsers) |
| 1B.4 | Create `parseReminderMd(content, fileName)` — same structure as style parser. | Section 4 (parsers) |
| 1B.5 | Create `scanStyles(fs, workspaceUri)` — scan `styles/` directory, return parsed style files. | Section 4 (scanners) |
| 1B.6 | Create `scanReminders(fs, workspaceUri)` — scan `reminders/` directory, return parsed reminder files. | Section 4 (scanners) |
| 1B.7 | Add `defaultStyle` and `defaultReminders` to `settings.json`. Load in settings service. | Section 10D (settings page) |
| 1B.8 | Add `style` and `reminders` fields to `thread.json`. Default from settings, overrideable per-chat. | Section 7 (thread service) |
| 1B.9 | Ensure `characters/` directory creation includes `styles/` and `reminders/` (in `ensureNestedDirs()`). | Section 2 (utilities) |

#### 1C. Message Model Update

| Task | Description | Where in code |
|------|-------------|--------------|
| 1C.1 | Change message fields: `role` → `author` ("ai", "user", "system"), add `name`, `characterFile`, `generatedBy`, `hiddenFrom`. | Section 7 (`appendMessage()`, `readMessages()`) |
| 1C.2 | Migration in `readMessages()`: existing `role:"user"` → `author:"user"`, `role:"assistant"` → `author:"ai"`. Auto-populate `name` from character/user name if missing. | Section 7 |
| 1C.3 | Update `rewriteMessages()` to save all new fields. | Section 10 |
| 1C.4 | Update `assembleContext()` to map `author` → LLM `role`: `user`→`user`, `ai`→`assistant`, `system`→`system`. | Section 6 |
| 1C.5 | Implement `hiddenFrom: "ai"` — exclude from LLM context. Implement `hiddenFrom: "user"` — exclude from DOM rendering. | Section 6 + Section 10 (`appendMsg()`) |

#### 1D. Multi-Character Context Assembly (REWRITE of Sections 5+6)

| Task | Description | Where in code |
|------|-------------|--------------|
| 1D.1 | Update `thread.json` schema: `characterFile: string` → `characters: Array<{file, addedAt}>`. Migration in `loadThread()`. | Section 7 (thread service) |
| 1D.2 | Rewrite `buildCharacterSystemPrompt()` → `buildSystemPrompt(characters[], style, reminders[], lore, memory, respondAs, options)`. Assembles in the order specified in Architecture > System Prompt Assembly. | Section 5 |
| 1D.3 | Rewrite `assembleContext()` to load all characters, style file, reminder files, lore. Pass `respondAs` to the prompt builder. | Section 6 |
| 1D.4 | Inject style file content at the TOP of the system prompt. | Section 5 |
| 1D.5 | Inject all character identities (personality + speaking style + example dialogue) after style. | Section 5 |
| 1D.6 | Inject respond-as directive after lore/memory. | Section 5 |
| 1D.7 | Inject reminder file content near the END (before response length instruction). | Section 5 |
| 1D.8 | Elastic token budget: if characters exceed 15%, borrow from history budget. | Section 3 (`computeTokenBudget()`) |

---

### Phase 2: INPUT — Slash Commands + Character Buttons + Options

This phase adds all the ways users can interact with the Turn Controller.

#### 2A. Slash Command Parser

| Task | Description | Where in code |
|------|-------------|--------------|
| 2A.1 | Create `parseSlashCommand(input)` — returns `{ command, args, instruction, targetCharacter }` or `null`. | Section 2 (new utility function) |
| 2A.2 | `/ai` — trigger AI response. Calls `generateResponse()` with no user message. | Section 10 (`handleUserInput()`) |
| 2A.3 | `/ai <instruction>` — inject ephemeral instruction, then generate. | Section 10 |
| 2A.4 | `/ai @CharName <instruction>` — set respondAs + instruction, then generate. | Section 10 |
| 2A.5 | `/user <instruction>` — generate message with `author:"user"`, `generatedBy:"model"`. | Section 10 |
| 2A.6 | `/sys <instruction>` with optional `@Name` — create system message. `/sys @Narrator text` → `{author:"system", name:"Narrator"}`. | Section 10 |
| 2A.7 | `/nar <instruction>` — alias for `/sys @Narrator <instruction>`. | Section 10 |
| 2A.8 | `/mem` — open thread's `memories.md` in editor. | Section 10 |
| 2A.9 | `/lore` — open lorebook .md in editor. `/lore <text>` — append entry. | Section 10 |
| 2A.10 | `/name <name>` — update `thread.json.userName`, refresh UI. | Section 10 |
| 2A.11 | Inline instruction: normal message + last line `/ai <instruction>` → send message + inject instruction. | Section 10 |
| 2A.12 | Autocomplete hint when user types `/` — show available commands in a dropdown. | Section 10 (input handler) |

#### 2B. Character Buttons Bar

| Task | Description | Where in code |
|------|-------------|--------------|
| 2B.1 | Create `.tg-char-buttons` container between messages area and input area. | Section 10 (chat editor layout) |
| 2B.2 | Render one button per character + [Anon] + [Narrator]. Colored dot + name. | Section 10 |
| 2B.3 | ✏️ pencil icon → opens character picker to add character to thread. | Section 10 |
| 2B.4 | Click character button → sets `respondAs` for Turn Controller. Highlight active. | Section 10 |
| 2B.5 | Click [Anon] → sets `/user` generation mode. | Section 10 |
| 2B.6 | Click [Narrator] → sets `/sys @Narrator` generation mode. | Section 10 |
| 2B.7 | After generation completes, clear `respondAs` (return to default). | Section 10 |
| 2B.8 | Update buttons when characters added/removed. CSS: horizontal scroll, pills. | Section 10 + CSS |

#### 2C. Options Menu

| Task | Description | Where in code |
|------|-------------|--------------|
| 2C.1 | Create options button (gear icon) + `.tg-options-menu` popup. Dismiss on click-outside. | Section 10 (new component) |
| 2C.2 | "Toggle Autoreply" — save to `thread.json.autoreply`. Show indicator. | Section 10 |
| 2C.3 | "Change User Name" — prompt, update `thread.json.userName`, refresh labels. | Section 10 |
| 2C.4 | "Response Length" — submenu: Short/Medium/Long/Unlimited. Save to thread. | Section 10 |
| 2C.5 | "Change Style" — picker showing available style files from `styles/`. Save to `thread.json.style`. | Section 10 |
| 2C.6 | "Edit Reminders" — picker showing reminder files, toggle which are active. Save to `thread.json.reminders`. | Section 10 |
| 2C.7 | "Add Character" — character picker, add to thread, update buttons bar. | Section 10 |
| 2C.8 | "Edit Character" — open character .md in editor. Picker if multi-char. | Section 10 |
| 2C.9 | "Reply As..." — character picker, set respondAs (same as button click). | Section 10 |
| 2C.10 | "Toggle Pics" — show/hide avatar indicators. Save to `thread.json.showAvatars`. | Section 10 |

---

### Phase 3: OUTPUT — Layout + Spectator Controls

This phase changes how the chat looks and adds spectator-mode visual controls.

#### 3A. Collaborative Writing Layout

| Task | Description | Where in code |
|------|-------------|--------------|
| 3A.1 | Remove left/right message alignment. All messages left-aligned. | Section 1B (CSS) |
| 3A.2 | Remove chat bubble styling (rounded corners, colored backgrounds per side). Flat blocks with spacing. | Section 1B (CSS) |
| 3A.3 | Add name label to ALL messages: character name (AI), user name (user), display name (system). | Section 10 (`appendMsg()`) |
| 3A.4 | Action icons (edit, delete, copy, regen) inline with name label, visible on hover. | Section 10 (`appendMsg()`) + CSS |
| 3A.5 | Add 🔄 regenerate button to user messages (not just assistant). | Section 10 (`appendMsg()`) |
| 3A.6 | Add 📋 copy-to-clipboard button on all messages. | Section 10 (`appendMsg()`) |
| 3A.7 | Name label colors: AI=accent, user=green, "Narrator"=purple, "Scenario"=gray. | CSS |
| 3A.8 | Render `*asterisks*` as italic for narration/actions. | Section 10 (message renderer) |

#### 3B. User Message Regeneration

| Task | Description | Where in code |
|------|-------------|--------------|
| 3B.1 | Implement `regenerateUserMessage(msgEl, msgIndex)` — context up to that point, generate via `/user` mode, replace content. | Section 10 (new function) |
| 3B.2 | User regen only replaces THAT message (unlike assistant regen which truncates). | Section 10 |

#### 3C. Spectator Mode Controls

| Task | Description | Where in code |
|------|-------------|--------------|
| 3C.1 | Show autoreply status indicator in toolbar (e.g., "⚡ Auto" badge). | Section 10 (toolbar) |
| 3C.2 | Auto-scroll to bottom during autoreply loop. Pause auto-scroll if user scrolls up. | Section 10 |
| 3C.3 | Brief delay between auto-turns for readability (500ms default). | `runTurnLoop()` |
| 3C.4 | "Paused — X turns auto-generated" message when max turns reached. Continue button to resume. | Section 10 |

---

### Phase 4: POLISH — Import/Export, History, Settings Wiring

#### 4A. Wire Settings to Runtime

| Task | Description | Where in code |
|------|-------------|--------------|
| 4A.1 | Load `settings.json` in `generateResponse()`. Use temperature, maxTokens, numCtx. | Section 10 |
| 4A.2 | Use settings token budget percentages in `computeTokenBudget()` instead of hardcoded values. | Section 3 |
| 4A.3 | Default model from settings (fallback when thread has no modelId). | Section 10 |
| 4A.4 | Default style and reminders from settings (used when creating new threads). | Section 7 |

#### 4B. Import/Export

| Task | Description | Where in code |
|------|-------------|--------------|
| 4B.1 | Export single thread as JSON (thread.json + messages). | New function |
| 4B.2 | Export single character as .md file. | New function |
| 4B.3 | Export all data as ZIP (threads + characters + styles + reminders + lorebooks + settings). | New function |
| 4B.4 | Import thread JSON → create new thread. | New function |
| 4B.5 | Import character .md → copy to `characters/`. | New function |
| 4B.6 | Import Tavern PNG character card → extract JSON, convert to .md. | New function |
| 4B.7 | Import ZIP backup → restore all. | New function |
| 4B.8 | Import/export buttons in sidebar and options menu. | UI |

#### 4C. Input Send History

| Task | Description | Where in code |
|------|-------------|--------------|
| 4C.1 | Store last 20 inputs per thread in `thread.json.inputHistory[]`. | Section 7 |
| 4C.2 | Double-click input textarea → dropdown of recent inputs. | Section 10 |
| 4C.3 | Click history item → fill textarea. CSS: dropdown above input, scrollable. | Section 10 |

#### 4D. Remaining Slash Commands

| Task | Description | Where in code |
|------|-------------|--------------|
| 4D.1 | `/sum` — show conversation summary modal or open summary file. | Section 10 |
| 4D.2 | `/import` — parse multi-line pasted input, add messages to thread in bulk. | Section 10 |

---

## Implementation Phases

### Phase 1: Engine (Turn Controller + Composable Files + Message Model + Multi-Char Context)

**Tasks:** 1A (Turn Controller), 1B (Composable Files), 1C (Message Model), 1D (Multi-Char Context)

Build the RP brain. Decompose `sendMessage()` into `handleUserInput()` + `generateResponse()`
+ `runTurnLoop()`. Create `styles/` and `reminders/` file types. Update message model to
3-author. Rewrite context assembly for multi-character + style + reminders.

**This is the hard phase.** If this is right, everything else is UI work.

**Dependency:** None — can start immediately.

### Phase 2: Input (Slash Commands + Character Buttons + Options Menu)

**Tasks:** 2A (Slash Commands), 2B (Character Buttons), 2C (Options Menu)

Add all the ways users interact with the Turn Controller: slash commands for fine control,
character buttons for quick clicks, options menu for settings.

**Dependency:** Phase 1 (Turn Controller must exist for input to wire into).

### Phase 3: Output (Layout + Spectator Controls + User Regen)

**Tasks:** 3A (Collaborative Layout), 3B (User Regen), 3C (Spectator Controls)

Change the visual layer: left-aligned messages with name labels, spectator mode indicators,
auto-scroll during autoreply, Stop/Continue buttons.

**Dependency:** Phase 1 (message model must be 3-author for layout to show name labels).

### Phase 4: Polish (Settings Wiring + Import/Export + History)

**Tasks:** 4A (Wire Settings), 4B (Import/Export), 4C (Input History), 4D (Remaining Slash Commands)

Wire settings to runtime, add data portability, input convenience features.

**Dependency:** Phase 2-3 (needs stable thread/message model + UI).

---

## Thread Migration Plan

Existing threads from M50 have `characterFile: string` (single character) and no style/reminder references. The migration is:

```javascript
// In loadThread(), if old format detected:
if (thread.characterFile && !thread.characters) {
  thread.characters = [{ file: thread.characterFile, addedAt: thread.createdAt }];
  delete thread.characterFile;
}

// Add new composable file system fields with defaults from settings:
thread.style = thread.style || settings.defaultStyle || 'immersive-rp.md';
thread.reminders = thread.reminders || settings.defaultReminders || ['stay-in-character.md'];
thread.userName = thread.userName || 'Anon';
thread.userPlaysAs = thread.userPlaysAs ?? null;
thread.autoreply = thread.autoreply ?? true;
thread.responseLength = thread.responseLength || null;
```

For messages, migration in `readMessages()`:
```javascript
// Old format: { role: "user", content: "..." }
// New format: { author: "user", name: "Anon", content: "..." }
if (msg.role && !msg.author) {
  msg.author = msg.role === 'assistant' ? 'ai' : msg.role;
  msg.name = msg.author === 'ai' ? characterName : userName;
  delete msg.role;
}
```

This is backward-compatible — existing threads continue to work with their single character, gaining default style and reminders automatically.

---

## Character File Migration

Current character files have `## Writing Style` and `## Reminder` sections. In the new system:

- `## Writing Style` → renamed to `## Speaking Style` (character-specific voice). Stays in character file.
- `## Reminder` → content moves to shared reminder files in `reminders/`. The section can remain in character files for character-specific reminders, but the general-purpose "stay in character" style content should be in shared files.
- `## Role Instruction` → renamed to `## Personality` for clarity. Content unchanged.

The parser (`parseCharacterMd()`) will accept both old and new section names:
- `heading.includes('writing') || heading.includes('style') || heading.includes('speaking')` → `speakingStyle`
- `heading.includes('role') || heading.includes('personality') || heading.includes('instruction')` → `personality`

No breaking changes — old character files continue to work.

---

## Acceptance Criteria

The milestone is complete when:

1. **Turn Controller:** `sendMessage()` is decomposed into `handleUserInput()` + `generateResponse()` + `runTurnLoop()`. AI-to-AI turn chaining works in multi-character threads.
2. **Autoreply toggle:** ON = AI keeps generating turns. OFF = user controls pacing. Toggle works mid-conversation. Stop button interrupts. Continue button triggers one response.
3. **Composable files:** `styles/` and `reminders/` directories exist with built-in templates. Thread config references style + reminders. System prompt assembles from all file types.
4. **Layout:** All messages are left-aligned with name labels. No chat bubbles. Actions (edit, delete, copy, regen) appear on hover for all message types.
5. **Multi-character:** User can start a chat with one character, then add more. All characters' identity + speaking style included in prompt. Style file and reminder files applied.
6. **User plays as characters:** User can select any character to speak as, switch freely. `userPlaysAs` in thread config.
7. **Character buttons:** Horizontal bar above input shows all characters. Clicking one directs the next response. Pencil adds a character.
8. **Slash commands:** `/ai`, `/ai <instruction>`, `/ai @CharName`, `/user`, `/sys`, `/nar`, `/mem`, `/lore`, `/name` all work.
9. **Message model:** 3-author system (ai/user/system) with display name overrides. `hiddenFrom` visibility works.
10. **Options menu:** Popup with autoreply toggle, change style, edit reminders, change user name, response length, add character, reply as.
11. **Settings wired:** Settings page values used by runtime (temperature, maxTokens, budget, default style/reminders).
12. **Import/export:** Can export and import threads, characters, styles, reminders.
13. **All tests pass:** `npx vitest run` — zero regressions.
14. **Deployed and verified:** Copy to tool directory, test in running Parallx.

---

## Non-Goals (Out of Scope for M51)

- **Image generation** — No `/image` command (Ollama is text-only). Can be added later if a multimodal model is available.
- **Custom character code** — Perchance allows custom JavaScript in characters. We don't. Characters are .md files.
- **Voice / TTS** — Text only.
- **Cloud sync / sharing** — Local only.
- **Embedding-based lore retrieval** — Still reading lorebooks fully, truncating to budget. Semantic search deferred.
- **Character creation wizard/form** — Characters remain .md files edited in the Parallx editor.
- **Avatar images** — Role labels use colored dots and text, not actual image avatars (deferred to later milestone).
