import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDatabase: vi.fn(), preferences: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('../src/lib/database/connection', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('../src/features/notifications/repository', () => ({
  NotificationsRepository: class {
    preferences = mocks.preferences;
  },
}));
import {
  checkLocalNotifications,
  suspendLocalNotifications,
} from '../src/features/notifications/scheduler';
it('waits for an active check and prevents reopening SQLite until maintenance ends', async () => {
  let finish!: (value: { enabled: boolean }) => void;
  mocks.getDatabase.mockResolvedValue({});
  mocks.preferences.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const check = checkLocalNotifications();
  await vi.waitFor(() => expect(mocks.preferences).toHaveBeenCalledOnce());
  let suspended = false;
  const waiting = suspendLocalNotifications().then((resume) => {
    suspended = true;
    return resume;
  });
  await Promise.resolve();
  expect(suspended).toBe(false);
  finish({ enabled: false });
  await check;
  const resume = await waiting;
  await checkLocalNotifications();
  expect(mocks.getDatabase).toHaveBeenCalledOnce();
  resume();
  mocks.preferences.mockResolvedValue({ enabled: false });
  await checkLocalNotifications();
  expect(mocks.getDatabase).toHaveBeenCalledTimes(2);
});
