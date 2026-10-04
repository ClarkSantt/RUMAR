import { isTauri } from '@tauri-apps/api/core';
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
import { getDatabase } from '../../lib/database/connection';
import { displayReminder } from './domain';
import { NotificationsRepository } from './repository';

let pending: Promise<void> | null = null;
let suspended = 0;
export function checkLocalNotifications(now = new Date()) {
  if (!isTauri() || suspended || pending) return pending ?? Promise.resolve();
  pending = deliver(now).finally(() => {
    pending = null;
  });
  return pending;
}
async function deliver(now: Date) {
  try {
    const repo = new NotificationsRepository(await getDatabase());
    const prefs = await repo.preferences();
    if (!prefs.enabled || !(await isPermissionGranted())) return;
    const reminders = await repo.due(now, prefs);
    for (const reminder of reminders) {
      if (!(await repo.claim(reminder))) continue;
      sendNotification(displayReminder(reminder, prefs));
    }
  } catch (error) {
    console.error(
      'RUMO: falha técnica no agendador local',
      error instanceof Error ? error.name : 'erro',
    );
  }
}
export async function suspendLocalNotifications() {
  suspended++;
  await pending;
  return () => {
    suspended = Math.max(0, suspended - 1);
  };
}
export function startLocalNotifications() {
  void checkLocalNotifications();
  // No Windows background service: inexpensive check while the app is running.
  const timer = window.setInterval(() => void checkLocalNotifications(), 60000);
  return () => window.clearInterval(timer);
}
