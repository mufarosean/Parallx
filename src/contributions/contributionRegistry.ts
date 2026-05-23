// contributionRegistry.ts — unified orchestrator for contribution processors (M81 Slice B)
//
// Wraps the four existing contribution processors (command, keybinding, menu,
// view) behind a single entry point so the workbench has one site for
// `processContributions(toolDescription)` and `removeContributions(toolId)`
// instead of fanning out at three different call-sites in workbench.ts.
//
// Error isolation: per the audit's Landmine #1, one processor throwing must
// not block the others. Each per-processor call is wrapped in try/catch and
// the error is logged via console.error (matching the rest of the contribution
// code's logging style) so the remaining processors still run.
//
// The four processors themselves are unchanged; this class composes them.
//
// See `docs/Parallx_Milestone_81.md` §4 and the audit at
// `docs/research/M81_SLICE_B_AUDIT.md`.

import { Disposable } from '../platform/lifecycle.js';
import type { CommandContributionProcessor } from './commandContribution.js';
import type { KeybindingContributionProcessor } from './keybindingContribution.js';
import type { MenuContributionProcessor } from './menuContribution.js';
import type { ViewContributionProcessor } from './viewContribution.js';
import type { ChatParticipantContributionProcessor } from './chatParticipantContribution.js';
import type { CanvasBlockTypeContributionProcessor } from './canvasBlockTypeContribution.js';
import type { IContributionRegistry } from './contributionTypes.js';
import type { IToolDescription } from '../tools/toolManifest.js';

export class ContributionRegistry extends Disposable implements IContributionRegistry {
  constructor(
    private readonly _commandContribution: CommandContributionProcessor,
    private readonly _keybindingContribution: KeybindingContributionProcessor,
    private readonly _menuContribution: MenuContributionProcessor,
    private readonly _viewContribution: ViewContributionProcessor,
    /** M82 Slice B — optional; passed in only on the live workbench path. */
    private readonly _chatParticipantContribution?: ChatParticipantContributionProcessor,
    /** M82 Slice A — optional; passed in only on the live workbench path. */
    private readonly _canvasBlockTypeContribution?: CanvasBlockTypeContributionProcessor,
  ) {
    super();
  }

  /**
   * Fan out a tool's contributions to every processor in registration order
   * (command → keybinding → menu → view → chat-participant). Errors in one
   * processor are logged and swallowed so the remaining processors still run.
   */
  processContributions(description: IToolDescription): void {
    if (this.isDisposed) {
      return;
    }
    const toolId = description.manifest.id;
    try {
      this._commandContribution.processContributions(description);
    } catch (err) {
      console.error('[ContributionRegistry] command processContributions failed for tool', toolId, err);
    }
    try {
      this._keybindingContribution.processContributions(description);
    } catch (err) {
      console.error('[ContributionRegistry] keybinding processContributions failed for tool', toolId, err);
    }
    try {
      this._menuContribution.processContributions(description);
    } catch (err) {
      console.error('[ContributionRegistry] menu processContributions failed for tool', toolId, err);
    }
    try {
      this._viewContribution.processContributions(description);
    } catch (err) {
      console.error('[ContributionRegistry] view processContributions failed for tool', toolId, err);
    }
    if (this._chatParticipantContribution) {
      try {
        this._chatParticipantContribution.processContributions(description);
      } catch (err) {
        console.error('[ContributionRegistry] chat-participant processContributions failed for tool', toolId, err);
      }
    }
    if (this._canvasBlockTypeContribution) {
      try {
        this._canvasBlockTypeContribution.processContributions(description);
      } catch (err) {
        console.error('[ContributionRegistry] canvas-block-type processContributions failed for tool', toolId, err);
      }
    }
  }

  /**
   * Remove every contribution category for a tool in registration order
   * (command → keybinding → menu → view → chat-participant). Same error
   * isolation as `processContributions`.
   */
  removeContributions(toolId: string): void {
    if (this.isDisposed) {
      return;
    }
    try {
      this._commandContribution.removeContributions(toolId);
    } catch (err) {
      console.error('[ContributionRegistry] command removeContributions failed for tool', toolId, err);
    }
    try {
      this._keybindingContribution.removeContributions(toolId);
    } catch (err) {
      console.error('[ContributionRegistry] keybinding removeContributions failed for tool', toolId, err);
    }
    try {
      this._menuContribution.removeContributions(toolId);
    } catch (err) {
      console.error('[ContributionRegistry] menu removeContributions failed for tool', toolId, err);
    }
    try {
      this._viewContribution.removeContributions(toolId);
    } catch (err) {
      console.error('[ContributionRegistry] view removeContributions failed for tool', toolId, err);
    }
    if (this._chatParticipantContribution) {
      try {
        this._chatParticipantContribution.removeContributions(toolId);
      } catch (err) {
        console.error('[ContributionRegistry] chat-participant removeContributions failed for tool', toolId, err);
      }
    }
    if (this._canvasBlockTypeContribution) {
      try {
        this._canvasBlockTypeContribution.removeContributions(toolId);
      } catch (err) {
        console.error('[ContributionRegistry] canvas-block-type removeContributions failed for tool', toolId, err);
      }
    }
  }
}
