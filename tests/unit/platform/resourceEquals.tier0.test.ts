// resourceEquals.tier0.test.ts — Slice A22

import { describe, it, expect } from 'vitest';
import {
  resourceEquals,
  fileResource,
  canvasPageResource,
  chatSessionResource,
  toolArtifactResource,
  externalResource,
} from '../../../src/workbench/resources/resource.js';

describe('resourceEquals (Slice A22)', () => {
  it('same reference is equal', () => {
    const r = fileResource('/a.md');
    expect(resourceEquals(r, r)).toBe(true);
  });

  it('both undefined are equal; one undefined is not', () => {
    expect(resourceEquals(undefined, undefined)).toBe(true);
    expect(resourceEquals(undefined, fileResource('/a.md'))).toBe(false);
    expect(resourceEquals(fileResource('/a.md'), undefined)).toBe(false);
  });

  it('different types are not equal', () => {
    expect(resourceEquals(fileResource('/a.md'), canvasPageResource('p1'))).toBe(false);
  });

  describe('file', () => {
    it('same path + same workspaceId are equal', () => {
      expect(resourceEquals(
        fileResource('/a.md', { workspaceId: 'w1' }),
        fileResource('/a.md', { workspaceId: 'w1' }),
      )).toBe(true);
    });
    it('different path is not equal', () => {
      expect(resourceEquals(fileResource('/a.md'), fileResource('/b.md'))).toBe(false);
    });
    it('different workspaceId is not equal', () => {
      expect(resourceEquals(
        fileResource('/a.md', { workspaceId: 'w1' }),
        fileResource('/a.md', { workspaceId: 'w2' }),
      )).toBe(false);
    });
    it('hash is metadata, NOT identity', () => {
      expect(resourceEquals(
        fileResource('/a.md', { hash: 'h1' }),
        fileResource('/a.md', { hash: 'h2' }),
      )).toBe(true);
    });
  });

  describe('canvas-page', () => {
    it('same pageId + blockId + workspaceId are equal', () => {
      expect(resourceEquals(
        canvasPageResource('p1', { blockId: 'b1', workspaceId: 'w1' }),
        canvasPageResource('p1', { blockId: 'b1', workspaceId: 'w1' }),
      )).toBe(true);
    });
    it('different blockId is not equal', () => {
      expect(resourceEquals(
        canvasPageResource('p1', { blockId: 'b1' }),
        canvasPageResource('p1', { blockId: 'b2' }),
      )).toBe(false);
    });
    it('omitted blockId vs explicit undefined are equal', () => {
      expect(resourceEquals(
        canvasPageResource('p1'),
        canvasPageResource('p1', {}),
      )).toBe(true);
    });
  });

  describe('chat-session', () => {
    it('same sessionId + turnId are equal', () => {
      expect(resourceEquals(
        chatSessionResource('s1', { turnId: 't1' }),
        chatSessionResource('s1', { turnId: 't1' }),
      )).toBe(true);
    });
    it('different turnId is not equal', () => {
      expect(resourceEquals(
        chatSessionResource('s1', { turnId: 't1' }),
        chatSessionResource('s1', { turnId: 't2' }),
      )).toBe(false);
    });
  });

  describe('tool-artifact', () => {
    it('same toolId + artifactId + workspaceId are equal', () => {
      expect(resourceEquals(
        toolArtifactResource('tool', 'a1', { workspaceId: 'w1' }),
        toolArtifactResource('tool', 'a1', { workspaceId: 'w1' }),
      )).toBe(true);
    });
    it('different artifactId is not equal', () => {
      expect(resourceEquals(
        toolArtifactResource('tool', 'a1'),
        toolArtifactResource('tool', 'a2'),
      )).toBe(false);
    });
  });

  describe('external', () => {
    it('same uri is equal regardless of scheme reconstruction', () => {
      expect(resourceEquals(
        externalResource('https://example.com/a'),
        externalResource('https://example.com/a'),
      )).toBe(true);
    });
    it('different uri is not equal', () => {
      expect(resourceEquals(
        externalResource('https://a.com'),
        externalResource('https://b.com'),
      )).toBe(false);
    });
  });
});
