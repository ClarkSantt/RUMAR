import { getDatabase } from '../../lib/database/connection';
import { AutomationsRepository } from './repository';
let pending: Promise<void> | null = null;
let suspended = 0;
export function checkAutomations(onChange: () => void = () => {}) {
  if (suspended || pending) return pending ?? Promise.resolve();
  pending = (async () => {
    const db = await getDatabase();
    const before = await db.select<{ n: number }[]>('SELECT count(*) n FROM automation_executions');
    await new AutomationsRepository(db).process();
    const after = await db.select<{ n: number }[]>('SELECT count(*) n FROM automation_executions');
    if (before[0].n !== after[0].n) onChange();
  })()
    .catch(() => {
      window.dispatchEvent(new Event('rumo-automation-error'));
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
export function startAutomations(onChange: () => void) {
  void checkAutomations(onChange);
  const timer = window.setInterval(() => void checkAutomations(onChange), 60000);
  return () => window.clearInterval(timer);
}
export async function suspendAutomations() {
  suspended++;
  await pending;
  return () => {
    suspended = Math.max(0, suspended - 1);
  };
}
