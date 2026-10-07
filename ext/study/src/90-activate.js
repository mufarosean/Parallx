// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 90: ACTIVATION
// activate, deactivate, __testables. The shape is Flashcards' SECTION 15,
// copied so the two extensions start and stop the same way.
// ═══════════════════════════════════════════════════════════════════════════════

let _activated = false;

/** Open the database and run `<toolPath>/db/migrations`. Copied from Flashcards' ensureDatabase. */
async function ensureDatabase(api) {
  const openResult = await api.database.open();
  if (openResult?.error) {
    console.error('[Study] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = String(api.env?.toolPath || '');
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res?.error) {
    console.error('[Study] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;

  if (!api.database) {
    console.error('[Study] api.database unavailable; cannot activate.');
    return;
  }
  _dbBridge = api.database;
  const ok = await ensureDatabase(api);
  if (!ok) return;

  injectStyles();

  context.subscriptions.push(
    api.views.registerViewProvider('study.materials', {
      createView: (container) => createSidebarView(container),
    }),
  );

  context.subscriptions.push(
    api.editors.registerEditorProvider('study', {
      createEditorPane: (container, input) => createEditorPane(container, input),
    }),
  );

  registerCommands(context);
  registerSelectionAction(context);
  registerQuestionProviders(context);
  registerRatingListener(context);
  registerDashboardWidget(context);
  registerLinks(context);
  registerChatTools(context);
  registerPlannerDayLoads(context);

  console.log('[Study] activated');
}

export async function deactivate() {
  _activated = false;
  // The host disposes context.subscriptions; this drops what lives in module
  // state: in-flight generation stops, pending retries never fire, marking
  // still queued does nothing once _api is null, and the styles go.
  stCancelRuns();
  stClearRetryTimers();
  _stGrades.clear();
  if (typeof document !== 'undefined' && document.getElementById) {
    const style = document.getElementById('study-styles');
    if (style) style.remove();
  }
  _stStyleInjected = false;
  if (_ratingListener && typeof document !== 'undefined' && document.removeEventListener) {
    document.removeEventListener('parallx:card-rated', _ratingListener);
  }
  _ratingListener = null;
  _questionRegistry = null;
  _fcCheck = null;
  _picked = [];
  _dbBridge = null;
  _api = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 91: TESTABLES
// ═══════════════════════════════════════════════════════════════════════════════

export const __testables = {
  /** Bind a fake api without activating (jsdom tests of the pane and sidebar). */
  __setApi: (api) => { _api = api; _dbBridge = api?.database || null; },
  // 40/50/60: the surfaces, for jsdom tests over the real bundle
  injectStyles,
  createSidebarView,
  createEditorPane,
  stOpenPane,
  stOpenSetup,
  stDeleteMaterial,
  // 60-pane: setup, Test marking, review
  stCountScopeQuestions,
  stSetupCountText,
  stBankOriginText,
  stItemAnswered,
  stTestQuestion,
  stStoredVerdict,
  stQueueTestGrade,
  stPendingGrades,
  stEnsureTestGrades,
  stCancelRuns,
  stErrText,
  stSentence,
  stRunFor,
  // 00-header
  el,
  icon,
  cfg,
  stNow,
  stWorkspaceRoot,
  stFsPathOf,
  stUriOf,
  stTruncate,
  stEsc,
  bus,
  onDataChanged,
  ST_FORMATS,
  ST_TYPED,
  AGAIN, HARD, GOOD, EASY,
  MIN, DAY,
  ST_ICON_HTML,
  // 10-model (the pure model, docs/STUDY_BUILD_SPEC.md §4)
  stConceptState,
  stApplyAnswer,
  stConceptIsCleanIn,
  stFormatClass,
  stResolveFormat,
  stDrawSession,
  stCoverage,
  stSessionSummary,
  stContextPlan,
  stChunkPages,
  stSkeleton,
  stAnchorOnPage,
  stFindAnchorPage,
  stHeadingsFromPages,
  stSectionsFromOutline,
  stExtractJsonArray,
  stExtractJsonObject,
  stNormalizeRubric,
  stNormalizeVerdict,
  stScoreVerdict,
  stMapVerdictToRating,
  stVerdictLabel,
  stRatingWord,
  stNormalizeFormula,
  stFormulaMatches,
  stNumericMatches,
  stClozeMatches,
  stValidateQuestion,
  stDistractorPrompts,
  stParseQuestionFile,
  stParseExaminerReport,
  stMatchReportToQuestions,
  stInterleaveMaterials,
  stMasteryFromCardRating,
  // 70-integration: state and pure helpers
  stPicked,
  stSetPicked,
  stScopeOf,
  stSectionForPage,
  stPdfOfOpenEditors,
  stPathOfEditor,
  stConceptQuestion,
  stBestTypedQuestion,
  stCardsForMissed,
  stQuestionsInScope,
  stDayLoadsFor,
  stWeakRowsFrom,
  stFindMaterial,
  stParsePages,
  // 70-integration: the api-bound surface (needs activate or __setApi first)
  stSessionNeedsGeneration,
  stStartSession,
  stShowSource,
  stFlashcardsAvailable,
  stSendMissedToFlashcards,
  stSessionContext,
  stQuizSelection,
  stPickWorkspaceFile,
  stDayLoads,
  stWeakSpotRows,
  stLoadConcept,
  stIsBankQuestion,
  stQuestionAnswerText,
  stLastDrawItems,
  stMissedCardGroups,
  stCloseSourceEditor,
  stPathArg,
  stRetryLater,
  stClearRetryTimers,
  stCmdAddMaterial,
  stCmdImportQuestions,
  stCmdImportReport,
  stCmdStudyTogether,
  // 10-model, 20-data, 30-ai: the pipeline (guarded with typeof so the bundle never throws when one is missing)
  stScopeQuestionCount: typeof stScopeQuestionCount === 'function' ? stScopeQuestionCount : undefined,
  stScopeStats: typeof stScopeStats === 'function' ? stScopeStats : undefined,
  stPagePartition: typeof stPagePartition === 'function' ? stPagePartition : undefined,
  stSpreadOrder: typeof stSpreadOrder === 'function' ? stSpreadOrder : undefined,
  stMaterialLabelFor: typeof stMaterialLabelFor === 'function' ? stMaterialLabelFor : undefined,
  stQuestionAnswerable: typeof stQuestionAnswerable === 'function' ? stQuestionAnswerable : undefined,
  stProviderRefOf: typeof stProviderRefOf === 'function' ? stProviderRefOf : undefined,
  stQuestionKeys: typeof stQuestionKeys === 'function' ? stQuestionKeys : undefined,
  stConceptsForSections: typeof stConceptsForSections === 'function' ? stConceptsForSections : undefined,
  stEnsureBank: typeof stEnsureBank === 'function' ? stEnsureBank : undefined,
  stNextDraw: typeof stNextDraw === 'function' ? stNextDraw : undefined,
  stGenerateQuestions: typeof stGenerateQuestions === 'function' ? stGenerateQuestions : undefined,
  stGradeTyped: typeof stGradeTyped === 'function' ? stGradeTyped : undefined,
  stSyncProviders: typeof stSyncProviders === 'function' ? stSyncProviders : undefined,
  stRunNumericCheck: typeof stRunNumericCheck === 'function' ? stRunNumericCheck : undefined,
  stNumericSolutionSafe: typeof stNumericSolutionSafe === 'function' ? stNumericSolutionSafe : undefined,
  stNumericScript: typeof stNumericScript === 'function' ? stNumericScript : undefined,
  ST_NUMERIC_WRAPPER: typeof ST_NUMERIC_WRAPPER === 'string' ? ST_NUMERIC_WRAPPER : undefined,
};
