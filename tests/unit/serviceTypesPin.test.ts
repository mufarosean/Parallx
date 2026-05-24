/**
 * Pin: serviceTypes — all 61 service identifier constants. The DI graph
 * keys off the `.id` string; any rename (intentional or accidental) is
 * a wire-protocol break across the workbench. This pin asserts that
 * every exported identifier carries a stable `.id` matching its name and
 * a `toString()` of the form `ServiceIdentifier(<id>)`.
 */
import { describe, it, expect } from "vitest";
import * as ST from "../../src/services/serviceTypes";

const EXPECTED_IDS: readonly string[] = [
  "ILifecycleService",
  "ILayoutService",
  "IViewService",
  "IWorkspaceService",
  "IWorkspaceMemoryService",
  "IWorkspaceTranscriptService",
  "ICanonicalMemorySearchService",
  "IGlobalStorageService",
  "IWorkspaceStorageService",
  "IWorkspaceBoundaryService",
  "IAgentPolicyService",
  "IAgentTaskStore",
  "IAgentApprovalService",
  "IAgentSessionService",
  "IAgentExecutionService",
  "IAgentMemoryService",
  "IAgentTraceService",
  "IDatabaseService",
  "IEditorResolverService",
  "IEditorService",
  "IEditorGroupService",
  "ICommandService",
  "IContextKeyService",
  "ISelectionService",
  "IToolRegistryService",
  "INotificationService",
  "IActivationEventService",
  "IToolErrorService",
  "IToolActivatorService",
  "IToolEnablementService",
  "IConfigurationService",
  "ICommandContributionService",
  "IKeybindingContributionService",
  "IMenuContributionService",
  "IViewContributionService",
  "IKeybindingService",
  "IWindowService",
  "IFileService",
  "ITextFileModelManager",
  "IThemeService",
  "IDocumentExtractionService",
  "IEmbeddingService",
  "IChunkingService",
  "IVectorStoreService",
  "ICanvasPageQueryService",
  "IIndexingPipelineService",
  "ISemanticGraphService",
  "IMindMapRefreshOrchestrator",
  "IRetrievalService",
  "IMemoryService",
  "IRelatedContentService",
  "IAutoTaggingService",
  "IProactiveSuggestionsService",
  "IAISettingsService",
  "IUnifiedAIConfigService",
  "ISessionManager",
  "IDiagnosticsService",
  "IObservabilityService",
  "IRuntimeHookRegistry",
  "IMcpClientService",
  "IAutonomyLogService",
];

describe("serviceTypes — DI identifier pins", () => {
  it("pins exactly 61 service identifiers", () => {
    expect(EXPECTED_IDS.length).toBe(61);
  });

  it.each(EXPECTED_IDS)("%s is exported with .id matching its name", (name) => {
    const ident = (ST as Record<string, unknown>)[name] as { id: string; toString(): string } | undefined;
    expect(ident, name).toBeDefined();
    expect(typeof ident!.id).toBe("string");
    expect(ident!.id).toBe(name);
  });

  it.each(EXPECTED_IDS)("%s.toString() returns ServiceIdentifier(<id>)", (name) => {
    const ident = (ST as Record<string, unknown>)[name] as { toString(): string };
    expect(ident.toString()).toBe(`ServiceIdentifier(${name})`);
  });

  it("each identifier is a fresh object (no accidental sharing)", () => {
    const seen = new Set<unknown>();
    for (const name of EXPECTED_IDS) {
      const ident = (ST as Record<string, unknown>)[name];
      expect(seen.has(ident), name).toBe(false);
      seen.add(ident);
    }
  });

  it("Global vs Workspace storage identifiers are distinct objects with distinct ids", () => {
    expect(ST.IGlobalStorageService).not.toBe(ST.IWorkspaceStorageService);
    expect(ST.IGlobalStorageService.id).toBe("IGlobalStorageService");
    expect(ST.IWorkspaceStorageService.id).toBe("IWorkspaceStorageService");
  });
});
