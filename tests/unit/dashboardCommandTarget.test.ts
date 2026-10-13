// dashboardCommandTarget.test.ts — a dashboard command reaches the dashboard
// on screen. Panes stay mounted behind other tabs, so with two dashboards
// open, Add Widget used to land on the hidden one (found by the
// refactor-verify probe once it clicked by id instead of through the DOM).

import { describe, it, expect } from 'vitest';
import { activeDashboardEditorId, isForPane } from '../../src/built-in/dashboard/dashboardCommandTarget.js';

const event = (detail?: unknown) => new CustomEvent('parallx.dashboard.addWidget', detail === undefined ? undefined : { detail });

describe('dashboard command target', () => {
  it('names the active editor when it is a dashboard', () => {
    const open = [
      { id: 'parallx.dashboard:dashboard:dash-a', isActive: false },
      { id: 'parallx.dashboard:dashboard:dash-b', isActive: true },
    ];
    expect(activeDashboardEditorId(open)).toBe('parallx.dashboard:dashboard:dash-b');
  });

  it('names nothing when the active editor is not a dashboard', () => {
    expect(activeDashboardEditorId([{ id: 'file:///notes.md', isActive: true }])).toBeUndefined();
    expect(activeDashboardEditorId([])).toBeUndefined();
  });

  it('a named event is for that pane only; an unnamed one for every pane', () => {
    const named = event({ editorId: 'parallx.dashboard:dashboard:dash-b' });
    expect(isForPane(named, 'parallx.dashboard:dashboard:dash-b')).toBe(true);
    expect(isForPane(named, 'parallx.dashboard:dashboard:dash-a')).toBe(false);
    expect(isForPane(event({ editorId: undefined }), 'parallx.dashboard:dashboard:dash-a')).toBe(true);
    expect(isForPane(event(), 'parallx.dashboard:dashboard:dash-a')).toBe(true);
  });
});
