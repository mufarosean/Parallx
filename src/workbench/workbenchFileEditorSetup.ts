// workbenchFileEditorSetup.ts — File editor resolver + Quick Access file picker
//
// Extracted from workbench.ts (D.3) to reduce the god-object.
// VS Code parity: `EditorResolverService` registration lives in the workbench
// startup sequence; this module encapsulates that wiring.
//
// Responsibilities:
//   - Register built-in format readers (Markdown, Image, PDF, Text)
//   - Register the pane factory (input → pane routing)
//   - Wire the URI resolver so EditorsBridge.openFileEditor() works
//   - Wire the Quick Access file picker delegate

import { DisposableStore } from '../platform/lifecycle.js';
import { URI } from '../platform/uri.js';
import { ServiceCollection } from '../services/serviceCollection.js';
import {
  IWorkspaceService,
  IFileService,
  IEditorService,
  ITextFileModelManager,
  IKeybindingService,
  ICommandService,
} from '../services/serviceTypes.js';
import type { EditorPart } from '../parts/editorPart.js';
import type { QuickAccessWidget } from '../commands/quickAccess.js';
import type { CommandService } from '../commands/commandRegistry.js';
import type { IEditorInput } from '../editor/editorInput.js';
import { GroupDirection } from '../editor/editorTypes.js';

// Editor inputs
import { FileEditorInput } from '../built-in/editor/fileEditorInput.js';
import { UntitledEditorInput } from '../built-in/editor/untitledEditorInput.js';
import { MarkdownPreviewInput } from '../built-in/editor/markdownPreviewInput.js';
import { ImageEditorInput } from '../built-in/editor/imageEditorInput.js';
import { PdfEditorInput } from '../built-in/editor/pdfEditorInput.js';
import { KeybindingsEditorInput } from '../built-in/editor/keybindingsEditorInput.js';
import { SettingsEditorInput } from '../built-in/editor/settingsEditorInput.js';

// Editor panes
import { TextEditorPane } from '../built-in/editor/textEditorPane.js';
import { MarkdownEditorPane } from '../built-in/editor/markdownEditorPane.js';
import { ImageEditorPane } from '../built-in/editor/imageEditorPane.js';
import { PdfEditorPane } from '../built-in/editor/pdfEditorPane.js';
import { KeybindingsEditorPane } from '../built-in/editor/keybindingsEditorPane.js';
import { SettingsEditorPane } from '../built-in/editor/settingsEditorPane.js';

// Editor resolver + pane factory
import { EditorResolverService, EditorResolverPriority } from '../services/editorResolverService.js';
import { registerEditorPaneFactory } from '../editor/editorPane.js';
import { setFileEditorResolver } from '../api/bridges/editorsBridge.js';

import type { KeybindingService } from '../services/keybindingService.js';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface FileEditorSetupDeps {
  readonly services: ServiceCollection;
  readonly editorPart: EditorPart;
  readonly commandPalette?: QuickAccessWidget;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wire the file editor resolver and Quick Access file picker.
 *
 * Returns a `DisposableStore` that the caller should `_register()`.
 * All resolver registrations, pane factory, and URI resolver are tracked.
 */
export function initFileEditorSetup(deps: FileEditorSetupDeps): DisposableStore {
  const disposables = new DisposableStore();
  _initFileEditorResolver(deps, disposables);
  _initQuickAccessFilePicker(deps, disposables);
  return disposables;
}

// ─── File Editor Resolver ────────────────────────────────────────────────────

function _initFileEditorResolver(
  { services, editorPart }: FileEditorSetupDeps,
  disposables: DisposableStore,
): void {
  // 1. EditorResolverService
  const resolver = new EditorResolverService();
  disposables.add(resolver);

  const textFileModelManager = services.get(ITextFileModelManager);
  const fileService = services.get(IFileService);

  // Helper: compute workspace-relative path for tab description
  const getRelativePath = (uri: URI): string | undefined => {
    const workspaceService = services.has(IWorkspaceService)
      ? services.get(IWorkspaceService)
      : undefined;
    if (workspaceService?.folders) {
      for (const folder of workspaceService.folders) {
        const folderUri = typeof folder.uri === 'string' ? URI.parse(folder.uri) : folder.uri;
        const folderPath = folderUri.fsPath;
        if (uri.fsPath.startsWith(folderPath)) {
          return uri.fsPath.substring(folderPath.length + 1).replace(/\\/g, '/');
        }
      }
    }
    return undefined;
  };

  // ── Register built-in format readers (priority-sorted) ──

  // Image viewer
  disposables.add(resolver.registerEditor({
    id: ImageEditorInput.TYPE_ID,
    name: 'Image Viewer',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif'],
    priority: EditorResolverPriority.Default,
    createInput: (uri) => ImageEditorInput.create(uri),
    createPane: () => new ImageEditorPane(),
  }));

  // PDF viewer
  disposables.add(resolver.registerEditor({
    id: PdfEditorInput.TYPE_ID,
    name: 'PDF Viewer',
    extensions: ['.pdf'],
    priority: EditorResolverPriority.Default,
    createInput: (uri) => PdfEditorInput.create(uri),
    createPane: () => new PdfEditorPane(),
  }));

  // Text editor (fallback — matches everything)
  disposables.add(resolver.registerEditor({
    id: FileEditorInput.TYPE_ID,
    name: 'Text Editor',
    extensions: ['.*'],
    priority: EditorResolverPriority.Builtin,
    createInput: (uri) => FileEditorInput.create(uri, textFileModelManager, fileService, getRelativePath(uri)),
    createPane: () => new TextEditorPane(),
  }));

  // 2. Pane factory (routes input → pane)
  disposables.add(registerEditorPaneFactory((input) => {
    if (input instanceof MarkdownPreviewInput) return new MarkdownEditorPane();
    if (input instanceof ImageEditorInput) return new ImageEditorPane();
    if (input instanceof PdfEditorInput) return new PdfEditorPane();

    if (input instanceof KeybindingsEditorInput) {
      const kbService = services.has(IKeybindingService)
        ? (services.get(IKeybindingService) as unknown as KeybindingService)
        : undefined;
      return new KeybindingsEditorPane(() => kbService?.getAllKeybindings() ?? []);
    }

    if (input instanceof SettingsEditorInput) {
      return new SettingsEditorPane(services);
    }

    if (input instanceof FileEditorInput) return new TextEditorPane();
    if (input instanceof UntitledEditorInput) return new TextEditorPane();

    return null;
  }));

  // 3. URI resolver function
  setFileEditorResolver(async (uriString: string) => {
    if (uriString.startsWith('untitled://') || uriString.startsWith('untitled:')) {
      return UntitledEditorInput.create();
    }

    let uri: URI;
    if (uriString.startsWith('file://') || uriString.startsWith('file:///')) {
      uri = URI.parse(uriString);
    } else {
      uri = URI.file(uriString);
    }

    const existingInput = findOpenEditorInput(editorPart, uri);
    if (existingInput) return existingInput;

    const resolution = resolver.resolve(uri);
    if (resolution) return resolution.input;

    return FileEditorInput.create(uri, textFileModelManager, fileService, getRelativePath(uri));
  });

  console.log('[Workbench] File editor resolver wired with format readers');

  // 4. Markdown preview toolbar button handler
  disposables.add(editorPart.onDidRequestMarkdownPreview((sourceGroup) => {
    const activeEditor = sourceGroup.model.activeEditor;
    if (!(activeEditor instanceof FileEditorInput)) return;

    const newGroup = editorPart.splitGroup(sourceGroup.id, GroupDirection.Right);
    if (!newGroup) return;

    if (newGroup.model.count > 0) {
      newGroup.model.closeEditor(0, true);
    }

    const previewInput = MarkdownPreviewInput.create(activeEditor);
    newGroup.openEditor(previewInput, { pinned: true });
  }));

  // 5. Tab context menu: Reveal in Explorer
  disposables.add(editorPart.onDidRequestRevealInExplorer((uri) => {
    const cmdService = services.get(ICommandService) as CommandService;
    cmdService?.executeCommand('explorer.revealInExplorer', uri.toString());
  }));
}

// ─── Find Open Editor ────────────────────────────────────────────────────────

/**
 * Find an already-open editor by URI across all editor groups.
 * Exported for reuse by the Quick Access file picker.
 */
export function findOpenEditorInput(editorPart: EditorPart, uri: URI): IEditorInput | undefined {
  for (const group of editorPart.groups) {
    for (const editor of group.model.editors) {
      if (editor instanceof FileEditorInput && editor.uri.equals(uri)) return editor;
      if (editor instanceof ImageEditorInput && editor.uri.equals(uri)) return editor;
      if (editor instanceof PdfEditorInput && editor.uri.equals(uri)) return editor;
    }
  }
  return undefined;
}

// ─── Quick Access File Picker ────────────────────────────────────────────────

function _initQuickAccessFilePicker(
  { services, editorPart, commandPalette }: FileEditorSetupDeps,
  _disposables: DisposableStore,
): void {
  if (!commandPalette) return;

  const fileService = services.has(IFileService) ? services.get(IFileService) : undefined;
  const workspaceService = services.has(IWorkspaceService) ? services.get(IWorkspaceService) : undefined;
  const editorService = services.has(IEditorService) ? services.get(IEditorService) : undefined;

  if (!fileService || !workspaceService) {
    console.warn('[Workbench] File picker not wired — missing fileService or workspaceService');
    return;
  }

  const textFileModelManager = services.get(ITextFileModelManager);

  commandPalette.setFilePickerDelegate(
    {
      getWorkspaceFolders: () => {
        return (workspaceService.folders ?? []).map((f: any) => ({
          uri: f.uri.toString(),
          name: f.name,
        }));
      },
      readDirectory: async (dirUri: string) => {
        const uri = URI.parse(dirUri);
        const entries: any[] = await fileService.readdir(uri);
        return entries.map((e: any) => ({
          name: e.name,
          uri: e.uri.toString(),
          type: e.type as number,
        }));
      },
      onDidChangeFolders: (listener: () => void) => {
        return workspaceService.onDidChangeFolders(listener);
      },
    },
    async (uriString: string) => {
      try {
        const uri = URI.parse(uriString);
        const existing = findOpenEditorInput(editorPart, uri);
        const input = existing ?? FileEditorInput.create(uri, textFileModelManager, fileService, undefined);
        if (editorService) {
          await editorService.openEditor(input, { pinned: true });
        }
      } catch (err) {
        console.error('[QuickAccess] Failed to open file:', uriString, err);
      }
    },
  );

  console.log('[Workbench] Quick Access file picker wired');
}
