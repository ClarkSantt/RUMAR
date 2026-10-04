import type { SqlConnection } from '../../../lib/database/connection';
import { validDate } from '../../../lib/dates';
import { collectGoogleCandidates } from './candidates';
import { GoogleClientError, type GoogleCalendarClient } from './client';
import {
  mirrorKey,
  retryDelayMs,
  timeZone,
  type GoogleEvent,
  type GoogleSettings,
  type MirrorKey,
  type MirrorKind,
} from './domain';

type QueueRow = MirrorKey & {
  status: 'pending' | 'retry' | 'error';
  attemptCount: number;
  updatedAt: string;
};
type LinkRow = MirrorKey & {
  googleCalendarId: string;
  googleEventId: string;
  lastSyncedHash: string;
};
const kinds: MirrorKind[] = [
  'routine',
  'block',
  'block_series',
  'block_exception',
  'workout',
  'task',
  'objective',
  'milestone',
];
function sourceEnabled(settings: GoogleSettings, type: MirrorKind) {
  return type === 'routine'
    ? !!settings.sync_routines
    : type === 'block' || type === 'block_series' || type === 'block_exception'
      ? !!settings.sync_time_blocks
      : type === 'workout'
        ? !!settings.sync_workouts
        : type === 'task'
          ? !!settings.sync_tasks
          : type === 'objective'
            ? !!settings.sync_objectives
            : !!settings.sync_milestones;
}
async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export async function deterministicEventId(integrationId: string, key: MirrorKey) {
  return `rumo${(await digest(`${integrationId}\u0000${mirrorKey(key)}`)).slice(0, 48)}`;
}
async function eventHash(event: GoogleEvent) {
  const { id: _id, ...content } = event;
  void _id;
  return digest(JSON.stringify(content));
}
export class GoogleSync {
  constructor(
    private db: SqlConnection,
    private client: GoogleCalendarClient,
  ) {}
  async settings() {
    const row = (
      await this.db.select<GoogleSettings[]>('SELECT * FROM google_calendar_settings WHERE id=1')
    )[0];
    if (!row) throw Error('Configuração Google ausente.');
    return row;
  }
  async setFirstSyncFrom(date: string) {
    if (!validDate(date)) throw Error('Data inicial inválida.');
    const settings = await this.settings();
    if (settings.state === 'connected')
      throw Error('Desconecte antes de alterar o início da primeira sincronização.');
    await this.db.execute(
      'UPDATE google_calendar_settings SET first_sync_from=$1,updated_at=$2 WHERE id=1',
      [date, new Date().toISOString()],
    );
  }
  async startSync() {
    await this.db.execute(
      'UPDATE google_calendar_settings SET sync_started=1,updated_at=$1 WHERE id=1',
      [new Date().toISOString()],
    );
  }
  async counts() {
    return (
      await this.db.select<{ pending: number; errors: number }[]>(`SELECT
      count(*) FILTER (WHERE status IN('pending','retry')) pending,
      count(*) FILTER (WHERE status='error') errors FROM google_calendar_sync_queue`)
    )[0];
  }
  async saveSettings(
    changes: Partial<
      Pick<
        GoogleSettings,
        | 'client_id'
        | 'automatic'
        | 'sync_routines'
        | 'sync_time_blocks'
        | 'sync_workouts'
        | 'sync_tasks'
        | 'sync_objectives'
        | 'sync_milestones'
        | 'untimed_mode'
        | 'routine_minutes'
        | 'delete_remote'
        | 'sync_horizon_days'
      >
    >,
  ) {
    const allowed = [
      'client_id',
      'automatic',
      'sync_routines',
      'sync_time_blocks',
      'sync_workouts',
      'sync_tasks',
      'sync_objectives',
      'sync_milestones',
      'untimed_mode',
      'routine_minutes',
      'delete_remote',
      'sync_horizon_days',
    ] as const;
    for (const [field, value] of Object.entries(changes)) {
      if (!allowed.includes(field as (typeof allowed)[number]))
        throw Error('Preferência desconhecida.');
      if (field === 'client_id' && (typeof value !== 'string' || value.length > 512))
        throw Error('Client ID inválido.');
      if (field === 'client_id' && (await this.settings()).state === 'connected')
        throw Error('Desconecte antes de trocar o Client ID.');
      if (field === 'untimed_mode' && value !== 'skip' && value !== 'all_day')
        throw Error('Preferência inválida.');
      if (
        field === 'routine_minutes' &&
        (!Number.isInteger(value) || Number(value) < 5 || Number(value) > 240)
      )
        throw Error('Duração inválida.');
      if (field === 'sync_horizon_days' && ![30, 90, -1].includes(Number(value)))
        throw Error('Período inválido.');
      if (
        field !== 'client_id' &&
        field !== 'untimed_mode' &&
        field !== 'routine_minutes' &&
        field !== 'sync_horizon_days' &&
        value !== 0 &&
        value !== 1
      )
        throw Error('Preferência inválida.');
      await this.db.execute(
        `UPDATE google_calendar_settings SET ${field}=$1,updated_at=$2 WHERE id=1`,
        [value, new Date().toISOString()],
      );
    }
  }
  async connect() {
    const settings = await this.settings();
    if (!settings.client_id.trim()) throw Error('Configure o Client ID OAuth Desktop.');
    await this.client.connect(settings.integration_id, settings.client_id);
    let calendarId = settings.calendar_id;
    let calendarName: string;
    if (calendarId) {
      const existing = await this.client.getCalendar(
        settings.integration_id,
        settings.client_id,
        calendarId,
      );
      if (!existing) {
        await this.db.execute("UPDATE google_calendar_settings SET state='reconnect' WHERE id=1");
        throw Error('A agenda RUMO registrada não existe mais. Recrie-a explicitamente.');
      }
      calendarName = existing.summary;
    } else {
      const created = await this.client.createCalendar(
        settings.integration_id,
        settings.client_id,
        timeZone(),
      );
      calendarId = created.id;
      calendarName = created.summary;
    }
    await this.db.execute(
      `UPDATE google_calendar_settings SET state='connected',calendar_id=$1,calendar_name=$2,
      first_sync_from=coalesce(first_sync_from,date('now','localtime')),updated_at=$3 WHERE id=1`,
      [calendarId, calendarName, new Date().toISOString()],
    );
  }
  async disconnect() {
    const settings = await this.settings();
    await this.client.disconnect(settings.integration_id);
    await this.db.execute(
      `UPDATE google_calendar_settings SET state='disconnected',updated_at=$1 WHERE id=1`,
      [new Date().toISOString()],
    );
  }
  async deleteCalendar(confirmation: string) {
    if (confirmation !== 'EXCLUIR RUMO') throw Error('Confirmação necessária.');
    const settings = await this.settings();
    if (settings.state !== 'connected' || !settings.calendar_id)
      throw Error('Conecte o Google Agenda.');
    await this.client.deleteCalendar(
      settings.integration_id,
      settings.client_id,
      settings.calendar_id,
    );
    await this.db.execute('DELETE FROM google_calendar_event_links WHERE google_calendar_id=$1', [
      settings.calendar_id,
    ]);
    await this.db.execute('DELETE FROM google_calendar_sync_queue');
    await this.db.execute(
      `UPDATE google_calendar_settings SET calendar_id=NULL,state='disconnected',sync_started=0,last_sync_at=NULL,updated_at=$1 WHERE id=1`,
      [new Date().toISOString()],
    );
    await this.client.disconnect(settings.integration_id);
  }
  async recreateCalendar() {
    const settings = await this.settings();
    if (settings.state !== 'reconnect' || !settings.calendar_id)
      throw Error('Recriação disponível apenas para uma agenda ausente.');
    if (!(await this.client.hasCredential(settings.integration_id)))
      throw Error('Reconecte a conta Google primeiro.');
    if (
      await this.client.getCalendar(
        settings.integration_id,
        settings.client_id,
        settings.calendar_id,
      )
    )
      throw Error('A agenda ainda existe. Reconecte sem recriá-la.');
    const calendar = await this.client.createCalendar(
      settings.integration_id,
      settings.client_id,
      timeZone(),
    );
    await this.db.execute('DELETE FROM google_calendar_event_links');
    await this.db.execute(
      `UPDATE google_calendar_settings SET calendar_id=$1,calendar_name=$2,state='connected',updated_at=$3 WHERE id=1`,
      [calendar.id, calendar.summary, new Date().toISOString()],
    );
  }
  async enqueue(key: MirrorKey) {
    if (!kinds.includes(key.entityType)) throw Error('Fonte desconhecida.');
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO google_calendar_sync_queue(entity_type,entity_id,occurrence_key,created_at,updated_at)
      VALUES($1,$2,$3,$4,$4) ON CONFLICT(entity_type,entity_id,occurrence_key)
      DO UPDATE SET status='pending',next_attempt_at='',updated_at=excluded.updated_at`,
      [key.entityType, key.entityId, key.occurrenceKey, now],
    );
  }
  /** Persist local work first; this only plans remote calls after the local commit. */
  async reconcile(from?: string, to?: string, verifyRemote = false) {
    const settings = await this.settings();
    if (settings.state !== 'connected') return 0;
    if (
      verifyRemote &&
      settings.calendar_id &&
      !(await this.client.getCalendar(
        settings.integration_id,
        settings.client_id,
        settings.calendar_id,
      ))
    ) {
      await this.db.execute("UPDATE google_calendar_settings SET state='reconnect' WHERE id=1");
      return 0;
    }
    const candidates = await collectGoogleCandidates(this.db, settings, timeZone(), from, to);
    const eligibleBlocks = new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.entityType === 'block' || candidate.entityType === 'block_series',
        )
        .map((candidate) => mirrorKey(candidate)),
    );
    const links = await this.links();
    const byKey = new Map(links.map((link) => [mirrorKey(link), link]));
    const candidateKeys = new Set(candidates.map(mirrorKey));
    let planned = 0;
    for (const candidate of candidates) {
      const existing = byKey.get(mirrorKey(candidate));
      const hash = await eventHash(candidate.event);
      let missingRemote = false;
      if (verifyRemote && existing && existing.lastSyncedHash === hash) {
        missingRemote = !(await this.client.getEvent(
          settings.integration_id,
          settings.client_id,
          existing.googleCalendarId,
          existing.googleEventId,
        ));
        if (missingRemote) {
          await this.db.execute(
            'DELETE FROM google_calendar_event_links WHERE entity_type=$1 AND entity_id=$2 AND occurrence_key=$3',
            [candidate.entityType, candidate.entityId, candidate.occurrenceKey],
          );
        }
      }
      if (!existing || missingRemote || existing.lastSyncedHash !== hash) {
        await this.enqueue(candidate);
        planned++;
      }
    }
    // Never infer deletion merely because an item is outside a bounded scan.
    for (const link of links)
      if (
        !candidateKeys.has(mirrorKey(link)) &&
        (await this.shouldRemoveRemote(link, settings, eligibleBlocks))
      ) {
        await this.enqueue(link);
        planned++;
      }
    return planned;
  }
  private async links() {
    const rows = await this.db.select<
      {
        entity_type: MirrorKind;
        entity_id: string;
        occurrence_key: string;
        google_calendar_id: string;
        google_event_id: string;
        last_synced_hash: string;
      }[]
    >('SELECT * FROM google_calendar_event_links');
    return rows.map((row): LinkRow => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      occurrenceKey: row.occurrence_key,
      googleCalendarId: row.google_calendar_id,
      googleEventId: row.google_event_id,
      lastSyncedHash: row.last_synced_hash,
    }));
  }
  /** Missing from a bounded scan does not mean deleted. Confirm a local tombstone or visibility choice. */
  private async shouldRemoveRemote(
    key: MirrorKey,
    settings: GoogleSettings,
    eligibleBlocks: Set<string>,
  ) {
    if (!sourceEnabled(settings, key.entityType)) return true;
    const calendarType =
      key.entityType === 'block_series' || key.entityType === 'block_exception'
        ? 'block'
        : key.entityType;
    const preferenceType = key.entityType === 'block_exception' ? 'block_series' : key.entityType;
    const [source, visible, enabled] = await Promise.all([
      this.db.select<{ visible: number }[]>(
        'SELECT visible FROM calendar_source_preferences WHERE source_type=$1',
        [calendarType],
      ),
      this.db.select<{ visible: number }[]>(
        'SELECT visible FROM calendar_visibility_overrides WHERE entity_type=$1 AND entity_id=$2',
        [calendarType, key.entityId],
      ),
      this.db.select<{ enabled: number }[]>(
        'SELECT enabled FROM google_calendar_item_preferences WHERE entity_type=$1 AND entity_id=$2',
        [preferenceType, key.entityId],
      ),
    ]);
    if (source[0]?.visible === 0 || visible[0]?.visible === 0 || enabled[0]?.enabled === 0)
      return true;
    if (
      (key.entityType === 'task' || key.entityType === 'routine' || key.entityType === 'workout') &&
      settings.sync_time_blocks
    ) {
      const blockers = await this.db.select<{ id: string; kind: 'block' | 'block_series' }[]>(
        `
        SELECT id,'block' kind FROM planner_time_blocks WHERE entity_type=$1 AND entity_id=$2 AND $1='task'
        UNION ALL SELECT id,'block_series' kind FROM planner_time_block_series WHERE entity_type=$1 AND entity_id=$2`,
        [key.entityType, key.entityId],
      );
      for (const blocker of blockers) {
        if (
          !eligibleBlocks.has(
            mirrorKey({ entityType: blocker.kind, entityId: blocker.id, occurrenceKey: '' }),
          )
        )
          continue;
        const [shown, mirrored] = await Promise.all([
          this.db.select<{ visible: number }[]>(
            'SELECT visible FROM calendar_visibility_overrides WHERE entity_type=$1 AND entity_id=$2',
            ['block', blocker.id],
          ),
          this.db.select<{ enabled: number }[]>(
            'SELECT enabled FROM google_calendar_item_preferences WHERE entity_type=$1 AND entity_id=$2',
            [blocker.kind, blocker.id],
          ),
        ]);
        const blockSource = await this.db.select<{ visible: number }[]>(
          'SELECT visible FROM calendar_source_preferences WHERE source_type=$1',
          ['block'],
        );
        if (shown[0]?.visible !== 0 && mirrored[0]?.enabled !== 0 && blockSource[0]?.visible !== 0)
          return true;
      }
    }
    if (calendarType === 'block') {
      const table =
        key.entityType === 'block' ? 'planner_time_blocks' : 'planner_time_block_series';
      const parents = await this.db.select<
        { entity_type: string | null; entity_id: string | null }[]
      >(`SELECT entity_type,entity_id FROM ${table} WHERE id=$1`, [key.entityId]);
      const parent = parents[0];
      if (parent?.entity_type && parent.entity_id) {
        const [parentSource, parentVisibility] = await Promise.all([
          this.db.select<{ visible: number }[]>(
            'SELECT visible FROM calendar_source_preferences WHERE source_type=$1',
            [parent.entity_type],
          ),
          this.db.select<{ visible: number }[]>(
            'SELECT visible FROM calendar_visibility_overrides WHERE entity_type=$1 AND entity_id=$2',
            [parent.entity_type, parent.entity_id],
          ),
        ]);
        if (parentSource[0]?.visible === 0 || parentVisibility[0]?.visible === 0) return true;
      }
    }
    const queries: Record<MirrorKind, string> = {
      routine: 'SELECT 1 present FROM routines WHERE id=$1 AND active=1 AND archived_at IS NULL',
      block: 'SELECT 1 present FROM planner_time_blocks WHERE id=$1',
      block_series: 'SELECT 1 present FROM planner_time_block_series WHERE id=$1',
      block_exception:
        'SELECT 1 present FROM planner_time_block_exceptions WHERE series_id=$1 AND occurrence_date=$2 AND cancelled=0',
      workout:
        'SELECT 1 present FROM workout_days d JOIN workout_plans p ON p.id=d.workout_plan_id WHERE d.id=$1 AND p.active=1 AND p.archived_at IS NULL',
      task: 'SELECT 1 present FROM tasks WHERE id=$1 AND due_date IS NOT NULL AND archived_at IS NULL',
      objective:
        'SELECT 1 present FROM objectives WHERE id=$1 AND target_date IS NOT NULL AND archived_at IS NULL',
      milestone:
        'SELECT 1 present FROM objective_milestones m JOIN objectives o ON o.id=m.objective_id WHERE m.id=$1 AND m.target_date IS NOT NULL AND o.archived_at IS NULL',
    };
    const values =
      key.entityType === 'block_exception' ? [key.entityId, key.occurrenceKey] : [key.entityId];
    return (
      (await this.db.select<{ present: number }[]>(queries[key.entityType], values)).length === 0
    );
  }
  async process(limit = 50, progress?: (done: number, total: number) => void, now = new Date()) {
    const settings = await this.settings();
    if (settings.state !== 'connected' || !settings.calendar_id) return { done: 0, total: 0 };
    if (!(await this.client.hasCredential(settings.integration_id))) {
      await this.db.execute(
        `UPDATE google_calendar_settings SET state='reconnect',updated_at=$1 WHERE id=1`,
        [now.toISOString()],
      );
      return { done: 0, total: 0 };
    }
    if (
      !(await this.client.getCalendar(
        settings.integration_id,
        settings.client_id,
        settings.calendar_id,
      ))
    ) {
      await this.db.execute(
        `UPDATE google_calendar_settings SET state='reconnect',updated_at=$1 WHERE id=1`,
        [now.toISOString()],
      );
      return { done: 0, total: 0 };
    }
    const queue = await this.db.select<
      {
        entity_type: MirrorKind;
        entity_id: string;
        occurrence_key: string;
        status: QueueRow['status'];
        attempt_count: number;
        updated_at: string;
      }[]
    >(
      `SELECT * FROM google_calendar_sync_queue WHERE status IN('pending','retry') AND next_attempt_at<=$1 ORDER BY created_at LIMIT $2`,
      [now.toISOString(), limit],
    );
    const candidates = await collectGoogleCandidates(this.db, settings, timeZone());
    const eligibleBlocks = new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.entityType === 'block' || candidate.entityType === 'block_series',
        )
        .map((candidate) => mirrorKey(candidate)),
    );
    const desired = new Map(candidates.map((candidate) => [mirrorKey(candidate), candidate]));
    const links = new Map((await this.links()).map((link) => [mirrorKey(link), link]));
    let done = 0;
    for (const row of queue) {
      const key: MirrorKey = {
        entityType: row.entity_type,
        entityId: row.entity_id,
        occurrenceKey: row.occurrence_key,
      };
      const candidate = desired.get(mirrorKey(key));
      const link = links.get(mirrorKey(key));
      try {
        if (!candidate || !sourceEnabled(settings, key.entityType)) {
          if (await this.shouldRemoveRemote(key, settings, eligibleBlocks)) {
            if (link && settings.delete_remote) {
              try {
                await this.client.deleteEvent(
                  settings.integration_id,
                  settings.client_id,
                  link.googleCalendarId,
                  link.googleEventId,
                );
              } catch (error) {
                if (!(error instanceof GoogleClientError && error.code === 'not_found'))
                  throw error;
              }
            }
            await this.db.execute(
              'DELETE FROM google_calendar_event_links WHERE entity_type=$1 AND entity_id=$2 AND occurrence_key=$3',
              [key.entityType, key.entityId, key.occurrenceKey],
            );
            await this.log(key, 'delete', 'ok');
          } else await this.log(key, 'skip', 'ok');
        } else {
          const hash = await eventHash(candidate.event);
          if (!link) {
            const id = await deterministicEventId(settings.integration_id, key);
            try {
              await this.client.createEvent(
                settings.integration_id,
                settings.client_id,
                settings.calendar_id,
                { ...candidate.event, id },
              );
            } catch (error) {
              if (!(error instanceof GoogleClientError && error.code === 'conflict')) throw error;
              // The previous create may have succeeded before an offline response. Reclaim by deterministic ID.
              if (
                !(await this.client.getEvent(
                  settings.integration_id,
                  settings.client_id,
                  settings.calendar_id,
                  id,
                ))
              )
                throw error;
              await this.client.patchEvent(
                settings.integration_id,
                settings.client_id,
                settings.calendar_id,
                id,
                candidate.event,
              );
            }
            await this.db.execute(
              `INSERT INTO google_calendar_event_links(entity_type,entity_id,occurrence_key,google_calendar_id,google_event_id,last_synced_hash,last_synced_at)
              VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(entity_type,entity_id,occurrence_key) DO UPDATE SET google_calendar_id=excluded.google_calendar_id,google_event_id=excluded.google_event_id,last_synced_hash=excluded.last_synced_hash,last_synced_at=excluded.last_synced_at`,
              [
                key.entityType,
                key.entityId,
                key.occurrenceKey,
                settings.calendar_id,
                id,
                hash,
                now.toISOString(),
              ],
            );
            await this.log(key, 'create', 'ok');
          } else if (link.lastSyncedHash !== hash) {
            try {
              await this.client.patchEvent(
                settings.integration_id,
                settings.client_id,
                link.googleCalendarId,
                link.googleEventId,
                candidate.event,
              );
            } catch (error) {
              if (!(error instanceof GoogleClientError && error.code === 'not_found')) throw error;
              const id = await deterministicEventId(settings.integration_id, key);
              await this.client.createEvent(
                settings.integration_id,
                settings.client_id,
                settings.calendar_id,
                { ...candidate.event, id },
              );
              await this.db.execute(
                'UPDATE google_calendar_event_links SET google_calendar_id=$1,google_event_id=$2 WHERE entity_type=$3 AND entity_id=$4 AND occurrence_key=$5',
                [settings.calendar_id, id, key.entityType, key.entityId, key.occurrenceKey],
              );
            }
            await this.db.execute(
              'UPDATE google_calendar_event_links SET last_synced_hash=$1,last_synced_at=$2 WHERE entity_type=$3 AND entity_id=$4 AND occurrence_key=$5',
              [hash, now.toISOString(), key.entityType, key.entityId, key.occurrenceKey],
            );
            await this.log(key, 'update', 'ok');
          }
        }
        // Do not clear a newer local update that arrived during the HTTP request.
        await this.db.execute(
          'DELETE FROM google_calendar_sync_queue WHERE entity_type=$1 AND entity_id=$2 AND occurrence_key=$3 AND updated_at=$4',
          [key.entityType, key.entityId, key.occurrenceKey, row.updated_at],
        );
      } catch (error) {
        const code = error instanceof GoogleClientError ? error.code : 'network';
        const attempt = row.attempt_count + 1;
        const permanent = code === 'invalid' || code === 'forbidden' || attempt >= 10;
        await this.db.execute(
          `UPDATE google_calendar_sync_queue SET status=$1,attempt_count=$2,next_attempt_at=$3,last_error_code=$4,updated_at=$5
          WHERE entity_type=$6 AND entity_id=$7 AND occurrence_key=$8 AND updated_at=$9`,
          [
            permanent ? 'error' : 'retry',
            attempt,
            permanent ? '' : new Date(now.getTime() + retryDelayMs(attempt)).toISOString(),
            code,
            now.toISOString(),
            key.entityType,
            key.entityId,
            key.occurrenceKey,
            row.updated_at,
          ],
        );
        await this.log(key, 'error', permanent ? 'error' : 'retry', code);
        if (code === 'auth') {
          await this.db.execute(
            `UPDATE google_calendar_settings SET state='reconnect',updated_at=$1 WHERE id=1`,
            [now.toISOString()],
          );
          break;
        }
      }
      done++;
      progress?.(done, queue.length);
    }
    if (done)
      await this.db.execute('UPDATE google_calendar_settings SET last_sync_at=$1 WHERE id=1', [
        now.toISOString(),
      ]);
    return { done, total: queue.length };
  }
  private log(key: MirrorKey, operation: string, result: string, errorCode = '') {
    return this.db.execute(
      'INSERT INTO google_calendar_sync_log(entity_type,entity_id,operation,result,error_code,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [key.entityType, key.entityId, operation, result, errorCode, new Date().toISOString()],
    );
  }
}
