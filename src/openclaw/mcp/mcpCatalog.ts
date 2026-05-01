// mcpCatalog.ts — M61 Phase 3
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
  /** Env vars the user must / may provide. */
  readonly env: readonly IMcpCatalogEnvVar[];
}

/**
 * The static catalog.
 *
 * Keep entries conservative: only servers the user can install with a
 * single `npx` invocation and no extra OS dependencies. Servers that need
 * Docker, Python, or local databases are not listed.
 */
export const MCP_CATALOG: readonly IMcpCatalogEntry[] = Object.freeze([
  {
    id: 'filesystem',
    displayName: 'Filesystem',
    description: 'Read and write files on your local disk under the directories you allow.',
    category: 'Storage',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: [
      {
        key: 'PARALLX_MCP_FS_ROOT',
        label: 'Allowed root path',
        description:
          'Absolute path the server is allowed to read/write under. Leave blank to default to your workspace folder.',
        required: false,
      },
    ],
  },
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Browse, search, and modify GitHub repos via the REST API.',
    category: 'Dev',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub PAT',
        description:
          'Personal access token. Create one at https://github.com/settings/tokens with the scopes you need (repo, read:org).',
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'gmail',
    displayName: 'Gmail',
    description: 'Read and send Gmail messages on the signed-in account.',
    category: 'Communication',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/gmail',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gmail'],
    env: [
      {
        key: 'GMAIL_CREDENTIALS_PATH',
        label: 'Credentials JSON path',
        description:
          'Absolute path to a Google OAuth client credentials JSON file. See docs/ai/GMAIL_MCP_INTEGRATION.md.',
        required: true,
      },
    ],
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description: 'Read and post Slack messages with a bot token.',
    category: 'Communication',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot token',
        description:
          'Slack bot user OAuth token (xoxb-...). Create a Slack app and grant scopes (chat:write, channels:read).',
        required: true,
        secret: true,
      },
      {
        key: 'SLACK_TEAM_ID',
        label: 'Team ID',
        description: 'Your Slack workspace ID (e.g. T0123ABCD).',
        required: true,
      },
    ],
  },
  {
    id: 'brave-search',
    displayName: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    category: 'Web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
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
    id: 'fetch',
    displayName: 'Fetch',
    description: 'Fetch arbitrary URLs and convert HTML to markdown for the agent.',
    category: 'Web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: [],
  },
]);

/** Look up a catalog entry by id. */
export function getCatalogEntry(id: string): IMcpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}
