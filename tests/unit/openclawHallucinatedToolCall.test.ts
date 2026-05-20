// openclawHallucinatedToolCall.test.ts — M67 follow-up
//
// Tests the `_detectHallucinatedToolCall` helper from openclawAttempt.
// The detector flags model text that narrates a tool call WITHOUT the
// corresponding `tool_calls` structure being emitted. Used as a guard
// for OSS models with weak tool-use training that "play act" tool calls
// in their reply text.

import { describe, expect, it } from 'vitest';
import { _detectHallucinatedToolCall } from '../../src/openclaw/openclawAttempt';

const TOOLS = ['read_file', 'list_files', 'canvas_read_page', 'search_knowledge', 'budget.sync'];

describe('_detectHallucinatedToolCall', () => {
  describe('pattern A — "I called X" / "I ran X" / etc.', () => {
    it('flags "I called read_file"', () => {
      expect(_detectHallucinatedToolCall('I called read_file and found the answer.', TOOLS)).toBe('read_file');
    });

    it('flags "I just ran list_files"', () => {
      expect(_detectHallucinatedToolCall('I just ran list_files in the docs directory.', TOOLS)).toBe('list_files');
    });

    it('flags "I invoked canvas_read_page"', () => {
      expect(_detectHallucinatedToolCall('I invoked canvas_read_page to fetch the page.', TOOLS)).toBe('canvas_read_page');
    });

    it('flags backtick-wrapped tool name: "I called `read_file`"', () => {
      expect(_detectHallucinatedToolCall('I called `read_file` against your README.', TOOLS)).toBe('read_file');
    });

    it('case-insensitive verb', () => {
      expect(_detectHallucinatedToolCall('I Called read_file.', TOOLS)).toBe('read_file');
    });
  });

  describe('pattern B — "used the X tool"', () => {
    it('flags "I used the read_file tool"', () => {
      expect(_detectHallucinatedToolCall('I used the read_file tool to peek inside.', TOOLS)).toBe('read_file');
    });

    it('flags "using the search_knowledge tool"', () => {
      expect(_detectHallucinatedToolCall('Now using the search_knowledge tool.', TOOLS)).toBe('search_knowledge');
    });

    it('flags backtick-wrapped tool name', () => {
      expect(_detectHallucinatedToolCall('I used the `list_files` tool earlier.', TOOLS)).toBe('list_files');
    });
  });

  describe('does NOT flag natural-language past tense that happens to use action verbs', () => {
    it('"I read the docs" does NOT match (no tool name)', () => {
      expect(_detectHallucinatedToolCall('I read the docs you mentioned.', TOOLS)).toBeNull();
    });

    it('"I used the search bar" does NOT match (search_bar isn\'t a real tool)', () => {
      expect(_detectHallucinatedToolCall('I used the search bar at the top.', TOOLS)).toBeNull();
    });

    it('"I checked the file system" does NOT match', () => {
      expect(_detectHallucinatedToolCall('I checked the file system structure.', TOOLS)).toBeNull();
    });

    it('"using your existing approach" does NOT match', () => {
      expect(_detectHallucinatedToolCall('Following your existing approach.', TOOLS)).toBeNull();
    });

    it('"I\'ll call read_file next" (future-tense intent) does NOT match', () => {
      expect(_detectHallucinatedToolCall("I'll call read_file next.", TOOLS)).toBeNull();
    });

    it('"Let me call read_file" (intent, not past) does NOT match', () => {
      expect(_detectHallucinatedToolCall('Let me call read_file to find out.', TOOLS)).toBeNull();
    });
  });

  describe('boundary handling', () => {
    it('respects word boundaries — does NOT match partial tool name', () => {
      expect(_detectHallucinatedToolCall('I called pre_read_filefoo earlier.', TOOLS)).toBeNull();
    });

    it('handles tool names with dots (regex-escaped)', () => {
      expect(_detectHallucinatedToolCall('I ran budget.sync just now.', TOOLS)).toBe('budget.sync');
    });

    it('returns null for empty markdown', () => {
      expect(_detectHallucinatedToolCall('', TOOLS)).toBeNull();
    });

    it('returns null for empty tool list', () => {
      expect(_detectHallucinatedToolCall('I called read_file.', [])).toBeNull();
    });

    it('returns null when no narration pattern is present', () => {
      expect(_detectHallucinatedToolCall('Here is a summary of the topic.', TOOLS)).toBeNull();
    });
  });

  describe('multi-tool catalog — picks the named tool, not another', () => {
    it('"I called list_files" only flags list_files, even if read_file is also in the catalog', () => {
      expect(_detectHallucinatedToolCall('I called list_files yesterday.', TOOLS)).toBe('list_files');
    });
  });
});
