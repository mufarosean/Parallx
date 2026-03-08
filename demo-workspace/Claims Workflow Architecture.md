# Claims Workflow Architecture

This internal architecture brief explains how Great Lakes Mutual routes a claim from first notice of loss through repair, total loss review, settlement, and policy follow-up. It is intentionally structured like a long operations document with matrices, section hierarchy, and implementation snippets so workflow questions can be answered from the correct local section instead of generic policy summaries.

## 1. Operating Goals

- Keep every claim local-first and evidence-driven.
- Route high-severity cases to the correct team within one business day.
- Preserve a clear handoff between intake, severity review, valuation, and settlement.
- Build every escalation packet from the same required evidence set.

## 2. Intake And Severity Routing

### 2.1 Triage Principles

Intake starts with the first notice of loss. The intake agent classifies whether the event is a simple repairable claim, a possible total loss, a bodily injury escalation, or a fraud-sensitive investigation. The main routing rule is to send a case to the most specific team that can make the next irreversible decision without creating rework.

### 2.2 Severity Routing Matrix

| Scenario | Initial Triage Owner | Escalation Packet Coordinator | Review Start Target | Notes |
| --- | --- | --- | --- | --- |
| Repairable collision | Standard Claims Adjuster | Repair Network Desk | After shop inspection | Use repair estimate and photo set |
| Potential total loss | Claims Severity Desk | Severity Desk Coordinator | Within 1 business day | Requires valuation, photos, police report |
| Bodily injury escalation | Injury Specialist | Injury Intake Lead | Same business day | Include medical contact details |
| Fraud-sensitive referral | Special Investigations Unit | SIU Intake Analyst | Within 1 business day | Preserve statement timeline |

### 2.3 Total Loss Review Trigger

A potential total loss is declared when early field evidence suggests the repair cost plus salvage uncertainty may exceed the current cash value decision band. The Severity Desk does not finalize total loss status at intake; it starts a structured review, opens the valuation workflow, and requests the escalation packet immediately.

## 3. Escalation Packet Content

The escalation packet is the evidence bundle used by the Severity Desk before valuation review is allowed to proceed. Every potential total loss packet must contain:

1. policy summary and active coverages,
2. current valuation worksheet,
3. scene photos and damage photos,
4. police report or incident number,
5. repair estimate if available,
6. claimant contact confirmation.

### 3.1 Packet Ownership

The Severity Desk Coordinator is responsible for packet completeness. The coordinator does not author the valuation result, but they confirm the packet is assembled, the valuation worksheet is current, and the missing-evidence list is closed before review begins.

### 3.2 Escalation Packet Builder Snippet

```ts
export function buildEscalationPacket() {
  return {
    stages: [
      'policy-summary',
      'valuation',
      'photos',
      'police-report',
      'repair-estimate',
      'claimant-contact',
    ],
    owner: 'Severity Desk Coordinator',
    reviewStartTarget: 'within 1 business day',
  };
}

export class SeverityDeskCoordinator {
  readonly team = 'Claims Severity Desk';

  confirmPacketReady(packet: { stages: string[] }): boolean {
    return packet.stages.includes('valuation') && packet.stages.includes('photos');
  }
}
```

## 4. Valuation And Settlement Path

### 4.1 Valuation Workflow

Once the escalation packet is complete, the valuation specialist checks current market value, optional equipment, prior damage notes, and state handling rules. If the review confirms a likely total loss, the file moves into settlement preparation. If not, the claim returns to the repairable path with the updated estimate and communication notes preserved.

### 4.2 Settlement Communication

Settlement communication must reference the valuation basis, explain any deductible effect, and state whether rental coverage or salvage handling changes the next step. The document set used for customer communication is downstream from the escalation packet and should not be confused with the packet itself.

## 5. Operational Risks

### 5.1 Common Failure Modes

- Starting valuation without a police report on a theft or disputed-liability case.
- Marking a packet complete when the valuation worksheet is stale.
- Sending a repairable claim to severity when only one photo is missing.
- Losing ownership during handoff between the standard adjuster and the severity desk.

### 5.2 Long-Document Retrieval Notes

This document is intentionally dense. Questions about packet ownership, review targets, or helper names should resolve to the exact local section, table row, or code block above rather than drifting into general claims guidance.