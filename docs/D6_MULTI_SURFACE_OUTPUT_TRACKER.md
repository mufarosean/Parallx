# D6 — Multi-Surface Output: Domain Tracker

## Status: CLOSED ✅

## Key Files
| File | Role |
|------|------|
| `src/openclaw/openclawSurfacePlugin.ts` | ISurfacePlugin, SurfaceRouter, delivery pipeline |
| `tests/unit/openclawSurfacePlugin.test.ts` | 33 tests |

## Upstream References
| Upstream File | Lines | Parallx Mapping |
|---------------|-------|-----------------|
| `src/channels/` (ChannelPlugin) | Interface pattern | ISurfacePlugin (desktop adaptation) |
| message-tool | Routing + delivery | SurfaceRouter.send/broadcast |
| Delivery queue | ack/fail/retry | _deliverWithRetry + backoff |

## Scorecard

| Capability | Iteration 0 | Iteration 1 | Final |
|------------|------------|------------|-------|
| D6.1 ISurfacePlugin interface | ALIGNED | ALIGNED | ✅ |
| D6.2 SurfaceRouter class | ALIGNED | ALIGNED | ✅ |
| D6.3 Surface registration | ALIGNED | ALIGNED | ✅ |
| D6.4 Delivery with retry | MISALIGNED | ALIGNED (backoff + permanent error) | ✅ |
| D6.5 Content type filtering | ALIGNED | ALIGNED | ✅ |
| D6.6 Broadcast | ALIGNED | ALIGNED | ✅ |
| D6.7 Delivery history | ALIGNED | ALIGNED | ✅ |
| D6.8 Well-known surface IDs | ALIGNED | ALIGNED | ✅ |
| D6.9 ISurfaceDelivery interface | ALIGNED | ALIGNED | ✅ |
| D6.10 Disposal & cleanup | ALIGNED | ALIGNED | ✅ |
| D6.11 Constants | ALIGNED | ALIGNED (+DELIVERY_BACKOFF_MS) | ✅ |
| D6.12 Test coverage | ALIGNED | ALIGNED (33 tests) | ✅ |
| D6.13 No anti-patterns | ALIGNED | ALIGNED | ✅ |

**Final: 13/13 ALIGNED**

---

## Iteration 1

### Audit Findings
- **D6.4 (MEDIUM)**: Uniform retry with no backoff. Upstream uses exponential backoff + permanent error detection.

### Changes Made
1. **Backoff schedule**: DELIVERY_BACKOFF_MS = [100, 500, 2000] — 50× shorter than upstream, appropriate for desktop
2. **Permanent error detection**: isPermanentDeliveryError() checks for "not supported" / "not available"
3. **Retry rewrite**: _deliverWithRetry() now applies indexed backoff delays, short-circuits on permanent errors
4. **7 new tests**: Backoff timing, permanent error short-circuit, transient retry, isPermanentDeliveryError classification

### Verification
- **Tests**: 137 files, 2638 tests, 0 failures
- **TypeScript**: 0 errors
- **Cross-domain**: D1 + D2 + D3 + D4 + D5 tests still pass
- **UX Guardian**: 6/6 surfaces OK

### Decision
All 13 capabilities ALIGNED. **CLOSED.**
