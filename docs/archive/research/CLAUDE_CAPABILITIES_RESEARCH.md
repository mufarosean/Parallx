# Claude — Complete Capabilities Research & Reference

**Date:** April 5, 2026 (revised July 2026)
**Status:** Active research
**Audience:** Anyone — assumes zero prior AI knowledge
**Relevance:** Comparative reference for Parallx AI architecture decisions

---

## Table of Contents

1. [Glossary — Key Terms Explained](#1-glossary--key-terms-explained)
2. [What Is Claude?](#2-what-is-claude)
3. [The Model Family](#3-the-model-family)
4. [How Claude Works](#4-how-claude-works)
5. [Model Capabilities](#5-model-capabilities)
6. [Tools — What Claude Can Do](#6-tools--what-claude-can-do)
7. [Code vs Skills — The Key Distinction](#7-code-vs-skills--the-key-distinction)
8. [Agent Skills](#8-agent-skills)
9. [Tool Infrastructure](#9-tool-infrastructure)
10. [Context Management](#10-context-management)
11. [Files API](#11-files-api)
12. [Computer Use — Deep Dive](#12-computer-use--deep-dive)
13. [Security Model](#13-security-model)
14. [Comparison with OpenClaw](#14-comparison-with-openclaw)
15. [Sources](#15-sources)

---

## 1. Glossary — Key Terms Explained

Before diving in, here are definitions for every technical term used in this document. If you know these already, skip to [Section 2](#2-what-is-claude).

| Term | What It Means |
|------|--------------|
| **AI (Artificial Intelligence)** | Software designed to perform tasks that normally require human thinking — answering questions, writing text, analyzing images, coding. |
| **LLM (Large Language Model)** | The specific type of AI that powers Claude. It's a software system trained on enormous amounts of text to understand and generate human language. "Large" refers to the billions of learned parameters inside the model. |
| **Model** | The trained AI brain itself — the software artifact that takes text in and produces text out. Different models have different capabilities and costs. |
| **Token** | The unit of text that an LLM processes. Roughly 1 token ≈ 4 English characters ≈ ¾ of a word. The sentence "Hello, how are you?" is about 6 tokens. Models charge by tokens consumed. |
| **Context Window** | The total amount of text (measured in tokens) that a model can "see" at once — this includes everything: the system instructions, the conversation history, any documents you've attached, and the AI's response. Think of it as the model's working memory. |
| **Input Tokens** | Tokens the model reads — your messages, documents, and instructions. |
| **Output Tokens** | Tokens the model generates — its responses. These cost more than input tokens. |
| **System Prompt** | Hidden instructions given to the model before any user messages. Defines personality, rules, and behavior. The user doesn't see this, but it shapes every response. |
| **API (Application Programming Interface)** | A structured way for software to communicate with other software. Claude's API lets developers send text to Claude and receive responses programmatically — no web browser needed. |
| **Tool** | A defined action that the AI can request to perform. Instead of just generating text, Claude can say "I need to search the web" or "I need to run this code" and the system executes that action. Tools give the AI hands. |
| **Tool Use (Function Calling)** | The pattern where Claude decides it needs a tool, sends a structured request describing what it wants to do, the system executes it, and the result is returned. This loop can repeat multiple times in a single conversation turn. |
| **Agent** | An AI system that can take multiple steps autonomously — planning, using tools, evaluating results, and deciding what to do next — rather than just answering a single question. |
| **Prompt** | The text you send to an AI model. Includes the question or instruction you want it to act on. |
| **Prompt Caching** | A cost optimization where parts of a prompt that don't change between requests are stored and reused instead of being reprocessed each time. |
| **RAG (Retrieval-Augmented Generation)** | A technique where the AI first retrieves relevant documents from a knowledge base, then uses that information to generate its response. This grounds the AI's answers in actual data rather than relying solely on what it learned during training. |
| **MCP (Model Context Protocol)** | An open standard that lets AI models connect to external data sources and tools. Think of it as USB for AI — a universal plug that lets Claude access databases, APIs, file systems, and more. |
| **Streaming** | Sending the AI's response word-by-word as it's generated, rather than waiting for the entire response to finish. This makes the AI feel faster and more responsive. |
| **Sandbox** | An isolated environment where code runs safely, unable to affect the outside system. Like a playground with walls — nothing can escape. |
| **Docker** | Software that creates isolated computing environments (containers). Each container has its own operating system, applications, and files, completely separate from the host computer. |
| **Beta** | A feature that is available but still being developed. It works, but Anthropic may change how it works in future releases. Some features require a special "beta header" in API requests to activate them. |

---

## 2. What Is Claude?

Claude is a family of AI language models built by **Anthropic**, an AI safety company founded in 2021 by former members of OpenAI. Claude is Anthropic's core product, available through:

- **claude.ai** — a web chat interface (like ChatGPT)
- **Claude API** — for developers to integrate Claude into their own applications
- **Claude Code** — a command-line coding agent
- **Amazon Bedrock** and **Google Vertex AI** — cloud platform integrations

Claude is not a single model. It's a family of models at different capability and price tiers, each designed for different use cases. The current generation (as of mid-2026) is the **Claude 4.x** family, with the flagship model being **Claude Opus 4.6**.

What makes Claude distinct from other AI models:

- **Constitutional AI training** — Anthropic trains Claude with a "constitution" of principles rather than pure human preference tuning, aiming for helpful, harmless, and honest behavior.
- **Local-first safety** — Claude refuses harmful requests, identifies when it's uncertain, and is designed to be transparent about its limitations.
- **Tool use as a first-class capability** — Claude can use tools (search the web, run code, edit files, control a computer) as naturally as it generates text.

---

## 3. The Model Family

Anthropic maintains three tiers of Claude models. Each generation advances all three tiers.

### Current Models (April 2026)

| Property | Claude Opus 4.6 | Claude Sonnet 4.6 | Claude Haiku 4.5 |
|----------|----------------|-------------------|------------------|
| **Tier** | Flagship | Balanced | Fast & cheap |
| **Best for** | Complex reasoning, coding, agents, analysis | General-purpose work, writing, tool use | Quick tasks, classification, chat |
| **Input price** | $5 / million tokens | $3 / million tokens | $1 / million tokens |
| **Output price** | $25 / million tokens | $15 / million tokens | $5 / million tokens |
| **Context window** | 1,000,000 tokens | 1,000,000 tokens | 200,000 tokens |
| **Max output** | 128,000 tokens | 64,000 tokens | 64,000 tokens |
| **Extended thinking** | Yes (adaptive recommended) | Yes (adaptive recommended) | Yes (manual only) |
| **Adaptive thinking** | Yes | Yes | No |
| **Vision** | Yes | Yes | Yes |
| **Tool use** | Yes | Yes | Yes |
| **Batch output** | Up to 300,000 tokens | Up to 300,000 tokens | 64,000 tokens |
| **Training data cutoff** | Early 2025 | Early 2025 | Early 2025 |

### What the Tiers Mean

- **Opus** is the most intelligent model. Use it when quality matters more than speed or cost — complex coding tasks, deep analysis, multi-step reasoning, or agentic workflows where mistakes are costly.
- **Sonnet** is the everyday workhorse. About 60% the cost of Opus with strong capabilities across the board. Most developers start here.
- **Haiku** is the speed-optimized model. Significantly cheaper, lower latency, smaller context window. Good for high-volume tasks like classification, summarization of short texts, or simple Q&A.

### Model Naming Convention

Model IDs follow the pattern: `claude-{tier}-{version}`

Examples:
- `claude-opus-4-6` — latest Opus (auto-updates)
- `claude-sonnet-4-6` — latest Sonnet
- `claude-haiku-4-5-20251001` — pinned Haiku version (does NOT auto-update)

Pinned versions are recommended for production deployments where you need consistent behavior.

---

## 4. How Claude Works

### The Basic Flow

```
┌──────────┐        ┌─────────────┐        ┌──────────┐
│  Your    │  API   │             │  API   │   Your   │
│  Input   │───────▶│   Claude    │───────▶│  Output  │
│  (text,  │        │   Model     │        │  (text,  │
│  images) │        │             │        │  tool    │
│          │        │             │        │  calls)  │
└──────────┘        └─────────────┘        └──────────┘
```

1. **You send a request** — your message, any system instructions, conversation history, tool definitions, and optional images or documents.
2. **Claude processes everything** — the model reads all input tokens, reasons about them, and generates output tokens one at a time.
3. **You receive a response** — either text, a tool-use request (asking you to do something and return the result), or both.

### The Context Window — Claude's Working Memory

Everything Claude sees in a single request must fit in the context window:

```
┌────────────────────────────────────────────────────────────────┐
│                     CONTEXT WINDOW (e.g., 1M tokens)          │
│                                                                │
│  ┌──────────┐  ┌────────────┐  ┌───────────┐  ┌───────────┐  │
│  │  System   │  │   Convo    │  │   Your    │  │  Claude's │  │
│  │  Prompt   │  │  History   │  │  Message   │  │ Response  │  │
│  │           │  │            │  │ + images  │  │           │  │
│  │  ~5K      │  │  ~100K     │  │  ~10K     │  │ ~128K max │  │
│  └──────────┘  └────────────┘  └───────────┘  └───────────┘  │
│                                                                │
│  Input tokens ◀──────────────────────────▶  Output tokens     │
│  (you pay less)                             (you pay more)    │
└────────────────────────────────────────────────────────────────┘
```

**Key insight:** Claude has no persistent memory between API requests. Each request is independent. If you want Claude to remember previous messages, you must include them in the conversation history. This is why context window size matters — it determines how long a conversation Claude can maintain.

### Tokens and Cost

A rough conversion:
- 1 token ≈ 4 characters of English text
- 1,000 tokens ≈ 750 words
- A typical novel is ~100,000 tokens
- Claude Opus 4.6's 1M-token context ≈ 750,000 words ≈ 7.5 novels

Cost example with Claude Sonnet 4.6:
- Sending 10,000 input tokens = $0.03
- Receiving 1,000 output tokens = $0.015
- Total for that request = $0.045

---

## 5. Model Capabilities

Beyond basic text generation, Claude models have several built-in capabilities that don't require any tools.

### 5.1 Extended Thinking

**What it is:** Claude can "think out loud" before answering, working through complex problems step by step in a dedicated thinking space. This thinking happens in special `thinking` content blocks that are separate from the final answer.

**Why it matters:** For hard problems — math, code debugging, multi-step reasoning, complex analysis — explicit step-by-step thinking dramatically improves accuracy.

**How it works:**
1. You enable thinking in your API request
2. Claude generates thinking tokens (its internal reasoning)
3. Claude generates its final response informed by that reasoning
4. You receive both the thinking summary and the response

**Two modes:**

| Mode | Configuration | When to Use |
|------|-------------|-------------|
| **Adaptive** (recommended) | `thinking: { type: "adaptive" }` | Opus 4.6, Sonnet 4.6. Claude decides when and how much to think based on question complexity. |
| **Manual** | `thinking: { type: "enabled", budget_tokens: N }` | All models. You set an exact token budget for thinking. Deprecated on Opus 4.6 / Sonnet 4.6. |

**The effort parameter** controls how deeply Claude thinks (with adaptive mode):

| Effort Level | Behavior |
|-------------|----------|
| `max` | Always thinks with no depth limit (Opus 4.6 only) |
| `high` (default) | Always thinks, deep reasoning |
| `medium` | Moderate thinking, may skip for simple questions |
| `low` | Minimal thinking, skips for simple tasks |

**Interleaved thinking** (automatic with adaptive mode): Claude can think between tool calls — reason about a tool's result before deciding what to do next. This makes agentic workflows significantly more capable.

**Cost:** You pay for all thinking tokens as output tokens, even though the final response only shows a summary. The full thinking content is encrypted for privacy.

### 5.2 Adaptive Thinking

A specific evolution of extended thinking for Opus 4.6 and Sonnet 4.6. Instead of a fixed token budget, Claude dynamically determines whether and how much to think. Benefits over manual:
- Better performance on bimodal tasks (mix of easy and hard questions)
- Automatic interleaved thinking with tools
- No need to guess the right budget

### 5.3 Vision (Image Understanding)

Claude can analyze images alongside text. It understands photos, screenshots, charts, diagrams, handwritten notes, and documents.

**Capabilities:**
- Describe image content in detail
- Read text within images (OCR)
- Analyze charts and graphs
- Compare multiple images
- Answer questions about image content

**Specifications:**
- Supported formats: JPEG, PNG, GIF, WebP
- Maximum image size: 8000×8000 pixels
- Up to 600 images per API request (100 for 200K-context models)
- Images are provided as base64-encoded data, URLs, or via the Files API

**Cost:** Image tokens scale with resolution. A 1092×1092 image ≈ 1,590 tokens (~$0.0048 with Sonnet 4.6).

**Limitations:**
- Cannot identify people by name
- May struggle with precise spatial reasoning (analog clocks, chess positions)
- Approximate counting of small objects
- Cannot determine if an image is AI-generated
- Not designed for diagnostic medical imaging

### 5.4 PDF Support

Claude can read and analyze PDF documents natively. PDFs are automatically converted to a format Claude can understand. This works through the Files API or inline via base64 encoding.

### 5.5 Citations

Claude can cite specific passages from source documents when generating responses. For web search, citations are always enabled and include URL, title, and the exact cited text. For web fetch and document analysis, citations are optional.

### 5.6 Structured Outputs

Claude can generate responses in strict JSON format. With `strict: true` on a tool definition, Claude's output is guaranteed to match the specified JSON schema exactly. This is essential for building reliable automated pipelines.

### 5.7 Batch Processing

For non-time-sensitive workloads, the Message Batches API processes up to thousands of requests asynchronously at **50% cost savings**. Results are returned within 24 hours. With a beta header, batch output can reach 300,000 tokens per request.

### 5.8 Data Residency

The `inference_geo` parameter lets you specify that your data should only be processed within a specific geographic region (e.g., US only). Important for compliance requirements.

---

## 6. Tools — What Claude Can Do

Tools are what transform Claude from a text generator into an agent that can take actions. Claude's tools fall into two categories: **server-side** (Anthropic runs them) and **client-side** (the developer runs them).

### 6.1 Server-Side Tools

These run on Anthropic's infrastructure. You include them in your API request, and Anthropic handles execution. The results appear inline in Claude's response.

#### Code Execution

**What it does:** Runs Python scripts and Bash commands in a secure sandboxed container on Anthropic's servers.

**Why it matters:** Claude can analyze data, create visualizations, run calculations, and process files — verifying its own work rather than just generating code and hoping it's correct.

**Container specs:**
- Python 3.11 with pandas, numpy, scipy, scikit-learn, matplotlib, seaborn, and many more
- Bash commands for system operations
- 5 GiB RAM, 5 GiB disk, 1 CPU
- No internet access (completely sandboxed)
- Containers persist for 30 days and can be reused across requests

**Pricing:** Free when used with web search or web fetch. Otherwise, billed by execution time ($0.05/hr after 1,550 free hours/month/org).

#### Web Search

**What it does:** Claude searches the internet for real-time information.

**Why it matters:** Claude's training data has a cutoff date. Web search lets it answer questions about current events, live prices, recent news, and anything else that changes over time.

**Features:**
- Domain filtering (allowlist/blocklist specific websites)
- Location-based results
- Automatic citations with every search result
- Dynamic filtering (Opus 4.6 / Sonnet 4.6): Claude can write code to filter search results before loading them into context, keeping only relevant information

**Pricing:** $10 per 1,000 searches + standard token costs.

#### Web Fetch

**What it does:** Retrieves the full content from a specific URL — web pages or PDF documents.

**Why it matters:** When Claude finds a relevant search result, it can fetch the full page to analyze it in detail, rather than relying on search snippets.

**Features:**
- Full HTML-to-text conversion
- PDF text extraction
- Optional citations from fetched content
- Dynamic filtering (Opus 4.6 / Sonnet 4.6): Claude filters fetched content via code before loading into context
- Token limiting via `max_content_tokens`

**Security:** Claude can only fetch URLs that appeared in the conversation (user-provided or from prior search results). It cannot fabricate URLs.

**Pricing:** No additional cost beyond standard token fees.

### 6.2 Client-Side Tools

These run in the developer's environment, not on Anthropic's servers. When Claude wants to use one, it sends a `tool_use` response, your code executes the action, and you return the result as a `tool_result` message. The developer is fully in control.

#### Bash Tool

**What it does:** Executes shell commands in a persistent terminal session that maintains state (environment variables, working directory, running processes) across multiple calls.

**Why it matters:** Claude can install packages, run build scripts, manage files, execute test suites, and interact with the operating system.

**Key details:**
- Schema-less — the tool definition is built directly into Claude's model weights (245 tokens of overhead)
- Persistent session — state carries across calls within a conversation
- No interactive commands (no `vim`, `less`, password prompts)
- No GUI applications
- Security recommendation: use an allowlist approach (specify what's allowed) rather than a blocklist (specify what's blocked)

#### Text Editor Tool

**What it does:** Views, creates, and edits files through structured commands.

**Commands:**
| Command | What It Does |
|---------|-------------|
| `view` | Read a file (with optional line range) |
| `create` | Create a new file with specified content |
| `str_replace` | Find exact text in a file and replace it |
| `insert` | Insert text at a specific line number |

**Key details:**
- Schema-less — built into model weights (700 tokens of overhead)
- The `undo_edit` command was removed in Claude 4
- `max_characters` parameter can truncate large files

#### Computer Use

**What it does:** Claude takes screenshots of a desktop, analyzes what's on screen, and controls the mouse and keyboard — operating a computer the same way a human would.

**This is the most visually dramatic capability** and gets a [deep dive in Section 12](#12-computer-use--deep-dive).

**Key details:**
- Client-side tool — the developer provides the computing environment (typically a Docker container)
- 735 tokens overhead + 466–499 system prompt tokens
- Actions: click, double-click, right-click, type, key press, scroll, screenshot, cursor position, drag, move, zoom
- The model "sees" through screenshots, not a video stream

#### Memory Tool

**What it does:** Stores and retrieves information across conversations. Allows Claude to maintain a persistent memory system.

**Key details:**
- Three scopes: user memory (persists across workspaces), session memory (current conversation), repository memory (workspace-scoped)
- Operations: view, create, str_replace, insert, delete, rename

### 6.3 Custom (Developer-Defined) Tools

Beyond the built-in tools above, developers can define their own tools with:
- A name and description
- A JSON schema for the tool's parameters
- Their own execution logic

Claude reads the tool descriptions and schemas, decides when to use them, and generates structured calls that match the schema. This is the foundation of Claude's extensibility.

---

## 7. Code vs Skills — The Key Distinction

This is an important architectural concept in Claude's tool system.

### "Code" — Built-In Tools

The Bash tool, Text Editor tool, Computer Use tool, and Memory tool are **built into Claude's model weights**. They are "schema-less" — their behavior is not defined by a JSON schema you provide but is instead baked into the model itself during training.

**Characteristics:**
- Always available (just include the tool type in your request)
- No schema definition needed
- Fixed token overhead per tool (you pay it whether the tool is used or not)
- Behavior is determined by training, not configuration
- You can't change how these tools work — only control whether they're available

### "Skills" — Modular Capability Packages

Agent Skills are **external packages** of instructions, scripts, and resources that extend what Claude can do. They are not built into the model — they live on the filesystem and Claude reads them on demand.

**Characteristics:**
- Loaded progressively (only when relevant to the task)
- User-creatable and customizable
- Can include executable scripts Claude runs via Bash
- Bundle reference materials, examples, and workflows
- No context cost for unused skills (only metadata is always loaded)

**The analogy:** Built-in tools are like Claude's natural abilities (seeing, typing, running commands). Skills are like reference manuals and specialized tools you give Claude for specific jobs (creating PowerPoint presentations, processing invoices, following your team's coding standards).

---

## 8. Agent Skills

### What Are Skills?

Skills are reusable, filesystem-based resource packages that transform Claude from a general-purpose assistant into a domain specialist. Each Skill is a directory containing:

```
my-skill/
├── SKILL.md          ← Main instructions (required)
├── REFERENCE.md      ← Additional documentation
├── templates/        ← Template files
└── scripts/
    └── process.py    ← Executable scripts
```

### Progressive Disclosure — How Skills Load

Skills use a three-level loading system to minimize context usage:

| Level | What Loads | When | Token Cost |
|-------|-----------|------|-----------|
| **1. Metadata** | Skill name + 1-line description (YAML frontmatter) | Always (at startup) | ~100 tokens per skill |
| **2. Instructions** | SKILL.md body (workflows, best practices) | When skill is triggered by a relevant request | Under 5K tokens |
| **3. Resources** | Scripts, templates, reference files | Only when referenced in instructions | Effectively unlimited (scripts output only, not loaded) |

**Key insight:** You can install dozens of skills with negligible cost. Claude only loads a skill's content when it determines the skill is relevant to the current task.

### Pre-Built Skills

Anthropic provides four production-ready skills:

| Skill | ID | What It Does |
|-------|-----|-------------|
| **PowerPoint** | `pptx` | Create presentations, edit slides, analyze content |
| **Excel** | `xlsx` | Create spreadsheets, analyze data, generate charts |
| **Word** | `docx` | Create documents, edit content, format text |
| **PDF** | `pdf` | Generate formatted PDF documents and reports |

### Custom Skills

Developers can create their own skills with domain-specific knowledge:
- Coding standards and review checklists
- Data pipeline workflows
- Company-specific processes
- Specialized analysis procedures

Custom skills are created with a `SKILL.md` file containing YAML frontmatter (`name`, `description`) and markdown-formatted instructions.

### Where Skills Work

| Platform | Pre-Built | Custom | Sharing |
|----------|-----------|--------|---------|
| Claude API | Yes | Yes (upload via `/v1/skills`) | Workspace-wide |
| claude.ai | Yes (automatic) | Yes (upload as zip) | Individual user only |
| Claude Code | No | Yes (filesystem `.claude/skills/`) | Personal or project-based |
| Agent SDK | No | Yes (filesystem `.claude/skills/`) | Per-project |

---

## 9. Tool Infrastructure

Beyond individual tools, Claude has infrastructure-level capabilities for managing and scaling tool usage.

### 9.1 MCP Connector

**What it is:** Claude can connect directly to remote MCP (Model Context Protocol) servers from the Messages API, without the developer implementing an MCP client.

**Why it matters:** MCP is the universal plugin standard for AI. With the MCP connector, developers can give Claude access to databases, SaaS APIs, custom backends, and any other service that exposes an MCP server — just by providing a URL.

**Features:**
- Connect to multiple MCP servers in a single request
- Tool allowlisting/denylisting per server
- Per-tool configuration
- OAuth authentication support
- Deferred loading (tool descriptions not sent until needed)

**Limitation:** Only HTTP-accessible MCP servers (Streamable HTTP or SSE transport). Local stdio servers require client-side helpers.

### 9.2 Tool Search

**What it is:** When an application has thousands of tools available, Claude can use regex-based search to discover relevant tools on demand instead of loading all tool definitions into the system prompt.

**Why it matters:** Tool descriptions consume context tokens. With 10 tools, this is fine. With 1,000 tools, it's impractical. Tool search lets Claude scale to thousands of tools by loading definitions only when needed.

### 9.3 Programmatic Tool Calling

**What it is:** Claude can call tools from within the code execution container itself — writing code that invokes tools as part of a script rather than making separate tool-use requests.

**Why it matters:** For complex workflows, Claude can chain tool calls inside a script, process intermediate results programmatically, and return only the final output. This reduces round-trips and context usage.

### 9.4 Fine-Grained Tool Streaming

Tool use and tool results can be streamed incrementally as they happen, giving real-time visibility into what Claude is doing during complex multi-tool operations.

---

## 10. Context Management

Managing the context window is critical for long conversations and agentic workflows. Claude provides several mechanisms:

### 10.1 Compaction

**What it is:** Server-side summarization that compresses conversation history when the context window fills up.

**Available on:** Opus 4.6, Sonnet 4.6

**How it works:** When the conversation grows too long, Claude intelligently summarizes earlier messages, preserving key facts and decisions while freeing up space for new content.

### 10.2 Context Editing

**What it is:** Configurable strategies for selectively clearing or modifying context — such as removing verbose tool results from earlier turns.

### 10.3 Prompt Caching

**What it is:** A system that stores and reuses processed prompt content across requests.

**Three variants:**

| Variant | Cache Duration | Use Case |
|---------|---------------|----------|
| **Automatic** | System-managed | Enabled with a single parameter. Anthropic handles when and what to cache. |
| **5-minute** | 5 minutes | Standard multi-turn conversations |
| **1-hour** | 60 minutes | Extended thinking sessions, long-running agentic workflows |

**Cost savings:** Cache reads are significantly cheaper than reprocessing. For a conversation with a large system prompt and many turns, caching can reduce costs by 50–90% on the cached portion.

### 10.4 Token Counting

**What it is:** An API endpoint that returns exact token counts for a given input, without generating a response. Useful for budget management and context optimization.

---

## 11. Files API

**What it is:** An API for uploading and managing files that Claude can reference across multiple requests.

**Why it matters:** Without the Files API, you must embed entire files (as base64 or text) in every request. With the Files API, you upload once and reference by `file_id` — keeping request payloads small regardless of how many files are involved.

**Supported file types:** PDFs, images (JPEG, PNG, GIF, WebP), text files, CSV, Excel, JSON, XML, and more.

**Retention:** Files persist until explicitly deleted.

---

## 12. Computer Use — Deep Dive

Computer Use is Claude's most visually dramatic capability and represents a fundamentally different approach to AI-computer interaction. Instead of programmatic APIs and structured tool calls, Claude operates a computer the way a human does — by looking at the screen and moving the mouse.

### 12.1 Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     AGENT LOOP                           │
│                                                          │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐   │
│  │  User     │───▶│  Claude   │───▶│  Tool Executor   │   │
│  │  Prompt   │    │  (API)    │    │  (Your Code)     │   │
│  └──────────┘    └─────┬─────┘    └────────┬─────────┘   │
│                        │                   │              │
│                        │  tool_use         │  tool_result │
│                        │  response         │  (screenshot │
│                        │                   │   or output) │
│                        │                   │              │
│                        └───────────────────┘              │
│                                                          │
│  Repeat until Claude responds without tool_use           │
│  (task complete) or max iterations reached               │
└──────────────────────────────────────────────────────────┘
```

**Critical insight:** Claude never directly connects to the desktop. The developer's application:
1. Receives Claude's tool-use requests (e.g., "click at [x, y]")
2. Translates them into actual actions in the computing environment
3. Captures results (screenshots, command outputs)
4. Returns results to Claude as `tool_result` messages

This is a **client-side tool** — all actions happen in the developer's controlled environment, not on Anthropic's servers.

### 12.2 The Three Companion Tools

Computer Use works best as a trio:

| Tool | Type | Purpose | Token Overhead |
|------|------|---------|---------------|
| **Computer** | `computer_20251124` | Screenshot capture, mouse control, keyboard input | 735 tokens |
| **Text Editor** | `text_editor_20250728` | File viewing and editing | 700 tokens |
| **Bash** | `bash_20250124` | Shell command execution | 245 tokens |

### 12.3 Available Actions

| Action | What It Does |
|--------|-------------|
| `screenshot` | Capture current screen state |
| `click` | Single-click at coordinates |
| `double_click` | Double-click at coordinates |
| `right_click` | Right-click at coordinates |
| `type` | Type text string |
| `key` | Press key combination (e.g., Ctrl+S) |
| `scroll` | Scroll up/down |
| `cursor_position` | Get current cursor position |
| `drag` | Click and drag from one point to another |
| `move` | Move cursor without clicking |
| `zoom` | Zoom in/out (added in 20251124) |

### 12.4 The Reference Environment

Anthropic provides a Docker-based reference implementation:

| Component | Implementation | Purpose |
|-----------|---------------|---------|
| Virtual display | Xvfb (X11 Virtual Framebuffer) | Renders the desktop Claude "sees" |
| Window manager | Mutter | Provides consistent GUI |
| Applications | Firefox, LibreOffice, text editors, file managers | Pre-installed tools |
| Tool handlers | Python | Translate Claude's requests into Xdotool actions |
| Agent loop | Python (Streamlit UI) | Orchestrates the Claude ↔ environment loop |

### 12.5 Training Approach

From Anthropic's disclosures:
1. Claude was first trained on tool use and multimodality as foundations
2. Computer use training used **simple software** (calculator, text editor) — no internet access during training
3. A key breakthrough was training Claude to **count pixels** accurately
4. The model generalized rapidly from simple software to complex desktop automation
5. Claude self-corrects and retries when encountering obstacles

### 12.6 Security Considerations

Computer Use is inherently risky because Claude controls an actual computer:

- **Prompt injection:** Malicious content on web pages could influence Claude's actions
- **Authentication risk:** Claude should never have access to accounts, passwords, or sensitive credentials
- **Network access:** The computing environment should be isolated; Claude could be tricked into making harmful network requests
- **Irreversible actions:** Always implement human confirmation for destructive operations

**Anthropic's recommendations:**
- Run in dedicated virtual machines or containers
- Restrict network access
- Limit available sensitive data
- Implement human-in-the-loop for high-stakes actions
- Pre-authenticate specific sites rather than giving Claude credentials

---

## 13. Security Model

### API-Level Security

- **API key authentication** — every request requires a valid API key
- **Rate limiting** — per-organization request and token limits
- **Zero Data Retention (ZDR)** — organizations can opt into arrangements where API data is not stored after the response is returned (available for most features; code execution and MCP connector are excluded)
- **Data residency** — `inference_geo` parameter for geographic processing constraints

### Tool Security

| Tool Category | Security Model |
|--------------|---------------|
| Server-side tools (code execution, web search, web fetch) | Sandboxed on Anthropic's infrastructure. No internet from code execution containers. |
| Client-side tools (bash, text editor, computer use) | Developer's responsibility. Developer controls the execution environment. |
| MCP connector | OAuth authentication. HTTPS required. Developer controls which tools are exposed. |
| Agent Skills | Filesystem-based. Skill code runs in code execution container (same sandbox). Security depends on trusting the skill author. |

### Content Safety

Claude is trained to:
- Refuse harmful, illegal, or dangerous requests
- Identify when it's uncertain and say so
- Not generate CSAM, detailed instructions for weapons/drugs, or malware
- Follow Anthropic's Acceptable Use Policy

---

## 14. Comparison with OpenClaw

This section compares Claude's API capabilities with OpenClaw, Parallx's local-first AI runtime.

| Capability | Claude (API) | OpenClaw (Parallx) |
|-----------|-------------|-------------------|
| **Inference** | Cloud (Anthropic servers) | Local (Ollama at localhost:11434) |
| **Models** | Claude Opus/Sonnet/Haiku (proprietary) | Any Ollama model (open-weight: Qwen, Llama, etc.) |
| **Cost** | Per-token pricing ($1–$25/MTok) | Free (runs on your hardware) |
| **Context window** | Up to 1,000,000 tokens | Model-dependent (typically 4K–128K) |
| **Tools** | 7 built-in + unlimited custom | 20 built-in + MCP extension |
| **Tool execution** | Server-side + client-side | All local (workspace-sandboxed) |
| **Code execution** | Sandboxed container (Python 3.11) | Terminal tool (`run_command`) in workspace directory |
| **Web search** | Built-in server tool | Not built-in; available via MCP |
| **Web fetch** | Built-in server tool | Not built-in; available via MCP |
| **Computer Use** | Screenshot + mouse/keyboard (beta) | None (no GUI interaction) |
| **Vision** | Yes (images, PDFs, charts) | Model-dependent |
| **Extended thinking** | Adaptive/manual modes | Session toggle (`/think`) |
| **MCP** | Connector (remote HTTP servers) | Client (stdio + SSE, local servers) |
| **Agent Skills** | Pre-built (PPTX, XLSX, DOCX, PDF) + custom | Workspace skills (`.parallx/` bootstrap files) |
| **Memory** | Cross-conversation persistence | Durable + daily memory layers |
| **RAG** | Web search (live data) | Embedded workspace indexing (nomic-embed-text) |
| **Approvals** | Developer-implemented | Built-in 3-tier permission system |
| **Sub-agents** | Via Agent SDK | Built-in spawner (max depth 3, max concurrent 5) |
| **Scheduled tasks** | Not built-in | Cron service (max 50 jobs) |
| **Proactive** | Not built-in | Heartbeat runner (5-min default interval) |
| **Privacy** | Data sent to Anthropic (ZDR optional) | Everything stays local |
| **Batch processing** | Yes (50% cost savings) | Not applicable (no per-request cost) |

**When to use Claude's API:** When you need the highest intelligence tier, massive context windows, web access, code execution in a sandboxed environment, Computer Use for GUI automation, or production-scale batch processing.

**When to use OpenClaw:** When privacy is paramount, cost must be zero, you need deep workspace integration (pages, canvas, properties), proactive scheduling, or you're running offline.

---

## 15. Sources

All information in this document is sourced from official Anthropic documentation accessed in June–July 2026:

- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models) — model specifications, pricing, capabilities
- [Build with Claude: Overview](https://platform.claude.com/docs/en/build-with-claude/overview) — full feature catalog
- [Tool Use Overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — tool categories, pricing, client vs server tools
- [Extended Thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) — thinking modes, budgets, interleaved thinking
- [Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) — dynamic thinking allocation, effort parameter
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) — image capabilities, limits, cost
- [Code Execution Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool) — sandbox specs, pricing, container reuse
- [Web Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) — search mechanics, dynamic filtering, pricing
- [Web Fetch Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) — fetch mechanics, security, pricing
- [Bash Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool) — persistent sessions, security, limitations
- [Text Editor Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) — commands, pricing, changelog
- [Computer Use](https://platform.claude.com/docs/en/agents-and-tools/computer-use) — architecture, reference environment, security
- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — progressive disclosure, pre-built skills, custom skills
- [MCP Connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) — configuration, authentication, multiple servers
