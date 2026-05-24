// languageDetection.test.ts — pin file extension → language name mapping.
//
// Pins:
//   - common extensions resolve to the documented label
//   - case-insensitive (uppercase, mixed-case)
//   - unknown extension falls back to 'Plain Text'
//   - filename-only (no dot) falls back to 'Plain Text'
//   - exact filename match wins over extension match (Dockerfile, Makefile)
//   - .gitignore by extension still resolves (via .gitignore ext entry)
//   - getAllKnownLanguages returns a fresh Map (mutation isolation)

import { describe, it, expect } from 'vitest';
import { getLanguageForFileName, getAllKnownLanguages } from '../../src/services/languageDetection';

describe('getLanguageForFileName — common extensions', () => {
  const cases: Array<[string, string]> = [
    ['index.ts', 'TypeScript'],
    ['App.tsx', 'TypeScript React'],
    ['main.js', 'JavaScript'],
    ['component.jsx', 'JavaScript React'],
    ['data.json', 'JSON'],
    ['tsconfig.jsonc', 'JSON with Comments'],
    ['README.md', 'Markdown'],
    ['page.html', 'HTML'],
    ['styles.css', 'CSS'],
    ['theme.scss', 'SCSS'],
    ['script.py', 'Python'],
    ['main.rs', 'Rust'],
    ['service.go', 'Go'],
    ['build.sh', 'Shell Script'],
    ['run.ps1', 'PowerShell'],
    ['workflow.yaml', 'YAML'],
    ['workflow.yml', 'YAML'],
    ['Cargo.toml', 'TOML'],
    ['schema.sql', 'SQL'],
    ['readme.txt', 'Plain Text'],
    ['system.log', 'Log'],
  ];
  for (const [name, lang] of cases) {
    it(`${name} → ${lang}`, () => {
      expect(getLanguageForFileName(name)).toBe(lang);
    });
  }
});

describe('getLanguageForFileName — case insensitivity', () => {
  it('uppercase extension resolves the same as lowercase', () => {
    expect(getLanguageForFileName('INDEX.TS')).toBe('TypeScript');
    expect(getLanguageForFileName('Doc.MD')).toBe('Markdown');
    expect(getLanguageForFileName('Style.CSS')).toBe('CSS');
  });
});

describe('getLanguageForFileName — fallbacks', () => {
  it('unknown extension → Plain Text', () => {
    expect(getLanguageForFileName('thing.xyz')).toBe('Plain Text');
    expect(getLanguageForFileName('data.unknown')).toBe('Plain Text');
  });

  it('filename without any dot → Plain Text', () => {
    expect(getLanguageForFileName('LICENSE')).toBe('Plain Text');
    expect(getLanguageForFileName('README')).toBe('Plain Text');
  });
});

describe('getLanguageForFileName — exact filename overrides', () => {
  it('Dockerfile (no extension) → Dockerfile', () => {
    expect(getLanguageForFileName('Dockerfile')).toBe('Dockerfile');
    expect(getLanguageForFileName('dockerfile')).toBe('Dockerfile');
  });

  it('Makefile → Makefile', () => {
    expect(getLanguageForFileName('Makefile')).toBe('Makefile');
    expect(getLanguageForFileName('makefile')).toBe('Makefile');
  });

  it('.gitignore → Ignore', () => {
    expect(getLanguageForFileName('.gitignore')).toBe('Ignore');
  });

  it('.env → Properties', () => {
    expect(getLanguageForFileName('.env')).toBe('Properties');
  });
});

describe('getAllKnownLanguages', () => {
  it('returns a non-empty Map keyed by extension', () => {
    const m = getAllKnownLanguages();
    expect(m.size).toBeGreaterThan(20);
    expect(m.get('.ts')).toBe('TypeScript');
    expect(m.get('.json')).toBe('JSON');
  });

  it('returns a fresh Map per call (mutations do not leak)', () => {
    const m1 = getAllKnownLanguages();
    m1.set('.fake', 'Fake');
    const m2 = getAllKnownLanguages();
    expect(m2.has('.fake')).toBe(false);
  });
});
