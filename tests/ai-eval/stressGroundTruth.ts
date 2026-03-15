// stressGroundTruth.ts — Ground truth for the M39 stress-test workspace
//
// Provides complete file inventory, contradiction pairs, folder counts,
// and duplicate filename mapping for Playwright eval assertions.

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface StressFileEntry {
  /** Relative path from workspace root. */
  readonly path: string;
  /** Brief description of the file's role in the test workspace. */
  readonly summary: string;
  /** True if the file is a stub (≤3 sentences of real content). */
  readonly isStub: boolean;
  /** True if the file is irrelevant noise (not insurance content). */
  readonly isNoise: boolean;
  /** True if the file is an incomplete draft with TODOs. */
  readonly isDraft: boolean;
}

export interface ContradictionPair {
  readonly label: string;
  readonly fileA: string;
  readonly fileB: string;
  readonly detail: string;
  readonly valueA: string;
  readonly valueB: string;
}

export interface DuplicateNameGroup {
  readonly filename: string;
  readonly paths: readonly string[];
  readonly description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// File Inventory
// ═══════════════════════════════════════════════════════════════════════════════

export const STRESS_FILES: readonly StressFileEntry[] = [
  { path: 'README.md', summary: 'Minimal workspace readme — 3 lines', isStub: true, isNoise: false, isDraft: false },
  // policies/
  { path: 'policies/auto-policy-2024.md', summary: 'Full 2024 auto insurance policy with tables and coverage details', isStub: false, isNoise: false, isDraft: false },
  { path: 'policies/auto-policy-2023.md', summary: 'Older 2023 auto policy — different deductibles ($750 collision)', isStub: false, isNoise: false, isDraft: false },
  { path: 'policies/homeowners-draft.md', summary: 'Incomplete homeowners draft with TODOs and missing sections', isStub: false, isNoise: false, isDraft: true },
  { path: 'policies/umbrella/overview.md', summary: 'Umbrella overview — 2 sentences only (stub)', isStub: true, isNoise: false, isDraft: false },
  { path: 'policies/umbrella/umbrella-coverage.md', summary: 'Detailed umbrella liability policy with limits and exclusions', isStub: false, isNoise: false, isDraft: false },
  // claims/
  { path: 'claims/how-to-file.md', summary: 'Official 5-step claim filing guide with timeline table', isStub: false, isNoise: false, isDraft: false },
  { path: 'claims/settlement-calculations.md', summary: 'Settlement math — ACV, total loss, bodily injury, subrogation', isStub: false, isNoise: false, isDraft: false },
  { path: 'claims/archived/claim-2019-johnson.md', summary: 'Closed 2019 collision claim — narrative case file', isStub: false, isNoise: false, isDraft: false },
  { path: 'claims/archived/claim-2020-martinez.md', summary: 'Closed 2020 theft claim — partially redacted', isStub: false, isNoise: false, isDraft: false },
  // contacts/
  { path: 'contacts/agent-directory.md', summary: 'Directory of 8 insurance agents with specialties', isStub: false, isNoise: false, isDraft: false },
  { path: 'contacts/vendors-and-shops.md', summary: 'Repair shops and vendors — inconsistent formatting', isStub: false, isNoise: false, isDraft: false },
  // notes/
  { path: 'notes/how-to-file.md', summary: 'Informal personal notes on filing claims — contradicts official guide (3 steps, wrong order)', isStub: false, isNoise: false, isDraft: false },
  { path: 'notes/meeting-2024-03.md', summary: 'March 2024 team meeting minutes — rambling, unstructured', isStub: false, isNoise: false, isDraft: false },
  { path: 'notes/random-thoughts.md', summary: 'Completely irrelevant — weekend plans, recipes, personal notes', isStub: false, isNoise: true, isDraft: false },
  { path: 'notes/policy-comparison.md', summary: 'Informal comparison of 2023 vs 2024 policy — has a note about FAQ being outdated', isStub: false, isNoise: false, isDraft: false },
  // reference/
  { path: 'reference/state-regulations.md', summary: 'Long legal reference — state insurance regulations, 400+ lines', isStub: false, isNoise: false, isDraft: false },
  { path: 'reference/glossary.md', summary: 'Insurance terms and definitions', isStub: false, isNoise: false, isDraft: false },
  { path: 'reference/FAQ.md', summary: 'FAQ with 30 Q&A pairs — liability figure contradicts 2024 policy', isStub: false, isNoise: false, isDraft: false },
] as const;

/** Total number of content files (excludes .parallx/ config files). */
export const TOTAL_FILE_COUNT = STRESS_FILES.length;

// ═══════════════════════════════════════════════════════════════════════════════
// Folder Counts
// ═══════════════════════════════════════════════════════════════════════════════

export const FOLDER_FILE_COUNTS: Record<string, number> = {
  'policies': 5,       // auto-policy-2024, auto-policy-2023, homeowners-draft, umbrella/overview, umbrella/umbrella-coverage
  'claims': 4,         // how-to-file, settlement-calculations, archived/claim-2019-johnson, archived/claim-2020-martinez
  'contacts': 2,       // agent-directory, vendors-and-shops
  'notes': 4,          // how-to-file, meeting-2024-03, random-thoughts, policy-comparison
  'reference': 3,      // state-regulations, glossary, FAQ
};

// ═══════════════════════════════════════════════════════════════════════════════
// Contradictions (Ground Truth)
// ═══════════════════════════════════════════════════════════════════════════════

export const CONTRADICTIONS: readonly ContradictionPair[] = [
  {
    label: 'Collision deductible',
    fileA: 'policies/auto-policy-2024.md',
    fileB: 'policies/auto-policy-2023.md',
    detail: 'Different collision deductible amounts across policy years',
    valueA: '$500',
    valueB: '$750',
  },
  {
    label: 'Filing steps',
    fileA: 'claims/how-to-file.md',
    fileB: 'notes/how-to-file.md',
    detail: 'Official guide has 5 steps; informal notes say 3 steps in wrong order',
    valueA: '5 steps',
    valueB: '3 steps',
  },
  {
    label: 'Liability coverage limit',
    fileA: 'policies/auto-policy-2024.md',
    fileB: 'reference/FAQ.md',
    detail: 'Policy states $250,000 per person; FAQ states $100,000 per person (outdated)',
    valueA: '$250,000',
    valueB: '$100,000',
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Duplicate Filename Mapping
// ═══════════════════════════════════════════════════════════════════════════════

export const DUPLICATE_FILENAMES: readonly DuplicateNameGroup[] = [
  {
    filename: 'how-to-file.md',
    paths: ['claims/how-to-file.md', 'notes/how-to-file.md'],
    description: 'Official vs informal claim filing instructions',
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers for Tests
// ═══════════════════════════════════════════════════════════════════════════════

/** All file paths in the workspace (for exhaustive coverage assertions). */
export const ALL_FILE_PATHS: readonly string[] = STRESS_FILES.map(f => f.path);

/** Only non-noise, non-stub content files. */
export const SUBSTANTIVE_FILES: readonly StressFileEntry[] = STRESS_FILES.filter(
  f => !f.isNoise && !f.isStub,
);

/** File paths that are stubs or near-empty. */
export const STUB_FILE_PATHS: readonly string[] = STRESS_FILES
  .filter(f => f.isStub)
  .map(f => f.path);

/** File paths that are noise/irrelevant. */
export const NOISE_FILE_PATHS: readonly string[] = STRESS_FILES
  .filter(f => f.isNoise)
  .map(f => f.path);

/** File paths that are drafts. */
export const DRAFT_FILE_PATHS: readonly string[] = STRESS_FILES
  .filter(f => f.isDraft)
  .map(f => f.path);
