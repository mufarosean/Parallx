export type ClawParityBehaviorArea =
  | 'autonomy'
  | 'memory'
  | 'skills'
  | 'tools'
  | 'approvals'
  | 'prompt-authority'
  | 'checkpoints'
  | 'traceability'
  | 'customizability'
  | 'extensibility';

export type ClawParityScenarioType = 'prompt' | 'tool' | 'approval' | 'checkpoint' | 'configuration';

export interface IClawParityScenario {
  readonly id: string;
  readonly area: ClawParityBehaviorArea;
  readonly type: ClawParityScenarioType;
  readonly name: string;
  readonly nemoExpectation: string;
  readonly parallxRequirement: string;
  readonly prompt: string;
  readonly requiredSignals: readonly string[];
  readonly comparisonMethod: 'live-ab' | 'artifact-compare';
  readonly blocker?: string;
}

export const CLAW_PARITY_SCENARIOS: readonly IClawParityScenario[] = [
  {
    id: 'CP01',
    area: 'autonomy',
    type: 'tool',
    name: 'Autonomous multi-step completion under runtime ownership',
    nemoExpectation: 'The runtime plans, invokes tools under runtime control, and finishes without hidden participant-local orchestration.',
    parallxRequirement: 'Default claw execution must coordinate the turn through the staged runtime and runtime-controlled tool executor.',
    prompt: 'Review the current workspace and summarize the most relevant accident claims guidance, using tools only when needed.',
    requiredSignals: ['runtime=claw', 'runState=completed', 'tool validation trace when tools are used'],
    comparisonMethod: 'live-ab',
  },
  {
    id: 'CP02',
    area: 'memory',
    type: 'checkpoint',
    name: 'Memory write-back only after finalization',
    nemoExpectation: 'Memory side effects happen only after an approved finalization boundary.',
    parallxRequirement: 'Queued memory writes must flush only after post-finalization and must be dropped on abort/failure.',
    prompt: 'Remember that I prefer concise answers and summarize the key facts from this conversation.',
    requiredSignals: ['post-finalization', 'memory-summary-refined-stored occurs after completion'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP03',
    area: 'skills',
    type: 'configuration',
    name: 'File-first skill visibility and load auditability',
    nemoExpectation: 'Visible file-backed skill contracts determine runtime capability exposure.',
    parallxRequirement: 'Bundled and workspace skills must be explainable through the same inspectable contract.',
    prompt: 'List the active skill/prompt layers affecting this turn.',
    requiredSignals: ['effective prompt layers are inspectable', 'skill source is identifiable'],
    comparisonMethod: 'artifact-compare',
    blocker: 'Full skill-manifest parity remains a larger follow-on track outside the runtime seam closure in this pass.',
  },
  {
    id: 'CP04',
    area: 'approvals',
    type: 'approval',
    name: 'Approval-gated tool invocation',
    nemoExpectation: 'Restricted actions create explicit approval state transitions before execution.',
    parallxRequirement: 'Tool calls in the claw lane must expose validation, approval request, approval resolution, and execution provenance.',
    prompt: 'Use a tool that requires approval and explain why approval was needed.',
    requiredSignals: ['approval state trace', 'tool provenance', 'executed only when approved'],
    comparisonMethod: 'live-ab',
  },
  {
    id: 'CP05',
    area: 'prompt-authority',
    type: 'prompt',
    name: 'Single prompt authority for claw-native surfaces',
    nemoExpectation: 'One runtime-owned prompt path assembles the effective prompt.',
    parallxRequirement: 'Default, @workspace, and @canvas must use the shared runtime prompt contract; bridge remains explicit compatibility, not a hidden second authority.',
    prompt: 'Explain which prompt layers and workspace rules influenced this answer.',
    requiredSignals: ['prompt-seed checkpoint', 'prompt-envelope checkpoint', 'explicit bridge compatibility boundary if the surface is bridge'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP06',
    area: 'checkpoints',
    type: 'checkpoint',
    name: 'Checkpoint ordering is explainable',
    nemoExpectation: 'A run can be reconstructed from named checkpoints.',
    parallxRequirement: 'Parse, prompt, tool, and finalization checkpoints must be emitted in a stable order with no hidden write-back before completion.',
    prompt: 'Answer a grounded workspace question and show the sources you used.',
    requiredSignals: ['ordered runtime checkpoints', 'completion or failure outcome trace'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP07',
    area: 'traceability',
    type: 'checkpoint',
    name: 'Runtime provenance remains visible through bridge surfaces',
    nemoExpectation: 'Compatibility boundaries are explicit rather than invisible alternate orchestration paths.',
    parallxRequirement: 'ChatBridge participants must carry an explicit bridge compatibility marker and shared runtime trace checkpoints.',
    prompt: 'Handle a bridged participant request and report runtime identity.',
    requiredSignals: ['bridge-handler-start', 'bridge-handler-complete', 'runtimeBoundary=bridge-compatibility'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP08',
    area: 'customizability',
    type: 'configuration',
    name: 'Workspace customization remains local and inspectable',
    nemoExpectation: 'Customization is file-first and discoverable.',
    parallxRequirement: 'Workspace/root prompt files and rules must remain visible inputs to the canonical runtime prompt.',
    prompt: 'Summarize how workspace prompt files alter this turn.',
    requiredSignals: ['workspace prompt layer recognized', 'hidden bundled string path absent'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP09',
    area: 'extensibility',
    type: 'tool',
    name: 'Bridge extensibility is explicit and bounded',
    nemoExpectation: 'Extensibility surfaces are explicit about what they own and what the runtime owns.',
    parallxRequirement: 'ChatBridge remains a documented compatibility surface with shared interpretation and trace hooks, not a hidden second runtime.',
    prompt: 'Invoke a tool-contributed participant and inspect the runtime metadata.',
    requiredSignals: ['surface=bridge', 'runtimeBoundary=bridge-compatibility'],
    comparisonMethod: 'artifact-compare',
  },
  {
    id: 'CP10',
    area: 'tools',
    type: 'tool',
    name: 'Tool provenance stays runtime-visible',
    nemoExpectation: 'Tool execution remains distinguishable by runtime-owned provenance rather than opaque participant behavior.',
    parallxRequirement: 'Claw-native tool execution must preserve tool identity, permission posture, and source provenance in runtime-visible records.',
    prompt: 'Use an available tool and explain which tool ran and why the runtime allowed it.',
    requiredSignals: ['tool identity visible', 'permission or approval posture visible', 'tool source provenance visible'],
    comparisonMethod: 'live-ab',
  },
];