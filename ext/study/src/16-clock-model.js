// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: THE SESSION CLOCK — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// A session's seconds are time with its tab showing and the person at the
// desk. The clock cannot tell reading from a break: it sees only input (a
// key, a click, a tap, a scroll). So it counts while the tab is showing and
// the last input is less than ten minutes old, and when ten minutes pass
// with none it takes the whole stretch since that input back, once: a break
// with the tab up counts for nothing, and an hour left open writes no hour
// to the Work Log. This is the rule of Worksheets' study clock, written
// here again because an extension shares no code with a built-in tool. Time
// is the wall time between two looks, capped, never a count of looks.
// 60-pane.js runs it; this part has no timer, no DOM and no clock of its own.

/** Ten minutes without input: where a stretch stops being study. */
const ST_CLOCK_IDLE_MS = 10 * 60 * 1000;
/** The most one look may count: a machine asleep, or a stalled tab, does not count its nap. */
const ST_CLOCK_LOOK_MS = 5000;

/** A clock that starts at `now`; `inputAt` is when he last touched the app. */
function stClockState(now, inputAt = now) {
  return { at: now, inputSeen: inputAt, stretchMs: 0, idle: false };
}

/**
 * One look at the clock. Returns the milliseconds to add to the session:
 * above zero while its tab is `showing` and he is there, below zero once
 * when the stretch since his last input is found idle (what it counted comes
 * back), zero otherwise. `inputAt` is when he last touched the app.
 */
function stClockAdvance(state, now, showing, inputAt, idleMs = ST_CLOCK_IDLE_MS) {
  const passed = Math.min(ST_CLOCK_LOOK_MS, Math.max(0, now - state.at));
  state.at = now;
  if (inputAt > state.inputSeen) {
    // He is back, or still here: a new stretch starts at this input. What passed up to it belongs to the stretch
    // before, which stands (nothing, when that one had gone idle).
    const wasIdle = state.idle;
    state.inputSeen = inputAt;
    state.stretchMs = 0;
    state.idle = false;
    return showing && !wasIdle ? passed : 0;
  }
  if (state.idle) return 0;
  if (now - inputAt >= idleMs) {
    state.idle = true;
    const back = state.stretchMs;
    state.stretchMs = 0;
    return back ? -back : 0;
  }
  if (!showing) return 0;
  state.stretchMs += passed;
  return passed;
}
