// workbenchDiagnosticChecks.ts — the workbench as a diagnostics category.
//
// Phase C of SYSTEM_INTEGRITY.md: fifteen of fifteen diagnostic checks
// were about the AI stack — activation health, keybinding conflicts, and
// layout integrity were unchecked. These producers close over the
// IntrospectionService (the join already knows everything they ask) and
// register through DiagnosticsService.addChecks once the workbench has
// constructed it. /doctor renders them like any other check.

import type { IDiagnosticCheckProducer, IDiagnosticResult } from './serviceTypes.js';
import type { IIntrospectionService } from './introspectionService.js';

function result(
  name: string,
  status: IDiagnosticResult['status'],
  detail: string,
): IDiagnosticResult {
  return { name, status, detail: detail.slice(0, 300), timestamp: Date.now(), category: 'workbench' };
}

export function createWorkbenchDiagnosticChecks(
  introspection: IIntrospectionService,
): IDiagnosticCheckProducer[] {
  const checkToolHealth: IDiagnosticCheckProducer = async () => {
    const tools = introspection.describeTools();
    const activated = tools.filter((t) => t.state === 'activated').length;
    const failing = tools.filter((t) => t.errorCount > 0);
    if (failing.length === 0) {
      return result('Tool Health', 'pass', `${activated} of ${tools.length} tools activated, no recorded errors`);
    }
    return result(
      'Tool Health', 'warn',
      `${failing.length} tool(s) with recorded errors: ${failing.map((t) => `${t.id} (${t.errorCount})`).join(', ')}`,
    );
  };

  const checkKeybindingConflicts: IDiagnosticCheckProducer = async () => {
    const conflicts = introspection.findKeyConflicts();
    // Distinct when-clauses can partition a key legitimately; only a key
    // with two or more UNGUARDED bindings is a genuine collision (the
    // dispatcher resolves it silently, last-registered wins).
    const unguarded = conflicts.filter((c) => c.bindings.filter((b) => !b.when).length > 1);
    if (unguarded.length > 0) {
      return result(
        'Keybinding Conflicts', 'warn',
        `${unguarded.length} key(s) with multiple unguarded bindings: ${unguarded.map((c) => c.key).join(', ')}`,
      );
    }
    if (conflicts.length > 0) {
      return result(
        'Keybinding Conflicts', 'pass',
        `${conflicts.length} shared key(s), all partitioned by when-clauses`,
      );
    }
    return result('Keybinding Conflicts', 'pass', 'no key is bound to more than one command');
  };

  const checkLayoutIntegrity: IDiagnosticCheckProducer = async () => {
    const layout = introspection.describeLayout();
    const editorCentered = layout.areas.center.some((id) => id.includes('editor'));
    return editorCentered
      ? result('Layout Integrity', 'pass', layout.prose)
      : result('Layout Integrity', 'fail', 'the editor is missing from the center of the body tree');
  };

  const checkEnablement: IDiagnosticCheckProducer = async () => {
    const disabled = introspection.describeTools().filter((t) => !t.enabled);
    return result(
      'Tool Enablement', 'pass',
      disabled.length === 0
        ? 'all tools enabled'
        : `disabled by choice: ${disabled.map((t) => t.id).join(', ')}`,
    );
  };

  return [checkToolHealth, checkKeybindingConflicts, checkLayoutIntegrity, checkEnablement];
}
