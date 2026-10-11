// tokenBudgetService.ts — the one token estimator the app shares.
//
// Every context budget in the app (the chat runtime's elastic budget, the
// built-in chat's pills and status bar) sizes text with this estimate, so a
// number shown in one place matches the one used in another.

/** Estimate tokens from a string with the chars/4 heuristic (the same one VS Code uses). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
