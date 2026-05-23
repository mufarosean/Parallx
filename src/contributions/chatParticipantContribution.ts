// chatParticipantContribution.ts — contributes.chat.participants processor (M82 Slice B)
//
// Processes `contributes.chat.participants[]` from tool manifests.
//
// For each declared participant, registers a stub `IChatParticipant` with the
// `IChatAgentService` whose handler is a proxy. The proxy:
//   1. Returns a "Loading…" message and warns through the response stream
//      until the contributing extension wires the real handler.
//
// The contributing extension wires the real handler in its `activate()` by
// calling `api.chat.registerParticipant({ id, ..., handler })`. The chat
// bridge looks up the manifest stub by id; if present it calls
// `wireRealHandler(id, handler)` on this processor to swap the proxy out
// in-place. If no stub exists (extension uses the imperative path without
// a manifest entry) the bridge falls back to direct `registerAgent`.
//
// Pattern is the chat-participant equivalent of the M2
// `CommandContributionProcessor` proxy → real-handler swap (M2 audit
// `docs/research/M81_SLICE_B_AUDIT.md`). See also M82 plan §10 Slice B and
// the contribution audit `docs/research/M82_CONTRIBUTION_AUDIT.md` Q3.

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import type { IToolDescription, IManifestChatParticipant } from '../tools/toolManifest.js';
import type {
  IChatAgentService,
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantResult,
} from '../services/chatTypes.js';
import type { IContributionProcessor } from './contributionTypes.js';

interface IContributedParticipant {
  readonly participantId: string;
  readonly toolId: string;
  readonly definition: IManifestChatParticipant;
  readonly registration: IDisposable;
  /** Wired real handler (undefined until extension calls registerParticipant). */
  realHandler: IChatParticipantHandler | undefined;
}

/**
 * Processes `contributes.chat.participants` from tool manifests.
 *
 * One owner per participant id. Registration is rejected (with a warning) if
 * the id is already taken — either by a built-in participant such as
 * `parallx.chat.default`, or by another manifest entry.
 */
export class ChatParticipantContributionProcessor extends Disposable implements IContributionProcessor {

  private readonly _contributed = new Map<string, IContributedParticipant>();

  private readonly _onDidRegisterParticipant = this._register(new Emitter<{ toolId: string; participantId: string }>());
  readonly onDidRegisterParticipant: Event<{ toolId: string; participantId: string }> = this._onDidRegisterParticipant.event;

  private readonly _onDidRemoveParticipant = this._register(new Emitter<{ toolId: string; participantId: string }>());
  readonly onDidRemoveParticipant: Event<{ toolId: string; participantId: string }> = this._onDidRemoveParticipant.event;

  constructor(private readonly _agentService: IChatAgentService) {
    super();
  }

  // ── IContributionProcessor ──

  processContributions(toolDescription: IToolDescription): void {
    if (this.isDisposed) return;
    const { manifest } = toolDescription;
    const participants = manifest.contributes?.chat?.participants;
    if (!participants || participants.length === 0) return;

    const toolId = manifest.id;
    for (const def of participants) {
      // Validate required fields
      if (!def?.id || !def?.name) {
        console.warn(
          `[ChatParticipantContribution] Skipping invalid participant in tool "${toolId}":`,
          'missing required field "id" or "name"',
        );
        continue;
      }

      // Reject conflicts
      if (this._contributed.has(def.id)) {
        const owner = this._contributed.get(def.id);
        console.warn(
          `[ChatParticipantContribution] Participant "${def.id}" already contributed by`,
          `"${owner?.toolId}" — skipping registration from "${toolId}"`,
        );
        continue;
      }
      if (this._agentService.getAgent(def.id)) {
        console.warn(
          `[ChatParticipantContribution] Participant "${def.id}" is already registered with the agent service`,
          `(possibly a built-in) — skipping registration from "${toolId}"`,
        );
        continue;
      }

      const participant = this._buildStubParticipant(def);
      let registration: IDisposable;
      try {
        registration = this._agentService.registerAgent(participant);
      } catch (err) {
        console.error(
          `[ChatParticipantContribution] registerAgent failed for "${def.id}" from "${toolId}":`,
          err,
        );
        continue;
      }

      const record: IContributedParticipant = {
        participantId: def.id,
        toolId,
        definition: def,
        registration,
        realHandler: undefined,
      };
      this._contributed.set(def.id, record);
      this._onDidRegisterParticipant.fire({ toolId, participantId: def.id });
      console.log(`[ChatParticipantContribution] registered ${def.id} from ${toolId}`);
    }
  }

  removeContributions(toolId: string): void {
    if (this.isDisposed) return;
    const removed: string[] = [];
    for (const [id, record] of this._contributed) {
      if (record.toolId !== toolId) continue;
      try {
        record.registration.dispose();
      } catch (err) {
        console.error(
          `[ChatParticipantContribution] dispose failed for "${id}" from "${toolId}":`,
          err,
        );
      }
      this._contributed.delete(id);
      this._onDidRemoveParticipant.fire({ toolId, participantId: id });
      removed.push(id);
    }
    if (removed.length > 0) {
      console.log(
        `[ChatParticipantContribution] removed ${removed.length} participant(s) from ${toolId}:`,
        removed.join(', '),
      );
    }
  }

  // ── Real-handler wiring ──

  /**
   * Called by the chat bridge when an extension wires the real handler for a
   * participant declared in its manifest. Returns true if a matching stub was
   * found (and the handler swapped in); false if no manifest stub exists for
   * `participantId`, in which case the caller should fall back to direct
   * `IChatAgentService.registerAgent` (the imperative-only path).
   */
  wireRealHandler(participantId: string, handler: IChatParticipantHandler): boolean {
    const record = this._contributed.get(participantId);
    if (!record) return false;
    record.realHandler = handler;
    return true;
  }

  /** Returns true if `participantId` was declared in some manifest. */
  hasContributed(participantId: string): boolean {
    return this._contributed.has(participantId);
  }

  /** Returns the owning tool id for a contributed participant, or undefined. */
  getOwnerToolId(participantId: string): string | undefined {
    return this._contributed.get(participantId)?.toolId;
  }

  /** Enumerate all contributed participant ids. Test/debugging only. */
  getContributedIds(): readonly string[] {
    return [...this._contributed.keys()];
  }

  // ── Internal ──

  private _buildStubParticipant(def: IManifestChatParticipant): IChatParticipant {
    const participantId = def.id;
    const displayName = def.fullName ?? def.name;
    const description = def.description ?? '';
    const stubHandler: IChatParticipantHandler = async (
      _request,
      _context,
      response,
      _token,
    ): Promise<IChatParticipantResult> => {
      const record = this._contributed.get(participantId);
      const real = record?.realHandler;
      if (real) {
        return real(_request, _context, response, _token);
      }
      const msg =
        `Participant "${participantId}" is not yet active. ` +
        'Its contributing extension has not called api.chat.registerParticipant().';
      try { response.warning(msg); } catch { /* stream may be closed */ }
      return { errorDetails: { message: msg, responseIsIncomplete: true } };
    };

    return {
      id: participantId,
      surface: 'bridge',
      displayName,
      description,
      commands: def.commands?.map((c) => ({ name: c.name, description: c.description ?? '' })) ?? [],
      handler: stubHandler,
    };
  }
}
