// webResearchWidgets.test.ts — Weather and Market snapshot need Web
// Research's search tools to refresh, so they come with it: the dashboard
// core no longer registers them; their stored type ids keep working.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DashboardBridge, getContributedDashboardWidgetTypes } from '../../src/api/bridges/dashboardBridge';

describe('Weather and Market widgets', () => {
  it('Web Research registers them under their stored ids; no other tool may', async () => {
    const ext: any = await import('../../ext/web-research/main.js');
    const subs: Array<{ dispose(): void }> = [];
    const bridge = new DashboardBridge('parallx.web-research', subs);
    ext.__test__.registerWeatherAndMarketWidgets({ dashboard: { registerWidgetType: (r: any) => bridge.registerWidgetType(r) } });
    const mine = () => getContributedDashboardWidgetTypes().filter((c) => c.ownerToolId === 'parallx.web-research').map((c) => c.registration.typeId);
    expect(mine()).toEqual(expect.arrayContaining(['parallx.dashboard.weather', 'parallx.dashboard.market']));
    const weather = getContributedDashboardWidgetTypes().find((c) => c.registration.typeId === 'parallx.dashboard.weather')!.registration;
    const other = new DashboardBridge('acme.tool', []);
    expect(() => other.registerWidgetType(weather as any)).toThrow();
    bridge.dispose(); // Web Research turned off
    expect(mine()).toEqual([]);
  });

  it('prompts ask for the configured place and symbols and deliver to the widget', async () => {
    const ext: any = await import('../../ext/web-research/main.js');
    const w = ext.__test__.buildWeatherPrompt({ location: 'Harare', units: 'metric', forecastDays: 2 }, 'w1');
    expect(w).toContain('Harare');
    expect(w).toContain('Celsius');
    expect(w).toContain('instanceId "w1"');
    expect(ext.__test__.buildMarketPrompt({ symbols: [] }, 'm1')).toBeNull();
    expect(ext.__test__.buildMarketPrompt({ symbols: ['AAPL'] }, 'm1')).toContain('AAPL');
  });

  it('the dashboard core does not register them', () => {
    const src = readFileSync('src/built-in/dashboard/widgets/builtInWidgets.ts', 'utf8');
    expect(src).not.toMatch(/WEATHER_WIDGET|MARKET_WIDGET/);
  });
});
