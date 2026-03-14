import { describe, expect, it } from 'vitest';

import {
  buildMissingCitationFooter,
  extractToolCallsFromText,
  selectAttributableCitations,
  stripToolNarration,
} from '../../src/built-in/chat/utilities/chatResponseParsingHelpers';

describe('chat response parsing helpers', () => {
  describe('extractToolCallsFromText', () => {
    it('extracts a bare JSON tool call object', () => {
      const text = 'Here is the tool call:\n{"name": "read_file", "parameters": {"path": "file.md"}}';
      const { toolCalls, cleanedText } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('read_file');
      expect(toolCalls[0].function.arguments).toEqual({ path: 'file.md' });
      expect(cleanedText).toBe('Here is the tool call:');
    });

    it('extracts a JSON tool call inside a code block', () => {
      const text = 'I will read the file:\n```json\n{"name": "read_file", "parameters": {"path": "test.md"}}\n```\nDone.';
      const { toolCalls, cleanedText } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('read_file');
      expect(cleanedText).toContain('I will read the file:');
      expect(cleanedText).toContain('Done.');
      expect(cleanedText).not.toContain('read_file');
    });

    it('returns empty array when no tool calls found', () => {
      const text = 'Hello! How can I help you today?';
      const { toolCalls, cleanedText } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(0);
      expect(cleanedText).toBe(text);
    });

    it('handles tool call with nested parameters', () => {
      const text = '{"name": "search_workspace", "parameters": {"query": "hello world", "limit": 5}}';
      const { toolCalls } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('search_workspace');
      expect(toolCalls[0].function.arguments).toEqual({ query: 'hello world', limit: 5 });
    });

    it('does not extract invalid JSON', () => {
      const text = '{"name": "read_file", "parameters": {broken}}';
      const { toolCalls } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(0);
    });

    it('does not extract objects missing name or parameters', () => {
      const text = '{"action": "read_file", "params": {"path": "x"}}';
      const { toolCalls } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(0);
    });

    it('strips the matched JSON from cleaned text', () => {
      const text = '{"name": "list_files", "parameters": {"directory": "."}}';
      const { cleanedText } = extractToolCallsFromText(text);
      expect(cleanedText).toBe('');
    });

    it('preserves surrounding text when stripping tool call', () => {
      const text = 'Let me check.\n{"name": "list_files", "parameters": {"directory": "."}}\nHere are the results:';
      const { toolCalls, cleanedText } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(cleanedText).toContain('Let me check.');
      expect(cleanedText).toContain('Here are the results:');
    });

    it('extracts tool call using arguments key', () => {
      const text = '{"name": "list_files", "arguments": {"path": "."}}';
      const { toolCalls, cleanedText } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('list_files');
      expect(toolCalls[0].function.arguments).toEqual({ path: '.' });
      expect(cleanedText).toBe('');
    });

    it('extracts code-fenced tool call with arguments key', () => {
      const text = 'Action:\n```json\n{"name": "read_file", "arguments": {"path": "docs/README.md"}}\n```';
      const { toolCalls } = extractToolCallsFromText(text);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].function.name).toBe('read_file');
      expect(toolCalls[0].function.arguments).toEqual({ path: 'docs/README.md' });
    });
  });

  describe('stripToolNarration', () => {
    it('strips function call narration', () => {
      const result = stripToolNarration('Here\'s a function call to read_file with its proper arguments:\nSome useful content.');
      expect(result).toContain('Some useful content.');
      expect(result).not.toContain('function call');
    });

    it('strips let me use tool narration', () => {
      const result = stripToolNarration('Let me use the list_files tool to find that.\nThe workspace has 5 files.');
      expect(result).not.toContain('Let me use');
      expect(result).toContain('The workspace has 5 files.');
    });

    it('strips function call will narration', () => {
      const result = stripToolNarration('This function call will read the text content of the specified file.\nHere is the summary.');
      expect(result).not.toContain('function call will');
      expect(result).toContain('Here is the summary.');
    });

    it('strips functions provided narration', () => {
      const text = 'Based on the functions provided and the context:\n\nHere\'s a function call to list_pages with its proper arguments:\n\nSome useful content about the workspace.';
      const result = stripToolNarration(text);
      expect(result).not.toContain('Based on the functions');
      expect(result).not.toContain('proper arguments');
      expect(result).toContain('Some useful content about the workspace.');
    });

    it('strips alternative tool narration', () => {
      const text = 'Alternatively, since there are no pages in the workspace, you could use `read_file` to read the contents:\nHere are the files.';
      const result = stripToolNarration(text);
      expect(result).not.toContain('Alternatively');
      expect(result).not.toContain('read_file');
      expect(result).toContain('Here are the files.');
    });

    it('strips this will narration', () => {
      const result = stripToolNarration('This will list all pages in the workspace with their titles and IDs.\nThe workspace has 5 files.');
      expect(result).not.toContain('This will list');
      expect(result).toContain('The workspace has 5 files.');
    });

    it('strips hallucinated execution results', () => {
      const text = 'It seems that the file "Auto Insurance Policy.md" is not located in the specified path. Let me try again with a different approach.';
      const result = stripToolNarration(text);
      expect(result).not.toContain('not located');
      expect(result).not.toContain('different approach');
    });

    it('preserves useful content among narration', () => {
      const text = 'The workspace contains 7 files.\n\nHere\'s a function call to read_file with proper args:\nThis will read the insurance policy.\n\nPlease let me know if you need more.';
      const result = stripToolNarration(text);
      expect(result).toContain('The workspace contains 7 files.');
      expect(result).toContain('Please let me know if you need more.');
    });

    it('returns text unchanged when no narration is present', () => {
      const text = 'The workspace has 5 pages about insurance. Here is a summary.';
      expect(stripToolNarration(text)).toBe(text);
    });

    it('strips action block with JSON', () => {
      const text = 'The user wants to know the number of files.\n\nAction:\n{"name": "list_files", "arguments": {"path": "."}}\n\nLet\'s execute this action.';
      const result = stripToolNarration(text);
      expect(result).not.toContain('Action:');
      expect(result).not.toContain('list_files');
      expect(result).not.toContain('Let\'s execute');
    });

    it('strips execution block with hallucinated results', () => {
      const text = 'Execution:\n{"result": [{"name": "Activism", "type": "directory"}]}\n\nThere are 5 folders.';
      const result = stripToolNarration(text);
      expect(result).not.toContain('Execution:');
      expect(result).not.toContain('Activism');
      expect(result).toContain('There are 5 folders.');
    });

    it('preserves generic explanatory prefacing when no tool syntax is present', () => {
      const text = 'The user wants to know the number of files in the workspace.\n\nThere are 42 files.';
      const result = stripToolNarration(text);
      expect(result).toContain('The user wants to know');
      expect(result).toContain('There are 42 files.');
    });

    it('preserves ordinary explanation', () => {
      const text = 'To determine the number of files in the workspace, I will review the indexed file list.\n\nThere are 42 files.';
      const result = stripToolNarration(text);
      expect(result).toContain('To determine the number of files');
      expect(result).toContain('There are 42 files.');
    });
  });

  describe('buildMissingCitationFooter', () => {
    it('adds a visible citation footer when markdown has no markers', () => {
      const footer = buildMissingCitationFooter(
        'Recommended shops are AutoCraft Collision Center and Precision Auto Body.',
        [
          { index: 4, label: 'Agent Contacts.md' },
          { index: 7, label: 'Claims Guide.md' },
        ],
      );

      expect(footer).toBe('\n\nSources: [4] Agent Contacts.md; [7] Claims Guide.md');
    });

    it('still adds the fallback when markdown names the source document but lacks bracket markers', () => {
      const footer = buildMissingCitationFooter(
        'Recommended shops are listed in Agent Contacts.md.',
        [{ index: 4, label: 'Agent Contacts.md' }],
      );

      expect(footer).toBe('\n\nSources: [4] Agent Contacts.md');
    });

    it('skips the fallback when markdown already has structured citation markers', () => {
      const footer = buildMissingCitationFooter(
        'Recommended shops are listed in Agent Contacts.md [4].',
        [{ index: 4, label: 'Agent Contacts.md' }],
      );

      expect(footer).toBe('');
    });

    it('adds the fallback when markdown only has bare numeric citation text', () => {
      const footer = buildMissingCitationFooter(
        'Recommended shops are AutoCraft Collision Center 4 and Precision Auto Body 4.',
        [{ index: 4, label: 'Agent Contacts.md' }],
      );

      expect(footer).toBe('\n\nSources: [4] Agent Contacts.md');
    });

    it('adds the fallback when markdown only uses a generic source column header', () => {
      const footer = buildMissingCitationFooter(
        [
          '| Step | Source |',
          '|------|--------|',
          '| Call your agent | 1 |',
        ].join('\n'),
        [{ index: 1, label: 'Accident Quick Reference.md' }],
      );

      expect(footer).toBe('\n\nSources: [1] Accident Quick Reference.md');
    });

    it('adds the fallback when markdown references only the source stem without the file name', () => {
      const footer = buildMissingCitationFooter(
        'These details come from the Claims Workflow Architecture document. 1',
        [{ index: 1, label: 'Claims Workflow Architecture.md' }],
      );

      expect(footer).toBe('\n\nSources: [1] Claims Workflow Architecture.md');
    });
  });

  describe('selectAttributableCitations', () => {
    it('returns only explicitly cited sources in first-appearance order', () => {
      const result = selectAttributableCitations(
        'Use [7] for the overview and [4] for the claim details. [7]',
        [
          { index: 4, label: 'Claims Guide.md' },
          { index: 7, label: 'Agent Contacts.md' },
          { index: 9, label: 'Vehicle Info.md' },
        ],
      );

      expect(result).toEqual([
        { index: 7, label: 'Agent Contacts.md' },
        { index: 4, label: 'Claims Guide.md' },
      ]);
    });

    it('matches explicit source-name mentions when numeric markers are absent', () => {
      const result = selectAttributableCitations(
        'Recommended shops are listed in Agent Contacts.md and the workflow comes from Claims Workflow Architecture document.',
        [
          { index: 1, label: 'Claims Workflow Architecture.md' },
          { index: 4, label: 'Agent Contacts.md' },
          { index: 7, label: 'Vehicle Info.md' },
        ],
      );

      expect(result).toEqual([
        { index: 4, label: 'Agent Contacts.md' },
        { index: 1, label: 'Claims Workflow Architecture.md' },
      ]);
    });

    it('falls back to a single source candidate when only one source exists', () => {
      const result = selectAttributableCitations(
        'The answer is supported by the available material.',
        [{ index: 3, label: 'Policy.md' }],
      );

      expect(result).toEqual([{ index: 3, label: 'Policy.md' }]);
    });

    it('returns no sources when multiple candidates exist without attributable references', () => {
      const result = selectAttributableCitations(
        'The answer is supported by the available material.',
        [
          { index: 3, label: 'Policy.md' },
          { index: 5, label: 'Claims.md' },
        ],
      );

      expect(result).toEqual([]);
    });
  });
});