import { isTauri } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getDatabase } from '../../lib/database/connection';

export interface WindowsPreferences {
  startMinimized: boolean;
  backgroundNotifications: boolean;
  globalShortcut: string;
}

const keys = [
  'windows_start_minimized',
  'windows_background_notifications',
  'windows_global_shortcut',
];

export async function loadWindowsPreferences(): Promise<WindowsPreferences> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key,value FROM settings WHERE key IN (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys,
  );
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    startMinimized: values.windows_start_minimized === '1',
    backgroundNotifications: values.windows_background_notifications !== '0',
    globalShortcut: values.windows_global_shortcut ?? '',
  };
}

export async function saveWindowsPreference(key: (typeof keys)[number], value: string) {
  if (!keys.includes(key)) throw Error('Preferência inválida.');
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,$3)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
  window.dispatchEvent(new Event('rumo-windows-settings-changed'));
}

export async function setWindowsAutostart(enabled: boolean) {
  if (!isTauri()) throw Error('Início com Windows disponível somente no aplicativo desktop.');
  if (enabled) await enable();
  else await disable();
  return isEnabled();
}

export async function getWindowsAutostart() {
  return isTauri() ? isEnabled() : false;
}
