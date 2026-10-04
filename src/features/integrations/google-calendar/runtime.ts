import { getDatabase } from '../../../lib/database/connection';
import { RealGoogleCalendarClient } from './client';
import { GoogleSync } from './sync';

let running: Promise<void> | null = null;
let suspended = 0;
export async function suspendGoogleCalendar() {
  suspended++;
  await running?.catch(() => {});
  return () => {
    suspended = Math.max(0, suspended - 1);
  };
}
export async function syncGoogleCalendar(
  onProgress?: (done: number, total: number) => void,
  manual = false,
) {
  if (suspended) return;
  if (running) return running;
  running = (async () => {
    const sync = new GoogleSync(await getDatabase(), new RealGoogleCalendarClient());
    const settings = await sync.settings();
    if (
      settings.state !== 'connected' ||
      (!manual && (!settings.automatic || !settings.sync_started))
    )
      return;
    if (manual && !settings.sync_started) await sync.startSync();
    await sync.reconcile(undefined, undefined, manual);
    if ((await sync.settings()).state === 'reconnect')
      throw Error('Agenda RUMO não encontrada no Google. Recrie-a explicitamente em Integrações.');
    for (let batch = 0; batch < 20 && !suspended; batch++) {
      const result = await sync.process(10, onProgress);
      if (result.total < 10) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
export function startGoogleCalendar() {
  let debounce: number | undefined;
  const run = () => {
    void syncGoogleCalendar().catch(() => {});
  };
  const schedule = () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(run, 800);
  };
  const initial = window.setTimeout(run, 1500);
  const timer = window.setInterval(run, 5 * 60_000);
  window.addEventListener('online', run);
  window.addEventListener('rumo-local-calendar-write', schedule);
  return () => {
    window.clearTimeout(initial);
    window.clearTimeout(timer);
    window.clearTimeout(debounce);
    window.removeEventListener('online', run);
    window.removeEventListener('rumo-local-calendar-write', schedule);
  };
}
