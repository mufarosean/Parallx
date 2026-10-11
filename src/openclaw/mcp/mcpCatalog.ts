// mcpCatalog.ts
//
// Curated, in-app catalog of well-known MCP servers. Shipped statically;
// no network fetch. Each entry declares the install command, the env vars
// it needs (with help text), and a homepage URL for the user to learn more.
//
// Catalog entries never embed secrets. The user fills in env values at
// install time; the resulting `IMcpServerConfig` (with `env`) is written
// to workspace storage via `IMcpClientService.addServerConfig`.

export interface IMcpCatalogEnvVar {
  /** Environment variable name passed to the server process. */
  readonly key: string;
  /** Short label shown next to the input. */
  readonly label: string;
  /** Help text — explain where to obtain the value. */
  readonly description: string;
  /** Whether the user must fill this in. */
  readonly required: boolean;
  /** Whether to mask the input (passwords, API keys). */
  readonly secret?: boolean;
}

export interface IMcpCatalogEntry {
  /** Stable id; used as the resulting `IMcpServerConfig.id`. */
  readonly id: string;
  /** Friendly display name for the catalog list and `IMcpServerConfig.name`. */
  readonly displayName: string;
  /** One-sentence description shown in the catalog list. */
  readonly description: string;
  /** Tags for grouping (e.g. "Communication", "Storage", "Dev"). */
  readonly category: string;
  /** Public homepage / install docs. */
  readonly homepage: string;
  /** stdio command (typically `npx`). */
  readonly command: string;
  /** stdio args. */
  readonly args: readonly string[];
  /**
   * Optional: marks this entry as a bundled server shipped inside the
   * Parallx repo. When set, `args` may contain the placeholder
   * `{appRoot}` which is substituted at install time with the absolute
   * path to the Parallx install root (`window.parallxElectron.appPath`).
   * This lets bundled servers (like the Gmail MCP server at
   * `tools/gmail-mcp-server/bundle/server.mjs`) be installed with one
   * click — no manual path entry by the user.
   */
  readonly bundled?: boolean;
  /**
   * Optional: this server requires a one-time OAuth flow before it can
   * be used. When set, the install dialog shows a "Connect" button that
   * spawns the server with `--auth` to complete authorization. The
   * server is only registered with Parallx after auth succeeds.
   */
  readonly requiresOAuth?: boolean;
  /** Env vars the user must / may provide. */
  readonly env: readonly IMcpCatalogEnvVar[];
}

/**
 * The static catalog.
 *
 * Keep entries conservative: only servers the user can install with a
 * single `npx` invocation and no extra OS dependencies. Servers that need
 * Docker, Python, or local databases are not listed.
 *
 * Checked against npm on 2026-10-11. GitHub and Slack left: their npx
 * packages are deprecated and the maintained servers run in Docker or
 * remotely (over HTTP, which Parallx does not speak yet). Fetch left: no
 * npx package exists (the reference server is Python). Brave Search moved
 * to Brave's own package.
 */
export const MCP_CATALOG: readonly IMcpCatalogEntry[] = Object.freeze([
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    description: 'Read and write files in your workspace folder.',
    category: 'Storage',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    command: 'npx',
    // The server takes the folders it may touch as arguments; {workspaceRoot}
    // is resolved to the open workspace folder each time it connects.
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{workspaceRoot}'],
    env: [],
  },
  // Gmail intentionally not in the npx catalog: the bundled
  // `tools/gmail-mcp-server/` is self-contained and installed via the
  // local clone+build+`--auth` flow described in
  // docs/ai/GMAIL_MCP_INTEGRATION.md, not via a single `npx -y` invocation.
  {
    id: 'gmail',
    displayName: 'Gmail',
    description:
      'Read-only Gmail access. Lists unread messages with sender, subject, snippet, and labels. Bundled — no install or build required.',
    category: 'Communication',
    homepage: 'https://github.com/modelcontextprotocol/servers',
    command: 'node',
    args: ['{appRoot}/tools/gmail-mcp-server/bundle/server.mjs'],
    bundled: true,
    requiresOAuth: true,
    env: [],
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    category: 'Web',
    homepage: 'https://github.com/brave/brave-search-mcp-server',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    env: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API key',
        description: 'Get one at https://api.search.brave.com (free tier available).',
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'memory',
    displayName: 'Memory',
    description: 'Persistent key/value memory store the agent can read and write.',
    category: 'Storage',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: [],
  },
  {
    id: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description: 'Step-by-step reasoning helper that exposes a `think` tool.',
    category: 'Reasoning',
    homepage:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: [],
  },
  {
    id: 'anki',
    displayName: 'Anki',
    description:
      'Create, search, and review Anki spaced-repetition flashcards. Requires the Anki desktop app to be running with the AnkiConnect add-on installed (add-on code 2055492159).',
    category: 'Study',
    homepage: 'https://github.com/ankimcp/anki-mcp-server',
    command: 'npx',
    // `--stdio` is required: without it the server starts in HTTP mode and
    // never speaks JSON-RPC over stdio, so Parallx's transport can't connect.
    args: ['-y', '@ankimcp/anki-mcp-server', '--stdio'],
    env: [
      {
        key: 'ANKI_CONNECT_URL',
        label: 'AnkiConnect URL',
        description:
          'Where AnkiConnect is listening. Leave blank for the default (http://localhost:8765). Change only if you set a custom bind address/port in the AnkiConnect add-on config.',
        required: false,
      },
      {
        key: 'ANKI_CONNECT_API_KEY',
        label: 'AnkiConnect API key',
        description:
          'Only needed if you set an apiKey in the AnkiConnect add-on config. Leave blank otherwise.',
        required: false,
        secret: true,
      },
    ],
  },
]);

/** Look up a catalog entry by id. */
export function getCatalogEntry(id: string): IMcpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
