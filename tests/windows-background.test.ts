// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const checks = vi.hoisted(() => ({
  automations: vi.fn(),
  notifications: vi.fn(),
  google: vi.fn(),
}));
vi.mock('../src/features/automations/runtime', () => ({ checkAutomations: checks.automations }));
vi.mock('../src/features/notifications/scheduler', () => ({
  checkLocalNotifications: checks.notifications,
}));
vi.mock('../src/features/integrations/google-calendar/runtime', () => ({
  syncGoogleCalendar: checks.google,
}));
vi.mock('../src/features/windows/preferences', () => ({
  loadWindowsPreferences: async () => ({ backgroundNotifications: false }),
}));
import { setWindowInTray, startBackgroundScheduler } from '../src/features/windows/background';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  setWindowInTray(false);
});

it('mantém automações no tray e respeita notificações em background desativadas', async () => {
  vi.useFakeTimers();
  checks.google.mockResolvedValue(undefined);
  setWindowInTray(true);
  const stop = startBackgroundScheduler(() => {});
  await vi.advanceTimersByTimeAsync(1500);
  expect(checks.automations).toHaveBeenCalledOnce();
  expect(checks.notifications).not.toHaveBeenCalled();
  stop();
});

it('mantém um único wake-up em segundo plano e encerra todos os jobs ao sair', async () => {
  vi.useFakeTimers();
  checks.google.mockResolvedValue(undefined);
  const stop = startBackgroundScheduler(() => {});
  await vi.advanceTimersByTimeAsync(1500);
  expect(checks.automations).toHaveBeenCalledOnce();
  expect(checks.notifications).toHaveBeenCalledOnce();
  expect(checks.google).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(checks.automations).toHaveBeenCalledTimes(2);
  expect(checks.google).toHaveBeenCalledOnce();
  stop();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(checks.automations).toHaveBeenCalledTimes(2);
  expect(checks.notifications).toHaveBeenCalledTimes(2);
});
