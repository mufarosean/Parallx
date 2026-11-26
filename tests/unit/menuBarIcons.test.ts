// The Tools menu entry of a running tool takes the icon its own sidebar row shows.
import { describe, it, expect, afterEach } from 'vitest';
import { toolMenuIcon } from '../../src/workbench/menuBuilder';
import { registerIcon, unregisterIcon } from '../../src/ui/iconRegistry';

describe('toolMenuIcon', () => {
  afterEach(() => { unregisterIcon('probe-tool-own'); });

  it('takes the container icon first, then a view icon', () => {
    expect(toolMenuIcon({ viewContainers: [{ icon: 'calendar' }], views: [{ icon: 'search' }] })).toBe('calendar');
    expect(toolMenuIcon({ viewContainers: [{}], views: [{ icon: 'search' }] })).toBe('search');
  });

  it('takes an icon the tool registered itself', () => {
    registerIcon('probe-tool-own', '<svg></svg>');
    expect(toolMenuIcon({ viewContainers: [{ icon: 'probe-tool-own' }] })).toBe('probe-tool-own');
  });

  it('falls back to the mark for any tool when the manifest names none the registry knows', () => {
    expect(toolMenuIcon(undefined)).toBe('puzzle');
    expect(toolMenuIcon({ viewContainers: [{ icon: 'not-a-registered-icon' }] })).toBe('puzzle');
  });
});
