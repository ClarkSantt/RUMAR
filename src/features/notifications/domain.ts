export type NotificationCategory =
  | 'tasks'
  | 'routines'
  | 'workouts'
  | 'finance'
  | 'activity'
  | 'body'
  | 'review'
  | 'blocks'
  | 'automations';
export interface NotificationPreferences {
  enabled: boolean;
  hide_sensitive: boolean;
  tasks: boolean;
  blocks: boolean;
  automations: boolean;
  routines: boolean;
  workouts: boolean;
  finance: boolean;
  activity: boolean;
  body: boolean;
  review: boolean;
  workout_time: string;
  finance_time: string;
  activity_time: string;
  body_time: string;
  body_weekday: number;
  review_time: string;
}
export const defaultNotifications: NotificationPreferences = {
  enabled: false,
  hide_sensitive: true,
  tasks: false,
  blocks: false,
  automations: false,
  routines: false,
  workouts: false,
  finance: false,
  activity: false,
  body: false,
  review: false,
  workout_time: '18:00',
  finance_time: '09:00',
  activity_time: '22:00',
  body_time: '08:00',
  body_weekday: 0,
  review_time: '19:00',
};
export interface Reminder {
  key: string;
  category: NotificationCategory;
  scheduledFor: string;
  title: string;
  body: string;
}
export function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function dueNow(date: string, time: string, now: Date, leadMinutes = 0) {
  if (!validTime(time)) return false;
  const when = new Date(`${date}T${time}:00`);
  const distance = now.getTime() - (when.getTime() - leadMinutes * 60000);
  // Polling once per minute with a two-minute grace window; stale reminders
  // are not replayed after an extended shutdown.
  return distance >= 0 && distance < 120000;
}
export function displayReminder(reminder: Reminder, prefs: NotificationPreferences) {
  return prefs.hide_sensitive
    ? { title: 'RUMAR', body: 'Você tem um lembrete.' }
    : { title: reminder.title, body: reminder.body };
}
