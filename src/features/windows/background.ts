import { checkAutomations } from '../automations/runtime';
import { checkLocalNotifications } from '../notifications/scheduler';
import { syncGoogleCalendar } from '../integrations/google-calendar/runtime';
import { syncOpenFinanceInBackground } from '../finance/connections/auto-sync';
import { loadWindowsPreferences } from './preferences';

let windowInTray = false;
export function setWindowInTray(hidden: boolean) {
  windowInTray = hidden;
}

/** One wake-up for local jobs; each worker retains its own re-entry guard. */
export function startBackgroundScheduler(onAutomationChange: () => void) {
  let stopped = false;
  let lastGoogle = 0;
  let lastFinance = 0;
  let timer: number | undefined;
  let allowBackgroundNotifications = true;
  const refreshPreferences = () => {
    void loadWindowsPreferences()
      .then((prefs) => {
        allowBackgroundNotifications = prefs.backgroundNotifications;
      })
      .catch(() => {});
  };
  const run = (forceGoogle = false) => {
    if (stopped) return;
    void checkAutomations(onAutomationChange);
    if (!windowInTray || allowBackgroundNotifications) void checkLocalNotifications();
    const now = Date.now();
    if (forceGoogle || now - lastGoogle >= 5 * 60_000) {
      lastGoogle = now;
      void syncGoogleCalendar().catch(() => {});
    }
    if (forceGoogle || now - lastFinance >= 5 * 60_000) {
      lastFinance = now;
      void syncOpenFinanceInBackground(forceGoogle);
    }
    timer = window.setTimeout(() => run(), 60_000);
  };
  const online = () => {
    lastGoogle = 0;
    lastFinance = 0;
  };
  let debounce: number | undefined;
  const localWrite = () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      if (!stopped) void syncGoogleCalendar().catch(() => {});
    }, 800);
  };
  window.addEventListener('online', online);
  window.addEventListener('rumo-local-calendar-write', localWrite);
  window.addEventListener('rumo-windows-settings-changed', refreshPreferences);
  refreshPreferences();
  timer = window.setTimeout(() => run(true), 1500);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearTimeout(debounce);
    window.removeEventListener('online', online);
    window.removeEventListener('rumo-local-calendar-write', localWrite);
    window.removeEventListener('rumo-windows-settings-changed', refreshPreferences);
  };
}
