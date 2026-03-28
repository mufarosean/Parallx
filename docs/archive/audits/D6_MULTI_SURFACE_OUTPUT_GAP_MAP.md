# D6 Multi-Surface Output — Gap Map

**Date:** 2026-03-28
**Mapper:** Gap Mapper (Claude Opus 4.6)
**Audit:** `docs/D6_MULTI_SURFACE_OUTPUT_AUDIT.md`
**Domain:** D6 — Multi-Surface Output
**Gap count:** 1 (D6.4 MISALIGNED)

---

## Change Plan: D6 — Multi-Surface Output

### D6.4: Delivery Retry — Exponential Backoff + Permanent Error Detection

- **Status**: MISALIGNED → ALIGNED
- **Upstream**: `src/infra/outbound/delivery-queue-recovery.ts`, backoff schedule `BACKOFF_MS = [5_000, 25_000, 120_000, ...]`, `isPermanentDeliveryError()` for early termination, `MAX_RETRIES=5`
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts`
- **Test file**: `tests/unit/openclawSurfacePlugin.test.ts`

#### Current State

`_deliverWithRetry()` (lines 310-360) loops `0..MAX_DELIVERY_RETRIES` with:
- No delay between attempts (uniform, immediate retry)
- No error classification — every error is treated identically
- All retries are exhausted even for permanent/unrecoverable errors

```typescript
// Current — no backoff, no error classification
for (let attempt = 0; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
  try {
    const success = await surface.deliver(current);
    // ...
  } catch (err) {
    // treats all errors the same
  }
}
```

#### Action

**Step 1 — Add backoff schedule constant** (in constants block, after line 32)

Add a desktop-appropriate backoff schedule:

```typescript
/** Backoff delays (ms) between delivery retries. Desktop-adapted from upstream [5s, 25s, 2m]. */
export const DELIVERY_BACKOFF_MS: readonly number[] = [100, 500, 2000];
```

Rationale: Upstream uses `[5_000, 25_000, 120_000]` for network channels. Desktop surfaces are local, so delays can be 50× shorter while preserving the exponential growth pattern.

**Step 2 — Add permanent error detection** (new helper, after the `isContentSupported` helper)

```typescript
/**
 * Detect permanent delivery errors that should not be retried.
 * Upstream: isPermanentDeliveryError() in delivery-queue-recovery.ts
 */
export function isPermanentDeliveryError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return lower.includes('not supported') || lower.includes('not available');
}
```

Rationale: Upstream classifies errors as permanent vs. transient to avoid wasting retries. For desktop surfaces, "not supported" (capability mismatch that persists) and "not available" (surface removed/disabled) are the two permanent conditions.

**Step 3 — Rewrite `_deliverWithRetry()` to use backoff + error classification**

Replace the inner loop with:

```typescript
private async _deliverWithRetry(
  delivery: ISurfaceDelivery,
  surface: ISurfacePlugin,
): Promise<IDeliveryResult> {
  let current = delivery;

  for (let attempt = 0; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
    try {
      const success = await surface.deliver(current);

      if (success) {
        const delivered: ISurfaceDelivery = {
          ...current,
          status: 'delivered',
          retries: attempt,
        };
        this._deliveryHistory.push(delivered);
        return {
          deliveryId: delivered.id,
          surfaceId: delivered.surfaceId,
          status: 'delivered',
          error: null,
        };
      }

      // Surface returned false — treat as soft failure, apply backoff before next attempt
      current = { ...current, retries: attempt + 1 };

    } catch (err) {
      // Permanent errors: stop immediately, don't waste remaining retries
      if (isPermanentDeliveryError(err)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failed: ISurfaceDelivery = { ...current, status: 'failed', error: errorMsg };
        this._deliveryHistory.push(failed);
        if (this._deliveryHistory.length > MAX_DELIVERY_QUEUE_SIZE) {
          this._deliveryHistory.splice(0, this._deliveryHistory.length - MAX_DELIVERY_QUEUE_SIZE);
        }
        return {
          deliveryId: failed.id,
          surfaceId: failed.surfaceId,
          status: 'failed',
          error: errorMsg,
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      current = { ...current, retries: attempt + 1, error: errorMsg };
    }

    // Exponential backoff before next attempt (skip delay after last attempt)
    if (attempt < MAX_DELIVERY_RETRIES) {
      const delayMs = DELIVERY_BACKOFF_MS[Math.min(attempt, DELIVERY_BACKOFF_MS.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  const failed: ISurfaceDelivery = { ...current, status: 'failed' };
  this._deliveryHistory.push(failed);
  if (this._deliveryHistory.length > MAX_DELIVERY_QUEUE_SIZE) {
    this._deliveryHistory.splice(0, this._deliveryHistory.length - MAX_DELIVERY_QUEUE_SIZE);
  }
  return {
    deliveryId: failed.id,
    surfaceId: failed.surfaceId,
    status: 'failed',
    error: failed.error ?? 'Delivery failed after max retries',
  };
}
```

Key structural changes:
1. After each failed attempt (both soft-failure and exception), apply `DELIVERY_BACKOFF_MS[attempt]` delay
2. On permanent error (`isPermanentDeliveryError`), immediately record failure and return — no more retries
3. Backoff index clamps to last element if retries exceed schedule length

#### What to Remove

- The current uniform retry loop body (no delay between attempts) — replaced entirely by the backoff version
- No other code needs removal; this is a contained change within `_deliverWithRetry()`

#### Test Updates

**New exports to import in test file:**
- `DELIVERY_BACKOFF_MS`
- `isPermanentDeliveryError`

**New test cases (add to `retry logic` describe block):**

1. **`applies backoff delay between retries`** — Mock `surface.deliver` to fail twice then succeed. Use `vi.useFakeTimers()` to verify delays of 100ms and 500ms are applied (the first two entries of `DELIVERY_BACKOFF_MS`).

2. **`short-circuits on permanent error`** — Mock `surface.deliver` to throw `new Error('content type not supported')`. Verify `deliver` is called exactly once (no retries). Verify result is `failed`.

3. **`retries on transient error but not permanent`** — Mock `surface.deliver` to throw transient error first, then permanent error. Verify exactly 2 calls.

**Existing tests that should still pass unchanged:**
- `retries on delivery failure` — still works, but will now have backoff delay (use fake timers or accept small real delay)
- `retries on delivery exception` — same
- `fails after max retries exhausted` — same
- `records failed delivery in history` — same

**Test for `isPermanentDeliveryError` helper:**

```typescript
describe('isPermanentDeliveryError', () => {
  it('detects "not supported" as permanent', () => {
    expect(isPermanentDeliveryError(new Error('content type not supported'))).toBe(true);
  });
  it('detects "not available" as permanent', () => {
    expect(isPermanentDeliveryError(new Error('Surface not available'))).toBe(true);
  });
  it('treats transient errors as non-permanent', () => {
    expect(isPermanentDeliveryError(new Error('timeout'))).toBe(false);
    expect(isPermanentDeliveryError(new Error('connection reset'))).toBe(false);
  });
});
```

#### Verify

1. `npx vitest run tests/unit/openclawSurfacePlugin.test.ts` — all existing + new tests pass
2. `npx tsc --noEmit` — zero errors
3. Manual check: `DELIVERY_BACKOFF_MS` is exported and used in `_deliverWithRetry()`
4. Manual check: `isPermanentDeliveryError` is exported and used in the catch block
5. Confirm no other file imports or calls `_deliverWithRetry` (it's private — contained change)

#### Risk

- **Low**: Introducing async delays in retry changes timing behavior. Existing retry tests that don't use fake timers will take ~600ms longer (100+500ms backoff). Solution: use `vi.useFakeTimers()` in retry tests, or accept the small real delay since values are desktop-short.
- **Low**: `isPermanentDeliveryError` string matching is simple heuristic. If a surface throws an error containing "not supported" in a different context, it would incorrectly short-circuit. Acceptable for now — desktop surfaces have controlled error messages.
- **None**: Write-ahead persistence is explicitly N/A for desktop (documented in audit). Not implementing it is correct.

---

## Disposition Summary

| Capability | Current | Target | Action |
|-----------|---------|--------|--------|
| D6.4 Delivery Retry | MISALIGNED | ALIGNED | Add `DELIVERY_BACKOFF_MS` schedule, `isPermanentDeliveryError()` helper, rewrite `_deliverWithRetry()` to use both |

## Unchanged Capabilities (11 ALIGNED + 1 N/A)

| Capability | Status | Notes |
|-----------|--------|-------|
| D6.1 ISurfacePlugin Interface | ALIGNED | Intentional simplification |
| D6.2 SurfaceRouter Class | ALIGNED | Map-based lookup appropriate |
| D6.3 Surface Registration | ALIGNED | Programmatic registration |
| D6.5 Content Type Filtering | ALIGNED | Domain-appropriate dimensions |
| D6.6 Broadcast | ALIGNED | Parallx-specific enhancement |
| D6.7 Delivery History | ALIGNED | In-memory bounded array |
| D6.8 Well-Known Surface IDs | ALIGNED | Desktop surfaces |
| D6.9 ISurfaceDelivery Interface | ALIGNED | Self-contained record |
| D6.10 Disposal & Cleanup | ALIGNED | IDisposable pattern |
| D6.11 Constants | ALIGNED | Desktop-appropriate values |
| D6.12 Test Coverage | ALIGNED | 26 tests passing |
| D6.13 No Anti-Patterns | ALIGNED | Clean implementation |

---

## Platform Adaptation Notes

| Upstream Pattern | Parallx Adaptation | Reason |
|-----------------|-------------------|--------|
| `BACKOFF_MS = [5s, 25s, 2m, ...]` | `DELIVERY_BACKOFF_MS = [100ms, 500ms, 2000ms]` | Desktop surfaces are local — sub-second to low-second delays sufficient |
| `isPermanentDeliveryError()` complex classification | Simple string match on "not supported" / "not available" | Desktop surfaces have controlled, predictable error messages |
| Write-ahead persistence + crash recovery | Not implemented (N/A) | Single-process desktop app, no daemon restart scenario |
| `MAX_RETRIES = 5` | `MAX_DELIVERY_RETRIES = 3` | Fewer retries needed for local surfaces (already aligned per D6.11) |
