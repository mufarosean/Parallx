// toolServiceLifetime.test.ts — a service a built-in tool registers goes
// with the tool: turned off, nothing keeps calling into it (the Planner's
// query service fed heartbeat notices and workflow facts after it was off).

import { describe, it, expect } from 'vitest';
import { ServiceCollection } from '../../src/services/serviceCollection';
import { createServiceIdentifier } from '../../src/platform/types';

describe('services registered by a tool', () => {
  it('are removed when the tool stops, unless something else replaced them', () => {
    const services = new ServiceCollection();
    const id = createServiceIdentifier<{ ping(): string }>('IToolThing');
    const mine = { ping: () => 'a' };
    services.registerInstance(id, mine);
    expect(services.has(id)).toBe(true);
    services.unregisterInstance(id, mine);
    expect(services.has(id)).toBe(false);
    const other = { ping: () => 'b' };
    services.registerInstance(id, other);
    services.unregisterInstance(id, mine); // a stale handle does not remove the new one
    expect(services.get(id)).toBe(other);
  });
});
