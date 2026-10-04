// @vitest-environment jsdom
// The dashboard's "Daily At" / "Weekdays At" schedule fires at the time the
// user picked, in the app's Time Zone. It used to write UTC fields that the
// scheduler then read as local: "Daily At 7:00" refreshed at noon in Chicago.
import { describe, it, expect, afterEach } from 'vitest';
import { dailyTimeToCron, cronToDailyTime } from '../../src/built-in/dashboard/dashboardEditorProvider';
import { computeNextRun } from '../../src/openclaw/openclawCronService';
import { setAssistantTimeZone, appDateParts } from '../../src/services/localTime';

afterEach(() => setAssistantTimeZone(''));

describe('dashboard refresh schedule times', () => {
  for (const zone of ['America/Chicago', 'Asia/Kolkata', 'Pacific/Auckland']) {
    it(`"Daily At 07:00" fires at 07:00 in ${zone}`, () => {
      setAssistantTimeZone(zone);
      const cron = dailyTimeToCron('07:00', false);
      expect(cron).toBe('0 7 * * *');
      const from = Date.UTC(2026, 9, 4, 15, 0);
      const next = computeNextRun({ cron }, from)!;
      const p = appDateParts(next);
      expect([p.hour, p.minute]).toEqual([7, 0]);
      expect(next).toBeGreaterThan(from);
      expect(next - from).toBeLessThanOrEqual(24 * 3_600_000);
    });
  }

  it('reads back what it wrote, weekdays included, and leaves other crons alone', () => {
    expect(cronToDailyTime(dailyTimeToCron('18:30', true))).toEqual({ time: '18:30', weekdaysOnly: true });
    expect(cronToDailyTime(dailyTimeToCron('07:05', false))).toEqual({ time: '07:05', weekdaysOnly: false });
    expect(cronToDailyTime('*/15 * * * *')).toBeNull();
    expect(dailyTimeToCron('', false)).toBe('0 7 * * *');
  });
});
