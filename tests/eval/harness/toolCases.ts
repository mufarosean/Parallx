/**
 * Per-tool eval cases — vague-prompt → expected tool.
 *
 * Each case asks for something a real user would ask, in plain language,
 * with NO hint about which tool to use. The model is judged on whether
 * it reaches for the right tool. Cases live next to the harness so they
 * can be tuned without touching test code.
 *
 * Coverage philosophy: at least one case per category from the manifest,
 * extras for tools that are easy to confuse (canvas_* vs. file_*) and
 * the autonomy surface the user flagged as broken.
 */
import type { SingleToolEvalCase } from '../harness/scorer.js';

export const TOOL_EVAL_CASES: SingleToolEvalCase[] = [
  // ── File tools ─────────────────────────────────────────────────────────────
  { id: 'file-list-1', prompt: 'What files are in the src folder?', expectedTool: 'list_files' },
  { id: 'file-read-1', prompt: 'Open README.md and tell me what it says.', expectedTool: 'read_file' },
  { id: 'file-write-1', prompt: 'Create a new file called notes.md with the heading "TODOs".', expectedTool: 'write_file', allowedTools: ['edit_file'] },
  { id: 'file-edit-1', prompt: 'In src/index.ts, change the log message to "ready".', expectedTool: 'edit_file' },

  // ── Search ─────────────────────────────────────────────────────────────────
  { id: 'search-grep-1', prompt: 'Where is the word "openclaw" used in the codebase?', expectedTool: 'grep_search', allowedTools: ['search_files'] },
  { id: 'search-find-1', prompt: 'Find every .ts file under src/services.', expectedTool: 'search_files', allowedTools: ['list_files', 'grep_search'] },

  // ── Canvas pages (vs. files — easy to confuse) ──────────────────────────────
  { id: 'canvas-find-1', prompt: 'Show me my canvas pages about exam prep.', expectedTool: 'canvas_find_pages' },
  { id: 'canvas-read-1', prompt: 'Read the canvas page titled "Daily Notes".', expectedTool: 'canvas_read_page' },
  { id: 'canvas-create-1', prompt: 'Make a new canvas page called "Meeting Notes" with a few starter bullets.', expectedTool: 'canvas_create_page' },

  // ── Terminal ───────────────────────────────────────────────────────────────
  { id: 'terminal-1', prompt: 'Run the test suite for me.', expectedTool: 'run_command' },

  // ── Workspace memory / transcript ──────────────────────────────────────────
  { id: 'memory-1', prompt: 'What do you remember about my preferences?', expectedTool: 'memory_get', allowedTools: ['memory_search'] },
  { id: 'transcript-1', prompt: 'Did we talk about pricing last week?', expectedTool: 'transcript_search', allowedTools: ['transcript_get'] },

  // ── Autonomy / cron — user flagged this surface ────────────────────────────
  { id: 'cron-list-1', prompt: 'What scheduled tasks do I have?', expectedTool: 'cron_list', allowedTools: ['cron_status'] },
  { id: 'cron-add-1', prompt: 'Remind me every morning at 8 to check my inbox.', expectedTool: 'cron_add' },
  { id: 'autonomy-log-1', prompt: 'What did my agents do while I was away?', expectedTool: 'autonomy_log' },

  // ── Subagent spawn ─────────────────────────────────────────────────────────
  { id: 'sessions-spawn-1', prompt: 'Spin off a sub-task to research vector databases in the background.', expectedTool: 'sessions_spawn' },

  // ── Web research ───────────────────────────────────────────────────────────
  { id: 'web-search-1', prompt: 'Look up the latest news on AI safety regulation.', expectedTool: 'webSearch' },
  { id: 'web-fetch-1', prompt: 'Pull the contents of https://example.com/article and summarise.', expectedTool: 'webFetch' },

  // ── Budget extension ───────────────────────────────────────────────────────
  { id: 'budget-summary-1', prompt: 'How much have I spent this month?', expectedTool: 'budget.summary' },
  { id: 'budget-search-1', prompt: 'Show me every grocery transaction last week.', expectedTool: 'budget.search' },

  // ── Media-organizer ────────────────────────────────────────────────────────
  { id: 'mo-stats-1', prompt: 'How many images are in my library?', expectedTool: 'mediaOrganizer.getStats' },
  { id: 'mo-search-1', prompt: 'Find pictures of landscapes.', expectedTool: 'mediaOrganizer.search' },
  { id: 'mo-tags-1', prompt: 'List all my tags.', expectedTool: 'mediaOrganizer.listTags' },

  // ── App commands ───────────────────────────────────────────────────────────
  { id: 'app-cmd-1', prompt: 'Toggle the explorer sidebar.', expectedTool: 'app__find_commands', allowedTools: ['app__run_command'] },
];
