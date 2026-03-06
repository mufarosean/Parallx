// workbenchServices.ts — service registration and initialization

import { ServiceCollection } from '../services/serviceCollection.js';
import { ILifecycleService, ICommandService, IContextKeyService, IToolRegistryService, INotificationService, IActivationEventService, IToolErrorService, IConfigurationService, ICommandContributionService, IKeybindingContributionService, IMenuContributionService, IViewContributionService, IKeybindingService, IFileService, ITextFileModelManager, IDatabaseService, IWorkspaceService, ISessionManager } from '../services/serviceTypes.js';
import { ILanguageModelsService, IChatService, IChatAgentService, IChatModeService, IChatWidgetService, ILanguageModelToolsService } from '../services/chatTypes.js';
import { IEmbeddingService, IChunkingService, IVectorStoreService, IIndexingPipelineService, IRetrievalService, IMemoryService, IRelatedContentService, IAutoTaggingService, IProactiveSuggestionsService, IAISettingsService, IUnifiedAIConfigService, IDocumentExtractionService } from '../services/serviceTypes.js';
import { LifecycleService } from './lifecycle.js';
import { CommandService } from '../services/commandService.js';
import { ContextKeyService } from '../services/contextKeyService.js';
import { ToolRegistry } from '../tools/toolRegistry.js';
import { NotificationService } from '../api/notificationService.js';
import { ActivationEventService } from '../tools/activationEventService.js';
import { LanguageModelsService } from '../services/languageModelsService.js';
import { ChatService } from '../services/chatService.js';
import { ChatAgentService } from '../services/chatAgentService.js';
import { ChatModeService } from '../services/chatModeService.js';
import { ChatWidgetService } from '../services/chatWidgetService.js';
import { LanguageModelToolsService } from '../services/languageModelToolsService.js';
import { ToolErrorService } from '../tools/toolErrorIsolation.js';
import { SessionManager } from '../workspace/sessionManager.js';
import { ConfigurationRegistry } from '../configuration/configurationRegistry.js';
import { ConfigurationService } from '../configuration/configurationService.js';
import { CommandContributionProcessor } from '../contributions/commandContribution.js';
import { KeybindingContributionProcessor } from '../contributions/keybindingContribution.js';
import { MenuContributionProcessor } from '../contributions/menuContribution.js';
import { ViewContributionProcessor } from '../contributions/viewContribution.js';
import { KeybindingService } from '../services/keybindingService.js';
import { FileService } from '../services/fileService.js';
import { TextFileModelManager } from '../services/textFileModelManager.js';
import { EmbeddingService } from '../services/embeddingService.js';
import { ChunkingService } from '../services/chunkingService.js';
import { VectorStoreService } from '../services/vectorStoreService.js';
import { IndexingPipelineService } from '../services/indexingPipeline.js';
import { RetrievalService } from '../services/retrievalService.js';
import { MemoryService } from '../services/memoryService.js';
import { RelatedContentService } from '../services/relatedContentService.js';
import { AutoTaggingService } from '../services/autoTaggingService.js';
import { ProactiveSuggestionsService } from '../services/proactiveSuggestionsService.js';
import { DocumentExtractionService } from '../services/documentExtractionService.js';
import { AISettingsService } from '../aiSettings/aiSettingsService.js';
import { UnifiedAIConfigService } from '../aiSettings/unifiedAIConfigService.js';
import type { IStorage } from '../platform/storage.js';
import type { ViewManager } from '../views/viewManager.js';

/**
 * Registers all core services into the service collection.
 *
 * This is the composition root: it wires concrete implementations
 * to their service identifiers. Called once during workbench startup.
 *
 * As capabilities are implemented, their services are added here.
 */
export function registerWorkbenchServices(services: ServiceCollection): void {
  // ── Lifecycle ──
  services.registerInstance(ILifecycleService, new LifecycleService());

  // ── Session Manager (M14) ── workspace session identity
  services.registerInstance(ISessionManager, new SessionManager());

  // ── Context Key (Capability 8) ──
  services.registerInstance(IContextKeyService, new ContextKeyService());

  // ── Command (Capability 7) ──
  services.registerInstance(ICommandService, new CommandService(services));

  // ── Tool Registry (M2 Capability 1) ──
  services.registerInstance(IToolRegistryService, new ToolRegistry());

  // ── Notification Service (M2 Capability 2) ──
  services.registerInstance(INotificationService, new NotificationService());

  // ── Activation Event Service (M2 Capability 3) ──
  services.registerInstance(IActivationEventService, new ActivationEventService());

  // ── Tool Error Service (M2 Capability 3) ──
  services.registerInstance(IToolErrorService, new ToolErrorService());

  // ── File Service (M4 Capability 1) ──
  const fileService = new FileService();
  services.registerInstance(IFileService, fileService);

  // ── Text File Model Manager (M4 Capability 1) ──
  const textFileModelManager = new TextFileModelManager(fileService);
  services.registerInstance(ITextFileModelManager, textFileModelManager);

  // Note: IToolActivatorService is registered in the workbench after
  // all dependencies (API factory deps) are available.

  // Note: IConfigurationService is registered in the workbench after
  // storage is initialized (requires IStorage from Phase 1).

  // Note: Contribution processors (ICommandContributionService,
  // IKeybindingContributionService, IMenuContributionService) are
  // registered in the workbench during Phase 5 after CommandService
  // and ActivationEventService are available.
}

/**
 * Creates and registers the ConfigurationService.
 * Called after storage is available (Phase 1).
 *
 * @returns The ConfigurationService and ConfigurationRegistry instances.
 */
export function registerConfigurationServices(
  services: ServiceCollection,
  storage: IStorage,
): { configService: ConfigurationService; configRegistry: ConfigurationRegistry } {
  const configRegistry = new ConfigurationRegistry();
  const configService = new ConfigurationService(storage, configRegistry);

  services.registerInstance(IConfigurationService, configService);

  return { configService, configRegistry };
}

/**
 * Creates and registers the contribution processors (M2 Capability 5)
 * and the centralized KeybindingService (M3 Capability 0.3).
 * Called during Phase 5 after CommandService and ActivationEventService are available.
 *
 * @returns The three contribution processor instances and the KeybindingService.
 */
export function registerContributionProcessors(
  services: ServiceCollection,
): {
  commandContribution: CommandContributionProcessor;
  keybindingContribution: KeybindingContributionProcessor;
  menuContribution: MenuContributionProcessor;
  keybindingService: KeybindingService;
} {
  const commandService = services.get(ICommandService) as unknown as import('../commands/commandRegistry.js').CommandService;
  const activationEvents = services.get(IActivationEventService) as unknown as ActivationEventService;

  const commandContribution = new CommandContributionProcessor(commandService, activationEvents);
  const keybindingContribution = new KeybindingContributionProcessor(commandService);
  const menuContribution = new MenuContributionProcessor(commandService);

  // Create the centralized KeybindingService (M3 Capability 0.3)
  const keybindingService = new KeybindingService(commandService);

  // Wire context key service if available
  if (services.has(IContextKeyService)) {
    const contextKeyService = services.get(IContextKeyService);
    keybindingContribution.setContextKeyService(contextKeyService);
    menuContribution.setContextKeyService(contextKeyService);
    keybindingService.setContextKeyService(contextKeyService);
  }

  // Tell the keybinding contribution processor to delegate dispatch
  // to the centralized service instead of its own listener
  keybindingContribution.setKeybindingService(keybindingService);

  services.registerInstance(ICommandContributionService, commandContribution);
  services.registerInstance(IKeybindingContributionService, keybindingContribution);
  services.registerInstance(IMenuContributionService, menuContribution);
  services.registerInstance(IKeybindingService, keybindingService);

  return { commandContribution, keybindingContribution, menuContribution, keybindingService };
}

/**
 * Creates and registers the ViewContributionProcessor (M2 Capability 6).
 * Called during Phase 5 after ViewManager is available.
 */
export function registerViewContributionProcessor(
  services: ServiceCollection,
  viewManager: ViewManager,
): ViewContributionProcessor {
  const viewContribution = new ViewContributionProcessor(viewManager);
  services.registerInstance(IViewContributionService, viewContribution);
  return viewContribution;
}

/**
 * Creates and registers the AI chat services (M9 Capability 0–2).
 * Called during Phase 5 after core services are available.
 *
 * @returns The service instances for further wiring.
 */
export function registerChatServices(
  services: ServiceCollection,
): {
  languageModelsService: LanguageModelsService;
  chatService: ChatService;
  chatAgentService: ChatAgentService;
  chatModeService: ChatModeService;
  chatWidgetService: ChatWidgetService;
  languageModelToolsService: LanguageModelToolsService;
} {
  const languageModelsService = new LanguageModelsService();
  const chatAgentService = new ChatAgentService();
  const chatModeService = new ChatModeService();
  const chatWidgetService = new ChatWidgetService();
  const languageModelToolsService = new LanguageModelToolsService();
  const chatService = new ChatService(
    chatAgentService,
    chatModeService,
    languageModelsService,
    undefined, // database is late-bound via setDatabase() after Phase 5 opens it
  );

  services.registerInstance(ILanguageModelsService, languageModelsService);
  services.registerInstance(IChatService, chatService);
  services.registerInstance(IChatAgentService, chatAgentService);
  services.registerInstance(IChatModeService, chatModeService);
  services.registerInstance(IChatWidgetService, chatWidgetService);
  services.registerInstance(ILanguageModelToolsService, languageModelToolsService);

  return { languageModelsService, chatService, chatAgentService, chatModeService, chatWidgetService, languageModelToolsService };
}

/**
 * Creates and registers the RAG / indexing services (M10 Phase 1–2).
 * Called during Phase 5 after DatabaseService and FileService are available.
 *
 * Returns the IndexingPipelineService — the caller should call `.start()`
 * after the database is fully open and canvas migrations have run.
 */
export function registerIndexingServices(
  services: ServiceCollection,
): {
  embeddingService: EmbeddingService;
  chunkingService: ChunkingService;
  vectorStoreService: VectorStoreService;
  indexingPipeline: IndexingPipelineService;
  retrievalService: RetrievalService;
  memoryService: MemoryService;
  relatedContentService: RelatedContentService;
  autoTaggingService: AutoTaggingService;
  proactiveSuggestionsService: ProactiveSuggestionsService;
} {
  const databaseService = services.get(IDatabaseService);
  const fileService = services.get(IFileService);
  const workspaceService = services.get(IWorkspaceService);
  const sessionManager = services.has(ISessionManager) ? services.get(ISessionManager) : undefined;

  const embeddingService = new EmbeddingService();
  const chunkingService = new ChunkingService();
  const vectorStoreService = new VectorStoreService(databaseService);
  const documentExtractionService = new DocumentExtractionService();
  const indexingPipeline = new IndexingPipelineService(
    databaseService,
    fileService,
    embeddingService,
    chunkingService,
    vectorStoreService,
    workspaceService,
    sessionManager,
    documentExtractionService,
  );
  const retrievalService = new RetrievalService(embeddingService, vectorStoreService);
  const memoryService = new MemoryService(databaseService, embeddingService, vectorStoreService);

  services.registerInstance(IEmbeddingService, embeddingService);
  services.registerInstance(IChunkingService, chunkingService);
  services.registerInstance(IVectorStoreService, vectorStoreService);
  services.registerInstance(IDocumentExtractionService, documentExtractionService);
  services.registerInstance(IIndexingPipelineService, indexingPipeline);
  services.registerInstance(IRetrievalService, retrievalService);
  services.registerInstance(IMemoryService, memoryService);

  // ── Phase 7: Advanced Feature Services (M10) ──

  const relatedContentService = new RelatedContentService(embeddingService, vectorStoreService, databaseService, indexingPipeline);
  const autoTaggingService = new AutoTaggingService(embeddingService, vectorStoreService, databaseService, indexingPipeline);

  // M15: Pass AI Settings service so thresholds are configurable
  const aiSettingsService = services.has(IAISettingsService) ? services.get(IAISettingsService) : undefined;
  const proactiveSuggestionsService = new ProactiveSuggestionsService(embeddingService, vectorStoreService, databaseService, indexingPipeline, aiSettingsService);

  services.registerInstance(IRelatedContentService, relatedContentService);
  services.registerInstance(IAutoTaggingService, autoTaggingService);
  services.registerInstance(IProactiveSuggestionsService, proactiveSuggestionsService);

  return { embeddingService, chunkingService, vectorStoreService, indexingPipeline, retrievalService, memoryService, relatedContentService, autoTaggingService, proactiveSuggestionsService };
}

/**
 * Creates and registers the AI Settings service (M15 Capability 1).
 * Called during Phase 1 (initializeServices) after storage and chat services
 * are available.
 *
 * @returns The AISettingsService instance for further wiring.
 */
export async function registerAISettingsService(
  services: ServiceCollection,
  storage: IStorage,
): Promise<AISettingsService> {
  const languageModelsService = services.has(ILanguageModelsService)
    ? services.get(ILanguageModelsService)
    : undefined;
  const aiSettingsService = new AISettingsService(storage, languageModelsService);
  await aiSettingsService.initialize();
  services.registerInstance(IAISettingsService, aiSettingsService);
  return aiSettingsService;
}

/**
 * Creates and registers the Unified AI Config service (M20 Task A.4).
 * Called after registerAISettingsService so legacy migration can read old profiles.
 *
 * @returns The UnifiedAIConfigService instance for further wiring.
 */
export async function registerUnifiedAIConfigService(
  services: ServiceCollection,
  storage: IStorage,
): Promise<UnifiedAIConfigService> {
  const languageModelsService = services.has(ILanguageModelsService)
    ? services.get(ILanguageModelsService)
    : undefined;
  const unifiedConfigService = new UnifiedAIConfigService(storage, languageModelsService);
  await unifiedConfigService.initialize();
  services.registerInstance(IUnifiedAIConfigService, unifiedConfigService);

  // Also register as IAISettingsService for backward compatibility.
  // Consumers that resolve IAISettingsService get the unified service,
  // which implements the full IAISettingsService interface.
  services.registerInstance(IAISettingsService, unifiedConfigService);

  return unifiedConfigService;
}
