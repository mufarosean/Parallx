import { describe, it, expect, vi } from 'vitest';
import { createRelatePagesTool } from '../../src/built-in/canvas/ai/relatePagesTool';
import type { ICancellationToken } from '../../src/services/chatTypes';

const TOK = {} as ICancellationToken;

describe('canvas_relate_pages tool', () => {
  it('links the found related pages under the hub and reports success', async () => {
    const relate = vi.fn(async (hub: string, related: readonly string[]) => ({
      hub: 'Q3 Planning',
      linked: [...related],
      missing: [],
    }));
    const tool = createRelatePagesTool(relate);

    const res = await tool.handler({ hub: 'Q3 Planning', related: ['Q3 Budget', 'Q3 Goals'] }, TOK);

    expect(relate).toHaveBeenCalledWith('Q3 Planning', ['Q3 Budget', 'Q3 Goals']);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Nested 2 page(s) under "Q3 Planning"');
    expect(res.content).toContain('Q3 Budget');
    expect(res.content).toContain('Q3 Goals');
  });

  it('reports which related pages could not be found', async () => {
    const relate = async () => ({ hub: 'Q3 Planning', linked: ['Q3 Budget'], missing: ['Q4 Roadmap'] });
    const res = await createRelatePagesTool(relate).handler({ hub: 'Q3 Planning', related: ['Q3 Budget', 'Q4 Roadmap'] }, TOK);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Nested 1 page(s)');
    expect(res.content).toContain('Could not find: Q4 Roadmap');
  });

  it('errors clearly when the hub page does not exist', async () => {
    const relate = async () => ({ hub: undefined, linked: [], missing: ['Q3 Budget'] });
    const res = await createRelatePagesTool(relate).handler({ hub: 'Nope', related: ['Q3 Budget'] }, TOK);
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Hub page "Nope" was not found');
  });

  it('errors when nothing matched under a real hub', async () => {
    const relate = async () => ({ hub: 'Q3 Planning', linked: [], missing: ['X', 'Y'] });
    const res = await createRelatePagesTool(relate).handler({ hub: 'Q3 Planning', related: ['X', 'Y'] }, TOK);
    expect(res.isError).toBe(true);
    expect(res.content).toContain('none of the related titles matched');
  });

  it('rejects bad input without calling the data service', async () => {
    const relate = vi.fn(async () => ({ hub: 'h', linked: [], missing: [] }));
    const tool = createRelatePagesTool(relate);
    const noHub = await tool.handler({ related: ['A'] }, TOK);
    const noRelated = await tool.handler({ hub: 'Q3 Planning', related: [] }, TOK);
    expect(noHub.isError).toBe(true);
    expect(noRelated.isError).toBe(true);
    expect(relate).not.toHaveBeenCalled();
  });

  it('is gated (requires approval) since it restructures the workspace', () => {
    const tool = createRelatePagesTool(async () => ({ hub: 'h', linked: [], missing: [] }));
    expect(tool.requiresConfirmation).toBe(true);
    expect(tool.permissionLevel).toBe('requires-approval');
    expect(tool.name).toBe('canvas_relate_pages');
  });
});
