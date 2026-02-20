import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputFile = path.join(repoRoot, 'docs', 'file-map-data.js');

const ROOT_FILES = [
  'ARCHITECTURE.md',
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'Parallx.bat',
  'Parallx.vbs',
];

const INCLUDE_DIRS = [
  'src',
  'electron',
  'tests',
  'docs',
  'scripts',
  'tools/samples',
  '.github',
];

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'out',
  'coverage',
  'build',
]);

const DOMAIN_INFO = {
  'workbench-shell': {
    label: 'Workbench Shell',
    color: '#ff7a59',
    description: 'Composition root and shell orchestration for the app UI.',
  },
  'workbench-ui': {
    label: 'Workbench UI',
    color: '#f8c65c',
    description: 'Layout, parts, views, editors, drag-and-drop, theme, and shared UI.',
  },
  'core-platform': {
    label: 'Core Platform',
    color: '#73d2de',
    description: 'Foundational platform primitives and shared utilities.',
  },
  'service-layer': {
    label: 'Service Layer',
    color: '#7fc97f',
    description: 'Service interfaces and implementations behind dependency injection.',
  },
  'interaction-model': {
    label: 'Interaction Model',
    color: '#9d8df1',
    description: 'Commands and context evaluation used across the workbench.',
  },
  'workspace-state': {
    label: 'Workspace State',
    color: '#59c3c3',
    description: 'Workspace identity, manifest, persistence, and boundaries.',
  },
  'tool-platform': {
    label: 'Tool Platform',
    color: '#f2994a',
    description: 'Tool API, activation, contributions, and configuration system.',
  },
  'built-in-tools': {
    label: 'Built-in Tools',
    color: '#ec6f66',
    description: 'First-party tools shipped in the workbench.',
  },
  'electron-host': {
    label: 'Electron Host',
    color: '#4f9da6',
    description: 'Main process and preload bridge for desktop runtime.',
  },
  'quality-assurance': {
    label: 'Quality Assurance',
    color: '#c77dff',
    description: 'Unit and end-to-end tests plus test configuration.',
  },
  documentation: {
    label: 'Documentation',
    color: '#66c2ff',
    description: 'Architecture, schema, research notes, and milestone history.',
  },
  'build-tooling': {
    label: 'Build and Tooling',
    color: '#a7a9be',
    description: 'Build scripts, launch helpers, and repository tooling files.',
  },
};

const DOMAIN_DEPENDENCIES = [
  ['workbench-shell', 'workbench-ui'],
  ['workbench-shell', 'service-layer'],
  ['workbench-shell', 'workspace-state'],
  ['workbench-shell', 'tool-platform'],
  ['workbench-shell', 'electron-host'],
  ['workbench-ui', 'core-platform'],
  ['workbench-ui', 'service-layer'],
  ['service-layer', 'core-platform'],
  ['interaction-model', 'core-platform'],
  ['interaction-model', 'service-layer'],
  ['workspace-state', 'core-platform'],
  ['workspace-state', 'service-layer'],
  ['tool-platform', 'core-platform'],
  ['tool-platform', 'service-layer'],
  ['tool-platform', 'workbench-ui'],
  ['built-in-tools', 'tool-platform'],
  ['built-in-tools', 'service-layer'],
  ['built-in-tools', 'workbench-ui'],
  ['electron-host', 'workbench-shell'],
];

const IMPORTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.sql', '.md'];

const IMPORT_PATTERNS = [
  /\bimport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const ROOT_ID = 'root:workbench';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizeRelPath(filePath) {
  return toPosix(path.normalize(filePath));
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function walkFiles(relativeDir, collector) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return;
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }

    const rel = normalizeRelPath(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      walkFiles(rel, collector);
      continue;
    }

    collector.add(rel);
  }
}

function toTitleCase(value) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');
}

function moduleLabel(moduleKey) {
  if (moduleKey.startsWith('built-in/')) {
    const feature = moduleKey.split('/')[1] ?? 'misc';
    return `Built-in / ${toTitleCase(feature)}`;
  }

  return moduleKey
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment === '.github') {
        return '.github';
      }
      if (segment === 'e2e') {
        return 'E2E';
      }
      if (segment === 'src') {
        return 'src';
      }
      return toTitleCase(segment);
    })
    .join(' / ');
}

function classifyFile(filePath) {
  if (filePath === 'ARCHITECTURE.md') {
    return { domain: 'documentation', module: 'docs' };
  }
  if (filePath === 'index.html') {
    return { domain: 'workbench-shell', module: 'workbench' };
  }
  if (filePath === 'Parallx.bat' || filePath === 'Parallx.vbs') {
    return { domain: 'build-tooling', module: 'launchers' };
  }
  if (filePath === 'playwright.config.ts' || filePath === 'vitest.config.ts') {
    return { domain: 'quality-assurance', module: 'test-config' };
  }
  if (
    filePath === 'package.json' ||
    filePath === 'package-lock.json' ||
    filePath === 'tsconfig.json'
  ) {
    return { domain: 'build-tooling', module: 'root-config' };
  }

  if (filePath.startsWith('src/built-in/')) {
    const feature = filePath.split('/')[2] ?? 'misc';
    return { domain: 'built-in-tools', module: `built-in/${feature}` };
  }
  if (filePath.startsWith('src/workbench/') || filePath === 'src/main.ts' || filePath === 'src/workbench.css') {
    return { domain: 'workbench-shell', module: 'workbench' };
  }
  if (filePath.startsWith('src/platform/')) {
    return { domain: 'core-platform', module: 'platform' };
  }
  if (filePath.startsWith('src/services/')) {
    return { domain: 'service-layer', module: 'services' };
  }
  if (filePath.startsWith('src/layout/')) {
    return { domain: 'workbench-ui', module: 'layout' };
  }
  if (filePath.startsWith('src/parts/')) {
    return { domain: 'workbench-ui', module: 'parts' };
  }
  if (filePath.startsWith('src/views/')) {
    return { domain: 'workbench-ui', module: 'views' };
  }
  if (filePath.startsWith('src/editor/')) {
    return { domain: 'workbench-ui', module: 'editor' };
  }
  if (filePath.startsWith('src/dnd/')) {
    return { domain: 'workbench-ui', module: 'dnd' };
  }
  if (filePath.startsWith('src/ui/')) {
    return { domain: 'workbench-ui', module: 'ui' };
  }
  if (filePath.startsWith('src/theme/')) {
    return { domain: 'workbench-ui', module: 'theme' };
  }
  if (filePath.startsWith('src/context/')) {
    return { domain: 'interaction-model', module: 'context' };
  }
  if (filePath.startsWith('src/commands/')) {
    return { domain: 'interaction-model', module: 'commands' };
  }
  if (filePath.startsWith('src/workspace/')) {
    return { domain: 'workspace-state', module: 'workspace' };
  }
  if (filePath.startsWith('src/configuration/')) {
    return { domain: 'tool-platform', module: 'configuration' };
  }
  if (filePath.startsWith('src/contributions/')) {
    return { domain: 'tool-platform', module: 'contributions' };
  }
  if (filePath.startsWith('src/tools/')) {
    return { domain: 'tool-platform', module: 'tools' };
  }
  if (filePath.startsWith('src/api/')) {
    return { domain: 'tool-platform', module: 'api' };
  }
  if (filePath.startsWith('src/assets/')) {
    return { domain: 'workbench-ui', module: 'assets' };
  }

  if (filePath.startsWith('electron/')) {
    return { domain: 'electron-host', module: 'electron' };
  }

  if (filePath.startsWith('tests/e2e/')) {
    return { domain: 'quality-assurance', module: 'tests/e2e' };
  }
  if (filePath.startsWith('tests/unit/')) {
    return { domain: 'quality-assurance', module: 'tests/unit' };
  }

  if (filePath.startsWith('docs/research/')) {
    return { domain: 'documentation', module: 'docs/research' };
  }
  if (filePath.startsWith('docs/archive/')) {
    return { domain: 'documentation', module: 'docs/archive' };
  }
  if (filePath.startsWith('docs/')) {
    return { domain: 'documentation', module: 'docs' };
  }

  if (filePath.startsWith('scripts/')) {
    return { domain: 'build-tooling', module: 'scripts' };
  }
  if (filePath.startsWith('tools/samples/')) {
    return { domain: 'build-tooling', module: 'tools/samples' };
  }
  if (filePath.startsWith('.github/instructions/')) {
    return { domain: 'build-tooling', module: '.github/instructions' };
  }
  if (filePath.startsWith('.github/prompts/')) {
    return { domain: 'build-tooling', module: '.github/prompts' };
  }
  if (filePath.startsWith('.github/')) {
    return { domain: 'build-tooling', module: '.github' };
  }

  return { domain: 'build-tooling', module: 'misc' };
}

function fileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (filePath.endsWith('.spec.ts')) {
    return 'test-spec';
  }
  if (ext === '.ts' || ext === '.tsx') {
    return 'typescript';
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return 'javascript';
  }
  if (ext === '.json') {
    return 'json';
  }
  if (ext === '.css') {
    return 'style';
  }
  if (ext === '.md') {
    return 'doc';
  }
  if (ext === '.sql') {
    return 'sql';
  }
  if (ext === '.html') {
    return 'html';
  }
  if (ext === '.svg' || ext === '.ico') {
    return 'asset';
  }
  return 'file';
}

function extractImportSpecifiers(sourceText) {
  const specifiers = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(sourceText);
    while (match) {
      specifiers.push(match[1]);
      match = pattern.exec(sourceText);
    }
  }
  return specifiers;
}

function addResolutionVariants(candidate, outputList) {
  outputList.push(candidate);

  if (candidate.endsWith('.js')) {
    outputList.push(candidate.slice(0, -3) + '.ts');
    outputList.push(candidate.slice(0, -3) + '.tsx');
    outputList.push(candidate.slice(0, -3) + '.mjs');
    outputList.push(candidate.slice(0, -3) + '.cjs');
  }
  if (candidate.endsWith('.ts')) {
    outputList.push(candidate.slice(0, -3) + '.js');
    outputList.push(candidate.slice(0, -3) + '.mjs');
  }
  if (candidate.endsWith('.mjs')) {
    outputList.push(candidate.slice(0, -4) + '.js');
    outputList.push(candidate.slice(0, -4) + '.ts');
  }
  if (candidate.endsWith('.cjs')) {
    outputList.push(candidate.slice(0, -4) + '.js');
  }
}

function resolveRelativeImport(sourcePath, specifier, knownFiles) {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) {
    return null;
  }

  const sourceDir = path.posix.dirname(sourcePath);
  const joined = path.posix.normalize(path.posix.join(sourceDir, specifier));
  const candidates = [];
  const extension = path.posix.extname(joined);

  if (extension) {
    addResolutionVariants(joined, candidates);
  } else {
    for (const ext of RESOLVE_EXTENSIONS) {
      addResolutionVariants(`${joined}${ext}`, candidates);
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      addResolutionVariants(`${joined}/index${ext}`, candidates);
    }
  }

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function makeModuleId(domainId, moduleKey) {
  return `module:${domainId}:${moduleKey}`;
}

function makeFileId(filePath) {
  return `file:${filePath}`;
}

function collectRepositoryFiles() {
  const collector = new Set();
  for (const filePath of ROOT_FILES) {
    const absPath = path.join(repoRoot, filePath);
    if (fs.existsSync(absPath)) {
      collector.add(normalizeRelPath(filePath));
    }
  }
  for (const directory of INCLUDE_DIRS) {
    walkFiles(directory, collector);
  }
  return [...collector].sort((a, b) => a.localeCompare(b));
}

function buildGraphData() {
  const files = collectRepositoryFiles();
  const fileSet = new Set(files);
  const classificationByFile = new Map();

  for (const filePath of files) {
    classificationByFile.set(filePath, classifyFile(filePath));
  }

  const usedDomains = new Set();
  const moduleMap = new Map();

  for (const filePath of files) {
    const classification = classificationByFile.get(filePath);
    if (!classification) {
      continue;
    }

    const { domain, module } = classification;
    usedDomains.add(domain);
    const moduleId = makeModuleId(domain, module);
    let moduleEntry = moduleMap.get(moduleId);
    if (!moduleEntry) {
      moduleEntry = {
        id: moduleId,
        domain,
        module,
        label: moduleLabel(module),
        files: [],
      };
      moduleMap.set(moduleId, moduleEntry);
    }
    moduleEntry.files.push(filePath);
  }

  const importEdgeSet = new Set();
  const importEdges = [];
  const moduleDependencyCount = new Map();

  for (const sourceFile of files) {
    const ext = path.extname(sourceFile).toLowerCase();
    if (!IMPORTABLE_EXTENSIONS.has(ext)) {
      continue;
    }

    const sourceText = safeReadFile(path.join(repoRoot, sourceFile));
    if (!sourceText) {
      continue;
    }

    const specifiers = extractImportSpecifiers(sourceText);
    for (const specifier of specifiers) {
      const targetFile = resolveRelativeImport(sourceFile, specifier, fileSet);
      if (!targetFile) {
        continue;
      }

      const edgeKey = `${sourceFile}=>${targetFile}`;
      if (importEdgeSet.has(edgeKey)) {
        continue;
      }
      importEdgeSet.add(edgeKey);
      importEdges.push({
        id: `imports:${sourceFile}->${targetFile}`,
        source: makeFileId(sourceFile),
        target: makeFileId(targetFile),
        type: 'imports',
      });

      const sourceClass = classificationByFile.get(sourceFile);
      const targetClass = classificationByFile.get(targetFile);
      if (!sourceClass || !targetClass) {
        continue;
      }

      const sourceModuleId = makeModuleId(sourceClass.domain, sourceClass.module);
      const targetModuleId = makeModuleId(targetClass.domain, targetClass.module);
      if (sourceModuleId === targetModuleId) {
        continue;
      }

      const moduleDependencyKey = `${sourceModuleId}->${targetModuleId}`;
      moduleDependencyCount.set(
        moduleDependencyKey,
        (moduleDependencyCount.get(moduleDependencyKey) ?? 0) + 1,
      );
    }
  }

  const nodes = [];
  const edges = [];

  nodes.push({
    id: ROOT_ID,
    kind: 'root',
    label: 'Parallx Workbench',
    description: 'Big-picture anchor for how modules and files connect.',
  });

  const domainIds = [...usedDomains].sort((a, b) => a.localeCompare(b));
  for (const domainId of domainIds) {
    const info = DOMAIN_INFO[domainId] ?? {
      label: domainId,
      color: '#9fa6b2',
      description: 'Domain',
    };
    nodes.push({
      id: `domain:${domainId}`,
      kind: 'domain',
      domain: domainId,
      label: info.label,
      color: info.color,
      description: info.description,
    });
    edges.push({
      id: `structure:${ROOT_ID}->domain:${domainId}`,
      source: ROOT_ID,
      target: `domain:${domainId}`,
      type: 'structure',
      subtype: 'root-domain',
    });
  }

  for (const [sourceDomain, targetDomain] of DOMAIN_DEPENDENCIES) {
    if (!usedDomains.has(sourceDomain) || !usedDomains.has(targetDomain)) {
      continue;
    }
    edges.push({
      id: `domainDepends:${sourceDomain}->${targetDomain}`,
      source: `domain:${sourceDomain}`,
      target: `domain:${targetDomain}`,
      type: 'domainDepends',
    });
  }

  const moduleEntries = [...moduleMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const moduleEntry of moduleEntries) {
    nodes.push({
      id: moduleEntry.id,
      kind: 'module',
      domain: moduleEntry.domain,
      module: moduleEntry.module,
      label: moduleEntry.label,
      fileCount: moduleEntry.files.length,
    });
    edges.push({
      id: `structure:domain:${moduleEntry.domain}->${moduleEntry.id}`,
      source: `domain:${moduleEntry.domain}`,
      target: moduleEntry.id,
      type: 'structure',
      subtype: 'domain-module',
    });
  }

  for (const filePath of files) {
    const classification = classificationByFile.get(filePath);
    if (!classification) {
      continue;
    }
    const fileId = makeFileId(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const moduleId = makeModuleId(classification.domain, classification.module);
    nodes.push({
      id: fileId,
      kind: 'file',
      domain: classification.domain,
      module: classification.module,
      label: path.posix.basename(filePath),
      path: filePath,
      ext,
      fileKind: fileKind(filePath),
    });
    edges.push({
      id: `structure:${moduleId}->${fileId}`,
      source: moduleId,
      target: fileId,
      type: 'structure',
      subtype: 'module-file',
    });
  }

  for (const [key, weight] of moduleDependencyCount.entries()) {
    const [sourceModuleId, targetModuleId] = key.split('->');
    edges.push({
      id: `moduleDepends:${sourceModuleId}->${targetModuleId}`,
      source: sourceModuleId,
      target: targetModuleId,
      type: 'moduleDepends',
      weight,
    });
  }

  edges.push(...importEdges);
  edges.sort((a, b) => a.id.localeCompare(b.id));

  const stats = {
    domains: domainIds.length,
    modules: moduleEntries.length,
    files: files.length,
    structureEdges: edges.filter((edge) => edge.type === 'structure').length,
    domainDependencyEdges: edges.filter((edge) => edge.type === 'domainDepends').length,
    moduleDependencyEdges: edges.filter((edge) => edge.type === 'moduleDepends').length,
    importEdges: edges.filter((edge) => edge.type === 'imports').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    rootId: ROOT_ID,
    domainInfo: DOMAIN_INFO,
    stats,
    nodes,
    edges,
  };
}

function writeOutputFile(graphData) {
  const header = [
    '// Generated by scripts/generate-file-map-data.mjs',
    '// Run: node scripts/generate-file-map-data.mjs',
  ].join('\n');
  const content = `${header}\nwindow.PARALLX_MAP_DATA = ${JSON.stringify(graphData, null, 2)};\n`;
  fs.writeFileSync(outputFile, content, 'utf8');
}

const graphData = buildGraphData();
writeOutputFile(graphData);
console.log(
  [
    `Generated ${toPosix(path.relative(repoRoot, outputFile))}`,
    `domains=${graphData.stats.domains}`,
    `modules=${graphData.stats.modules}`,
    `files=${graphData.stats.files}`,
    `imports=${graphData.stats.importEdges}`,
  ].join(' | '),
);
