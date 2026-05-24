/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import {
  buildOpenclawDefaultParticipantServices,
  buildOpenclawWorkspaceParticipantServices,
  buildOpenclawCanvasParticipantServices,
} from "../../src/openclaw/openclawParticipantServices";

describe("buildOpenclawDefaultParticipantServices", () => {
  const baseDeps = {
    sendChatRequest: () => ({}) as any,
    getActiveModel: () => "m",
    getWorkspaceName: () => "ws",
    getPageCount: async () => 0,
    getCurrentPageTitle: () => undefined,
    getToolDefinitions: () => [],
    getReadOnlyToolDefinitions: () => [],
  };

  it("forwards required functions by identity", () => {
    const svc = buildOpenclawDefaultParticipantServices(baseDeps as any);
    expect(svc.sendChatRequest).toBe(baseDeps.sendChatRequest);
    expect(svc.getActiveModel).toBe(baseDeps.getActiveModel);
    expect(svc.getWorkspaceName).toBe(baseDeps.getWorkspaceName);
    expect(svc.getPageCount).toBe(baseDeps.getPageCount);
    expect(svc.getCurrentPageTitle).toBe(baseDeps.getCurrentPageTitle);
    expect(svc.getToolDefinitions).toBe(baseDeps.getToolDefinitions);
    expect(svc.getReadOnlyToolDefinitions).toBe(baseDeps.getReadOnlyToolDefinitions);
  });

  it("leaves optional callbacks undefined when not provided", () => {
    const svc = buildOpenclawDefaultParticipantServices(baseDeps as any);
    expect(svc.diagnosticsService).toBeUndefined();
    expect(svc.observabilityService).toBeUndefined();
    expect(svc.executeCommand).toBeUndefined();
    expect(svc.listModels).toBeUndefined();
    expect(svc.getSessionFlag).toBeUndefined();
    expect(svc.setSessionFlag).toBeUndefined();
    expect(svc.getLinkContractDescriptors).toBeUndefined();
    expect(svc.runtimeHookRegistry).toBeUndefined();
    expect(svc.maxIterations).toBeUndefined();
    expect(svc.networkTimeout).toBeUndefined();
  });

  it("preserves optional values verbatim, including primitives like 0/empty", () => {
    const deps = {
      ...baseDeps,
      maxIterations: 0,
      networkTimeout: 0,
      listModels: async () => [],
      checkProviderStatus: async () => ({ available: false } as const),
      getSessionFlag: () => false,
      setSessionFlag: () => {},
      executeCommand: () => {},
      diagnosticsService: { runChecks: async () => [] },
      observabilityService: {
        getSessionMetrics: () => ({} as any),
        getModelMetrics: () => [],
      },
      runtimeHookRegistry: { hooks: [] },
      getLinkContractDescriptors: () => [],
    };
    const svc = buildOpenclawDefaultParticipantServices(deps as any);
    expect(svc.maxIterations).toBe(0);
    expect(svc.networkTimeout).toBe(0);
    expect(svc.listModels).toBe(deps.listModels);
    expect(svc.checkProviderStatus).toBe(deps.checkProviderStatus);
    expect(svc.getSessionFlag).toBe(deps.getSessionFlag);
    expect(svc.setSessionFlag).toBe(deps.setSessionFlag);
    expect(svc.executeCommand).toBe(deps.executeCommand);
    expect(svc.diagnosticsService).toBe(deps.diagnosticsService);
    expect(svc.observabilityService).toBe(deps.observabilityService);
    expect(svc.runtimeHookRegistry).toBe(deps.runtimeHookRegistry);
    expect(svc.getLinkContractDescriptors).toBe(deps.getLinkContractDescriptors);
  });

  it("does not call any of the forwarded functions during construction", () => {
    let callCount = 0;
    const counter = () => { callCount++; return undefined; };
    buildOpenclawDefaultParticipantServices({
      ...baseDeps,
      getActiveModel: counter,
      getWorkspaceName: counter,
      getCurrentPageTitle: counter,
      getToolDefinitions: counter,
      getReadOnlyToolDefinitions: counter,
    } as any);
    expect(callCount).toBe(0);
  });
});

describe("buildOpenclawWorkspaceParticipantServices", () => {
  const deps = {
    sendChatRequest: () => ({}) as any,
    getActiveModel: () => "m",
    getWorkspaceName: () => "ws",
    listPages: async () => [],
    searchPages: async () => [],
    getPageContent: async () => null,
    getPageTitle: async () => null,
  };

  it("forwards required workspace fields", () => {
    const svc = buildOpenclawWorkspaceParticipantServices(deps as any);
    expect(svc.sendChatRequest).toBe(deps.sendChatRequest);
    expect(svc.listPages).toBe(deps.listPages);
    expect(svc.searchPages).toBe(deps.searchPages);
    expect(svc.getPageContent).toBe(deps.getPageContent);
    expect(svc.getPageTitle).toBe(deps.getPageTitle);
  });

  it("leaves optional fields undefined when omitted", () => {
    const svc = buildOpenclawWorkspaceParticipantServices(deps as any);
    expect(svc.getReadOnlyToolDefinitions).toBeUndefined();
    expect(svc.filterToolsForSession).toBeUndefined();
    expect(svc.invokeToolWithRuntimeControl).toBeUndefined();
    expect(svc.listFiles).toBeUndefined();
    expect(svc.observabilityService).toBeUndefined();
    expect(svc.runtimeHookRegistry).toBeUndefined();
  });

  it("forwards provided optional fields by identity", () => {
    const observabilityService = {
      getSessionMetrics: () => ({} as any),
      getModelMetrics: () => [],
    };
    const runtimeHookRegistry = { hooks: [] };
    const svc = buildOpenclawWorkspaceParticipantServices({
      ...deps,
      observabilityService,
      runtimeHookRegistry,
      getReadOnlyToolDefinitions: () => [],
    } as any);
    expect(svc.observabilityService).toBe(observabilityService);
    expect(svc.runtimeHookRegistry).toBe(runtimeHookRegistry);
    expect(typeof svc.getReadOnlyToolDefinitions).toBe("function");
  });
});

describe("buildOpenclawCanvasParticipantServices", () => {
  const deps = {
    sendChatRequest: () => ({}) as any,
    getActiveModel: () => "m",
    getWorkspaceName: () => "ws",
    getCurrentPageId: () => "p",
    getCurrentPageTitle: () => "t",
    getPageStructure: async () => ({} as any),
  };

  it("forwards required canvas fields by identity", () => {
    const svc = buildOpenclawCanvasParticipantServices(deps as any);
    expect(svc.sendChatRequest).toBe(deps.sendChatRequest);
    expect(svc.getCurrentPageId).toBe(deps.getCurrentPageId);
    expect(svc.getCurrentPageTitle).toBe(deps.getCurrentPageTitle);
    expect(svc.getPageStructure).toBe(deps.getPageStructure);
  });

  it("leaves optional callbacks undefined when omitted", () => {
    const svc = buildOpenclawCanvasParticipantServices(deps as any);
    expect(svc.invokeToolWithRuntimeControl).toBeUndefined();
    expect(svc.readFileContent).toBeUndefined();
    expect(svc.observabilityService).toBeUndefined();
    expect(svc.runtimeHookRegistry).toBeUndefined();
  });
});
