import { getDatabase } from '../../../lib/database/connection';
import { gatewayConfiguration, nativeGatewayTransport } from './native-gateway';
import { PluggyFinancialConnectionProvider } from './pluggy-provider';
import { FinancialConnectionsRepository, recoverInterruptedSyncs } from './repository';

export type AutoSyncPreference =
  'manual' | 'startup' | 'startup_1h' | 'startup_3h' | 'startup_6h' | 'startup_12h' | 'startup_24h';
let running = false;
let lastAttempt = 0;
const FIVE_MINUTES = 5 * 60_000;

export function autoSyncIntervalMs(preference: AutoSyncPreference): number | null {
  const match = /^startup_(1|3|6|12|24)h$/.exec(preference);
  return match ? Number(match[1]) * 60 * 60_000 : null;
}

export function isAutoSyncDue(
  lastSyncedAt: string | null,
  intervalMs: number,
  startup: boolean,
  dirty: boolean,
  now = Date.now(),
): boolean {
  // The first import always requires the user's preview and explicit confirmation.
  if (!lastSyncedAt) return false;
  if (dirty || startup) return true;
  const previous = Date.parse(lastSyncedAt);
  return !Number.isFinite(previous) || now - previous >= intervalMs;
}

export async function autoSyncPreference(): Promise<AutoSyncPreference> {
  const db = await getDatabase();
  const row = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key='open_finance_auto_sync'",
  );
  const value = row[0]?.value as AutoSyncPreference | undefined;
  return value && (value === 'manual' || value === 'startup' || autoSyncIntervalMs(value))
    ? value
    : 'startup_6h';
}
export async function saveAutoSyncPreference(value: AutoSyncPreference) {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO settings(key,value,updated_at) VALUES('open_finance_auto_sync',$1,$2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    [value, new Date().toISOString()],
  );
}

/** Wakes in the existing background scheduler, including tray mode; never starts a Windows service. */
export async function syncOpenFinanceInBackground(startup = false): Promise<void> {
  if (running || Date.now() - lastAttempt < FIVE_MINUTES) return;
  running = true;
  try {
    const db = await getDatabase();
    await recoverInterruptedSyncs(db);
    const [config, preference] = await Promise.all([gatewayConfiguration(), autoSyncPreference()]);
    if (!config.configured || !config.paired || preference === 'manual') return;
    if (preference === 'startup' && !startup) return;
    const interval = autoSyncIntervalMs(preference);
    if (!startup && interval && Date.now() - lastAttempt < interval) return;
    lastAttempt = Date.now();
    const repo = new FinancialConnectionsRepository(db);
    const provider = new PluggyFinancialConnectionProvider(nativeGatewayTransport, {
      open: async () => {
        throw Error('O widget é iniciado somente por ação do usuário.');
      },
    });
    const connections = (await repo.connections()).filter(
      (row) => row.provider === 'pluggy' && ['connected', 'error'].includes(row.status),
    );
    const remote = await nativeGatewayTransport.request<{
      connections: { id: string; dirty: number; dirty_version: number }[];
    }>('GET', '/v1/open-finance/connections');
    const remoteById = new Map(remote.connections.map((row) => [row.id, row]));
    for (const connection of connections) {
      const item = remoteById.get(connection.external_connection_id);
      if (!item) continue;
      if (!isAutoSyncDue(connection.last_synced_at, interval ?? 0, startup, Boolean(item.dirty)))
        continue;
      const mapped = await repo.accounts(connection.id);
      if (!mapped.some((account) => account.linkedFinanceAccountId)) continue;
      try {
        await repo.sync(connection.id, provider);
        await nativeGatewayTransport.request(
          'POST',
          `/v1/open-finance/connections/${encodeURIComponent(item.id)}/sync`,
          { dirtyVersion: item.dirty_version },
        );
        window.dispatchEvent(new Event('rumo-finance-changed'));
      } catch {
        // The local Finance module remains usable offline; the next scheduled wake can retry.
      }
    }
  } catch {
    // Gateway outages never block startup, Home, or Finance.
  } finally {
    running = false;
  }
}
