// @vitest-environment jsdom
// Unit tests for chatRequestParser — M9.0

import { describe, it, expect } from 'vitest';
import { parseChatRequest } from '../../src/built-in/chat/chatRequestParser';

describe('parseChatRequest', () => {

  it('parses plain text with no mentions, commands, or variables', () => {
    const result = parseChatRequest('hello world');
    expect(result.participantId).toBeUndefined();
    expect(result.command).toBeUndefined();
    expect(result.variables).toHaveLength(0);
    expect(result.text).toBe('hello world');
  });

  it('extracts @participant from the beginning of input', () => {
    const result = parseChatRequest('@workspace what is this project about?');
    expect(result.participantId).toBe('workspace');
    expect(result.text).toBe('what is this project about?');
  });

  it('extracts /command after @participant', () => {
    const result = parseChatRequest('@workspace /search query text');
    expect(result.participantId).toBe('workspace');
    expect(result.command).toBe('search');
    expect(result.text).toBe('query text');
  });

  it('extracts /command at the beginning (no participant)', () => {
    const result = parseChatRequest('/help something');
    expect(result.participantId).toBeUndefined();
    expect(result.command).toBe('help');
    expect(result.text).toBe('something');
  });

  it('extracts #variables from the message', () => {
    const result = parseChatRequest('#currentPage explain this');
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe('currentPage');
    expect(result.variables[0].original).toBe('#currentPage');
    expect(result.text).toBe('explain this');
  });

  it('extracts multiple #variables', () => {
    const result = parseChatRequest('compare #currentPage with #selection');
    expect(result.variables).toHaveLength(2);
    expect(result.variables[0].name).toBe('currentPage');
    expect(result.variables[1].name).toBe('selection');
    expect(result.text).toBe('compare with');
  });

  it('handles @participant + /command + #variable together', () => {
    const result = parseChatRequest('@workspace /explain #currentPage');
    expect(result.participantId).toBe('workspace');
    expect(result.command).toBe('explain');
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe('currentPage');
  });

  it('does not treat escaped \\@ as a mention', () => {
    const result = parseChatRequest('\\@notAParticipant hello');
    expect(result.participantId).toBeUndefined();
    expect(result.text).toBe('\\@notAParticipant hello');
  });

  it('does not treat escaped \\/ as a command', () => {
    const result = parseChatRequest('\\/notACommand hello');
    expect(result.participantId).toBeUndefined();
    expect(result.command).toBeUndefined();
    expect(result.text).toBe('\\/notACommand hello');
  });

  it('handles empty string', () => {
    const result = parseChatRequest('');
    expect(result.participantId).toBeUndefined();
    expect(result.command).toBeUndefined();
    expect(result.variables).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('handles only whitespace', () => {
    const result = parseChatRequest('   ');
    expect(result.text).toBe('');
  });

  it('handles @mention with no following text', () => {
    const result = parseChatRequest('@workspace');
    expect(result.participantId).toBe('workspace');
    expect(result.text).toBe('');
  });
});
