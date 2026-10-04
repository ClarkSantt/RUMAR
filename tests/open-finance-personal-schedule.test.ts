import { describe, expect, it } from 'vitest';
import { autoSyncIntervalMs, isAutoSyncDue } from '../src/features/finance/connections/auto-sync';

describe('Open Finance personal scheduler', () => {
  it('supports only the explicit conservative intervals', () => {
    expect(autoSyncIntervalMs('manual')).toBeNull();
    expect(autoSyncIntervalMs('startup')).toBeNull();
    for (const hours of [1, 3, 6, 12, 24] as const) {
      expect(autoSyncIntervalMs(`startup_${hours}h`)).toBe(hours * 60 * 60_000);
    }
  });

  it('checks on startup, then waits for the selected interval unless an update is available', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const recent = '2026-10-03T11:00:00Z';
    const sixHours = autoSyncIntervalMs('startup_6h')!;
    expect(isAutoSyncDue(recent, sixHours, true, false, now)).toBe(true);
    expect(isAutoSyncDue(recent, sixHours, false, false, now)).toBe(false);
    expect(isAutoSyncDue(recent, sixHours, false, true, now)).toBe(true);
    expect(isAutoSyncDue('2026-10-03T05:00:00Z', sixHours, false, false, now)).toBe(true);
    expect(isAutoSyncDue(null, sixHours, true, true, now)).toBe(false);
  });
});
