// @vitest-environment jsdom
// The build-mini-app and build-extension skills, and the style checks they
// teach to: the examples a model builds from must pass every check themselves.

import { describe, expect, it } from 'vitest';
import MINI_APP_SKILL from '../../src/built-in/chat/skills/build-mini-app.md?raw';
import EXTENSION_SKILL from '../../src/built-in/chat/skills/build-extension.md?raw';
import { parseSkillFrontmatter } from '../../src/services/skillLoaderService';
import { isTitleCase, lintActionLabels, lintMiniApp, lintStyleSource } from '../../src/ui/styleLint';
import { EXTENSION_ONLY_API, readExtensionDraft, draftFailures } from '../../src/tools/extensionDraft';
import { buildSandboxDocument } from '../../src/ui/sandboxedHtml';
import { renderContentPart } from '../../src/built-in/chat/rendering/chatContentParts';
import { ChatContentPartKind } from '../../src/services/chatTypes';

const block = (md: string, lang: string): string => {
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```').exec(md);
  if (!m) throw new Error(`no ${lang} block`);
  return m[1];
};

describe('the skills', () => {
  it('parse as skills under their own names', () => {
    expect(parseSkillFrontmatter(MINI_APP_SKILL)?.frontmatter?.name).toBe('build-mini-app');
    expect(parseSkillFrontmatter(EXTENSION_SKILL)?.frontmatter?.name).toBe('build-extension');
  });

  it('the mini-app starter draws, and has no style problems', () => {
    const src = block(MINI_APP_SKILL, 'app');
    expect(lintMiniApp(src)).toEqual([]);
    const el = renderContentPart({ kind: ChatContentPartKind.Markdown, content: '```app\n' + src + '\n```' } as never);
    expect(el.querySelector('.px-af-app__title')?.textContent).toBe('Savings Goal');
    expect(el.querySelector('iframe')).not.toBeNull();
  });

  it('the example extension passes every check against the API an extension gets', () => {
    const surface = {
      commands: ['registerCommand', 'executeCommand'], editors: ['registerEditorProvider', 'openEditor'],
      chat: ['registerTool'], canvas: ['registerBlock'], window: ['showConfirmModal'],
      ui: ['createPageHeader', 'createButton', 'createIconButton', 'createInput', 'createEmptyState', 'createSectionLabel'],
      ...EXTENSION_ONLY_API,
    };
    const reading = readExtensionDraft({ manifest: JSON.parse(block(EXTENSION_SKILL, 'json')), files: { 'main.js': block(EXTENSION_SKILL, 'js') } }, surface);
    expect(draftFailures(reading)).toBe('');
    expect(reading.adds.map((a) => a.kind)).toEqual(['Editor tab', 'Command', 'Saved data']);
  });
});

describe('the style checks', () => {
  it('Title Case: small joining words may stay lowercase', () => {
    expect(isTitleCase('Add to List')).toBe(true);
    expect(isTitleCase('Import from CSV')).toBe(true);
    expect(isTitleCase('add')).toBe(false);
    expect(isTitleCase('Add exam')).toBe(false);
    expect(lintActionLabels(['Add exam', 'Open…', 'Save...', 'Next — Step']).map((i) => i.rule)).toEqual([
      'Actions are in Title Case', 'No em dashes in labels', 'An action that opens a dialog ends with the … character',
    ]);
  });

  it('colour literals, pixel type, set fonts and uppercase are found; id selectors and tokens are not', () => {
    const issues = lintStyleSource('#add { color: #fff; font-size: 14px; font-family: Arial; text-transform: uppercase; } .x { color: var(--px-text, #ccc); font-family: inherit; }');
    expect(issues.map((i) => i.rule)).toEqual([
      'Colours come from --px tokens', 'Type sizes come from --px-text tokens', 'The app font is inherited, never set', 'No uppercase or letter-spaced labels',
    ]);
    expect(issues[0].detail).toBe('1×, e.g. "#fff"');
  });

  it('a mini-app frame draws plain controls in the app look', () => {
    const doc = buildSandboxDocument('<button>Go</button>', '', { appStyle: true });
    expect(doc).toMatch(/button \{ font: inherit;/);
    expect(doc).toContain('button.primary');
    expect(buildSandboxDocument('<p>x</p>', '')).not.toContain('button.primary');
  });
});
