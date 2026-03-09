import { describe, expect, it } from 'vitest';
import {
  classifyPageBlockDropZone,
  getPageBlockDropThresholds,
} from '../../src/built-in/canvas/config/blockStateRegistry/pageBlockDropRouting';

describe('pageBlockDropRouting', () => {
  it('uses the existing wide-card thresholds', () => {
    expect(getPageBlockDropThresholds({ left: 0, top: 0, width: 200, height: 80 })).toEqual({
      horizontalEdge: 50,
      verticalEdge: 20,
    });
  });

  it('uses the existing narrow-card thresholds', () => {
    expect(getPageBlockDropThresholds({ left: 10, top: 20, width: 100, height: 20 })).toEqual({
      horizontalEdge: 20,
      verticalEdge: 8,
    });
  });

  it('treats the center of a wide card as an interior cross-page drop zone', () => {
    expect(classifyPageBlockDropZone({ left: 100, top: 50, width: 200, height: 80 }, 200, 90)).toBe('interior');
  });

  it('treats all four edge strips of a wide card as edge zones', () => {
    const rect = { left: 100, top: 50, width: 200, height: 80 };
    expect(classifyPageBlockDropZone(rect, 149, 90)).toBe('edge');
    expect(classifyPageBlockDropZone(rect, 251, 90)).toBe('edge');
    expect(classifyPageBlockDropZone(rect, 200, 69)).toBe('edge');
    expect(classifyPageBlockDropZone(rect, 200, 131)).toBe('edge');
  });

  it('preserves the current inclusive boundary behavior at the threshold lines', () => {
    const rect = { left: 100, top: 50, width: 200, height: 80 };
    expect(classifyPageBlockDropZone(rect, 150, 90)).toBe('interior');
    expect(classifyPageBlockDropZone(rect, 250, 90)).toBe('interior');
    expect(classifyPageBlockDropZone(rect, 200, 70)).toBe('interior');
    expect(classifyPageBlockDropZone(rect, 200, 110)).toBe('interior');
  });
});