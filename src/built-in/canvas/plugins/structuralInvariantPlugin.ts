// structuralInvariantPlugin.ts — dev-time structural invariant guard
//
// Runs canvas structural validation after every doc-changing transaction and
// emits actionable diagnostics for malformed structures.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  issueFingerprint,
  reportCanvasInvariantIssues,
  validateCanvasStructuralInvariants,
} from '../invariants/canvasStructuralInvariants.js';
import { isDevMode } from '../../../platform/devMode.js';

export function structuralInvariantPlugin(): Plugin {
  const pluginKey = new PluginKey('canvasStructuralInvariantPlugin');
  let lastFingerprint = '';

  return new Plugin({
    key: pluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!isDevMode) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const issues = validateCanvasStructuralInvariants(newState.doc);
      const fingerprint = issueFingerprint(issues);

      if (issues.length === 0) {
        lastFingerprint = '';
        return null;
      }

      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        reportCanvasInvariantIssues(issues, {
          source: 'transaction',
          docVersion: newState.doc.content.size,
        });
      }

      return null;
    },
  });
}
