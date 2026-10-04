import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { database } from './database';
import {
  blockRrule,
  eventFor,
  googleScope,
  routineRrule,
  type GoogleEvent,
} from '../src/features/integrations/google-calendar/domain';
import { collectGoogleCandidates } from '../src/features/integrations/google-calendar/candidates';
import {
  GoogleClientError,
  type GoogleCalendarClient,
} from '../src/features/integrations/google-calendar/client';
import { GoogleSync } from '../src/features/integrations/google-calendar/sync';
import { portableJson } from '../src/features/data/json-export';
import type { SqlConnection } from '../src/lib/database/connection';

class FakeGoogle implements GoogleCalendarClient {
  events = new Map<string, GoogleEvent>();
  creates = 0;
  calendarCreates = 0;
  patches = 0;
  deletes = 0;
  failure: GoogleClientError | null = null;
  credential = true;
  calendarPresent = true;
  async hasCredential() {
    return this.credential;
  }
  async connect() {
    this.credential = true;
  }
  async disconnect() {
    this.credential = false;
  }
  async createCalendar() {
    this.calendarCreates++;
    this.calendarPresent = true;
    return { id: 'rumo-calendar', summary: 'RUMO' };
  }
  async getCalendar() {
    return this.calendarPresent ? { id: 'rumo-calendar', summary: 'RUMO' } : null;
  }
  async deleteCalendar() {
    this.events.clear();
    this.calendarPresent = false;
  }
  async createEvent(_integration: string, _client: string, _calendar: string, event: GoogleEvent) {
    if (this.failure) throw this.failure;
    if (!event.id) throw Error('ID ausente');
    if (this.events.has(event.id)) throw new GoogleClientError('conflict');
    this.events.set(event.id, event);
    this.creates++;
    return { id: event.id };
  }
  async getEvent(_integration: string, _client: string, _calendar: string, id: string) {
    return this.events.has(id) ? { id } : null;
  }
  async patchEvent(
    _integration: string,
    _client: string,
    _calendar: string,
    id: string,
    event: GoogleEvent,
  ) {
    if (this.failure) throw this.failure;
    if (!this.events.has(id)) throw new GoogleClientError('not_found');
    this.events.set(id, { ...event, id });
    this.patches++;
  }
  async deleteEvent(_integration: string, _client: string, _calendar: string, id: string) {
    if (this.failure) throw this.failure;
    this.events.delete(id);
    this.deletes++;
  }
}

const open = () => {
  const db = database();
  db.sqlite.exec(
    "UPDATE google_calendar_settings SET state='connected',calendar_id='rumo-calendar',client_id='example-0123456789.apps.googleusercontent.com',first_sync_from='2026-10-01',sync_tasks=1,untimed_mode='all_day'",
  );
  return db;
};
const stamp = '2026-10-01T12:00:00Z';
function task(db: ReturnType<typeof database>, title = 'Consulta') {
  db.sqlite
    .prepare(
      'INSERT INTO tasks(id,title,due_date,due_time,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run('task-google', title, '2026-10-15', '14:30', stamp, stamp);
}

describe('Google Agenda local mirror', () => {
  const opened: ReturnType<typeof database>[] = [];
  afterEach(() => {
    for (const db of opened.splice(0)) db.sqlite.close();
  });
  const setup = () => {
    const db = open();
    opened.push(db);
    return db;
  };

  it('migra 0024 → 0027, preserva dados e nunca armazena token em SQLite', () => {
    const current = database(':memory:', 24);
    opened.push(current);
    task(current);
    for (const name of [
      '0025_google_calendar.sql',
      '0026_google_calendar_sources.sql',
      '0027_google_calendar_bootstrap.sql',
    ])
      current.sqlite.exec(readFileSync(resolve('src-tauri', 'migrations', name), 'utf8'));
    expect(current.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get('task-google')).toEqual(
      { title: 'Consulta' },
    );
    const columns = current.sqlite.prepare('PRAGMA table_info(google_calendar_settings)').all() as {
      name: string;
    }[];
    expect(columns.map((row) => row.name)).not.toContain('refresh_token');
    expect(columns.map((row) => row.name)).not.toContain('access_token');
    expect(
      current.sqlite
        .prepare('SELECT state,sync_started FROM google_calendar_settings WHERE id=1')
        .get(),
    ).toEqual({ state: 'disconnected', sync_started: 0 });
    expect(current.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(current.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('cria a agenda secundária uma vez, desconecta sem apagá-la e exige confirmação para excluí-la', async () => {
    const db = database();
    opened.push(db);
    db.sqlite.exec(
      "UPDATE google_calendar_settings SET client_id='example-0123456789.apps.googleusercontent.com'",
    );
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    await sync.connect();
    expect(fake.calendarCreates).toBe(1);
    expect((await sync.settings()).sync_started).toBe(0);
    await sync.disconnect();
    expect((await sync.settings()).calendar_id).toBe('rumo-calendar');
    expect(fake.calendarPresent).toBe(true);
    await sync.connect();
    expect(fake.calendarCreates).toBe(1);
    await expect(sync.deleteCalendar('não')).rejects.toThrow('Confirmação');
    await sync.deleteCalendar('EXCLUIR RUMO');
    expect((await sync.settings()).calendar_id).toBeNull();
    expect(fake.calendarPresent).toBe(false);
  });

  it('exclusão explícita limpa fila e mappings e não recria a agenda no worker', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    await sync.process();
    await sync.enqueue({ entityType: 'task', entityId: 'task-google', occurrenceKey: '' });
    await sync.deleteCalendar('EXCLUIR RUMO');
    expect((await sync.settings()).sync_started).toBe(0);
    expect(db.sqlite.prepare('SELECT count(*) n FROM google_calendar_sync_queue').get()).toEqual({
      n: 0,
    });
    expect(db.sqlite.prepare('SELECT count(*) n FROM google_calendar_event_links').get()).toEqual({
      n: 0,
    });
    await sync.process();
    expect(fake.calendarCreates).toBe(0);
    expect(fake.events.size).toBe(0);
  });

  it('agenda apagada no Google interrompe a fila até recriação explícita', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    fake.calendarPresent = false;
    expect(await sync.process()).toEqual({ done: 0, total: 0 });
    expect((await sync.settings()).state).toBe('reconnect');
    expect((await sync.counts()).pending).toBe(1);
    expect(fake.calendarCreates).toBe(0);
    await sync.recreateCalendar();
    expect(fake.calendarCreates).toBe(1);
  });

  it('reconectar após remoção remota da agenda exige recriação explícita', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    await sync.disconnect();
    fake.calendarPresent = false;
    await expect(sync.connect()).rejects.toThrow('não existe mais');
    expect((await sync.settings()).state).toBe('reconnect');
    expect(fake.calendarCreates).toBe(0);
  });

  it('sincronização manual recria evento removido no Google sem duplicar', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    await sync.process();
    const [eventId] = fake.events.keys();
    fake.events.delete(eventId);
    expect(await sync.reconcile(undefined, undefined, true)).toBe(1);
    await sync.process();
    expect(fake.events.size).toBe(1);
    expect([...fake.events.keys()][0]).toBe(eventId);
    expect(fake.creates).toBe(2);
    expect(await sync.reconcile(undefined, undefined, true)).toBe(0);
  });

  it('coalesce CREATE apagado e bloqueia CREATE pendente de fonte desativada', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    db.sqlite.prepare('DELETE FROM tasks WHERE id=?').run('task-google');
    await sync.process();
    expect(fake.creates).toBe(0);
    task(db);
    await sync.reconcile();
    db.sqlite.exec('UPDATE google_calendar_settings SET sync_tasks=0');
    await sync.process();
    expect(fake.creates).toBe(0);
  });

  it('UPDATE pendente seguido de DELETE remove o evento sem PATCH obsoleto', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    await sync.process();
    db.sqlite.prepare('UPDATE tasks SET title=? WHERE id=?').run('Novo título', 'task-google');
    db.sqlite.prepare('DELETE FROM tasks WHERE id=?').run('task-google');
    await sync.process();
    expect(fake.patches).toBe(0);
    expect(fake.events.size).toBe(0);
  });

  it('desativar a fonte antes do envio remove o espelho existente sem tocar no item local', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    await sync.process();
    db.sqlite.prepare('UPDATE tasks SET title=? WHERE id=?').run('Pendente', 'task-google');
    await sync.saveSettings({ sync_tasks: 0 });
    await sync.process();
    expect(fake.patches).toBe(0);
    expect(fake.events.size).toBe(0);
    expect(db.sqlite.prepare('SELECT title FROM tasks WHERE id=?').get('task-google')).toEqual({
      title: 'Pendente',
    });
  });

  it('mapeia fuso IANA, all-day e recorrência sem offset fixo', () => {
    const key = { entityType: 'task' as const, entityId: 't1', occurrenceKey: '' };
    const timed = eventFor(key, 'Dentista', '2026-10-15', '14:30', '15:00', 'America/Sao_Paulo');
    expect(timed.start).toEqual({ dateTime: '2026-10-15T14:30:00', timeZone: 'America/Sao_Paulo' });
    expect(eventFor(key, 'Prazo', '2026-10-15', null, null, 'Europe/Lisbon').end).toEqual({
      date: '2026-10-16',
    });
    expect(
      eventFor(key, 'Rotina', '2026-10-15', '23:45', '24:15', 'America/Sao_Paulo').end,
    ).toEqual({ dateTime: '2026-10-16T00:15:00', timeZone: 'America/Sao_Paulo' });
    expect(routineRrule('weekdays', [5, 1, 3])).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(
      blockRrule(
        { frequency: 'monthly', interval: 1, weekdays: [], until: null, count: 4 },
        '2026-10-15',
        'America/Sao_Paulo',
      ),
    ).toBe('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15;COUNT=4');
    expect(googleScope).toBe('https://www.googleapis.com/auth/calendar.app.created');
  });

  it('prioriza Time Block sobre Task e Routine na mesma ocorrência', async () => {
    const db = setup();
    task(db);
    db.sqlite
      .prepare(
        'INSERT INTO routines(id,name,frequency,weekdays,time_of_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('routine-google', 'Estudar', 'daily', '[]', '18:00', stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('block-task', '2026-10-15', '14:30', '15:00', 'task', 'task-google', stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        'block-routine',
        '2026-10-15',
        '18:00',
        '18:30',
        'routine',
        'routine-google',
        stamp,
        stamp,
      );
    const sync = new GoogleSync(db.connection, new FakeGoogle());
    const candidates = await collectGoogleCandidates(
      db.connection,
      await sync.settings(),
      'America/Sao_Paulo',
    );
    expect(candidates.filter((item) => item.entityType === 'task')).toHaveLength(0);
    expect(candidates.filter((item) => item.entityType === 'block')).toHaveLength(2);
    const routine = candidates.find((item) => item.entityType === 'routine');
    expect(routine?.event.recurrence).toContain('EXDATE;TZID=America/Sao_Paulo:20261015T180000');
  });

  it('usa Time Block como dono de Workout sem duplicar a ocorrência', async () => {
    const db = setup();
    db.sqlite
      .prepare('INSERT INTO workout_plans(id,name,active,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('plan-google', 'Plano', 1, stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO workout_days(id,workout_plan_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
      .run('day-google', 'plan-google', 'Upper', stamp, stamp);
    db.sqlite
      .prepare('INSERT INTO workout_day_weekdays(workout_day_id,weekday) VALUES(?,?)')
      .run('day-google', 4);
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('workout-block', '2026-10-15', '18:00', '19:00', 'workout', 'day-google', stamp, stamp);
    db.sqlite.exec('UPDATE google_calendar_settings SET sync_workouts=1');
    const sync = new GoogleSync(db.connection, new FakeGoogle());
    const candidates = await collectGoogleCandidates(
      db.connection,
      await sync.settings(),
      'America/Sao_Paulo',
      '2026-10-15',
      '2026-10-22',
    );
    expect(candidates.filter((item) => item.entityType === 'block')).toHaveLength(1);
    expect(
      candidates.filter((item) => item.entityType === 'workout')[0]?.event.recurrence,
    ).toContain('EXDATE;VALUE=DATE:20261015');
  });

  it('preserva o ajuste mensal em meses curtos e uma ocorrência movida', async () => {
    const db = setup();
    const recurrence = JSON.stringify({
      frequency: 'monthly',
      interval: 1,
      weekdays: [],
      until: null,
      count: 4,
    });
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_block_series(id,start_date,start_time,end_time,title,recurrence_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('monthly-google', '2027-01-31', '19:00', '20:00', 'Revisão', recurrence, stamp, stamp);
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_block_exceptions(series_id,occurrence_date,cancelled,block_date,start_time,end_time,title,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'monthly-google',
        '2027-02-28',
        0,
        '2027-03-01',
        '20:00',
        '21:00',
        'Revisão movida',
        '',
        stamp,
      );
    const sync = new GoogleSync(db.connection, new FakeGoogle());
    const candidates = await collectGoogleCandidates(
      db.connection,
      await sync.settings(),
      'America/Sao_Paulo',
      '2027-01-31',
      '2027-05-01',
    );
    const series = candidates.find((item) => item.entityType === 'block_series');
    expect(series?.event.start).toEqual({
      dateTime: '2027-01-31T19:00:00',
      timeZone: 'America/Sao_Paulo',
    });
    expect(series?.event.recurrence).toEqual([
      'RDATE;TZID=America/Sao_Paulo:20270331T190000,20270430T190000',
    ]);
    expect(candidates.find((item) => item.entityType === 'block_exception')?.event.start).toEqual({
      dateTime: '2027-03-01T20:00:00',
      timeZone: 'America/Sao_Paulo',
    });
  });

  it('não envia histórico anterior ao início escolhido nem estende COUNT encerrado', async () => {
    const db = setup();
    const daily = JSON.stringify({
      frequency: 'daily',
      interval: 1,
      weekdays: [],
      until: null,
      count: null,
    });
    const ended = JSON.stringify({
      frequency: 'daily',
      interval: 1,
      weekdays: [],
      until: null,
      count: 2,
    });
    const insert = db.sqlite.prepare(
      'INSERT INTO planner_time_block_series(id,start_date,start_time,end_time,title,recurrence_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    );
    insert.run(
      'ongoing-google',
      '2026-09-01',
      '19:00',
      '20:00',
      'Plano contínuo',
      daily,
      stamp,
      stamp,
    );
    insert.run(
      'ended-google',
      '2026-09-01',
      '20:00',
      '21:00',
      'Plano encerrado',
      ended,
      stamp,
      stamp,
    );
    const sync = new GoogleSync(db.connection, new FakeGoogle());
    const candidates = await collectGoogleCandidates(
      db.connection,
      await sync.settings(),
      'America/Sao_Paulo',
      '2026-10-01',
      '2026-10-31',
    );
    expect(
      candidates.find((item) => item.entityId === 'ongoing-google')?.event.start.dateTime,
    ).toBe('2026-10-01T19:00:00');
    expect(candidates.some((item) => item.entityId === 'ended-google')).toBe(false);
  });

  it('espelha Task recorrente anterior ao período com dias personalizados e Time Block como exceção', async () => {
    const db = setup();
    db.sqlite
      .prepare(
        'INSERT INTO tasks(id,title,due_date,due_time,recurrence,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'recurring-task',
        'Praticar',
        '2026-09-01',
        '18:00',
        JSON.stringify({ frequency: 'weekdays', weekdays: [1, 3, 5] }),
        stamp,
        stamp,
      );
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        'practice-block',
        '2026-10-02',
        '18:00',
        '19:00',
        'task',
        'recurring-task',
        stamp,
        stamp,
      );
    const sync = new GoogleSync(db.connection, new FakeGoogle());
    const candidates = await collectGoogleCandidates(
      db.connection,
      await sync.settings(),
      'America/Sao_Paulo',
      '2026-10-01',
      '2026-10-31',
    );
    const recurring = candidates.find(
      (item) => item.entityId === 'recurring-task' && item.entityType === 'task',
    );
    expect(recurring?.event.start.dateTime).toBe('2026-10-02T18:00:00');
    expect(recurring?.event.recurrence).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR');
    expect(recurring?.event.recurrence).toContain('EXDATE;TZID=America/Sao_Paulo:20261002T180000');
  });

  it('faz create idempotente, patch após edição, retry offline e delete depois da remoção local', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    fake.failure = new GoogleClientError('network');
    await sync.process(10, undefined, new Date('2026-10-01T13:00:00Z'));
    expect(fake.creates).toBe(0);
    expect((await sync.counts()).pending).toBe(1);
    fake.failure = null;
    await sync.process(10, undefined, new Date('2026-10-02T13:00:00Z'));
    expect(fake.creates).toBe(1);
    await sync.reconcile();
    await sync.process();
    expect(fake.creates).toBe(1);
    db.sqlite
      .prepare('UPDATE tasks SET title=?,updated_at=? WHERE id=?')
      .run('Consulta alterada', '2026-10-02T13:00:00Z', 'task-google');
    await sync.reconcile();
    await sync.process();
    expect(fake.patches).toBe(1);
    expect(fake.creates).toBe(1);
    db.sqlite.prepare('DELETE FROM tasks WHERE id=?').run('task-google');
    fake.failure = new GoogleClientError('network');
    await sync.process();
    expect(fake.deletes).toBe(0);
    fake.failure = null;
    await sync.process(10, undefined, new Date(Date.now() + 3_600_000));
    expect(fake.deletes).toBe(1);
    expect(fake.events.size).toBe(0);
  });

  it('requer reconexão sem apagar a fila quando a credencial foi revogada', async () => {
    const db = setup();
    task(db);
    const fake = new FakeGoogle();
    fake.credential = false;
    const sync = new GoogleSync(db.connection, fake);
    await sync.reconcile();
    await sync.process();
    expect((await sync.settings()).state).toBe('reconnect');
    expect((await sync.counts()).pending).toBe(1);
  });

  it('não apaga evento apenas porque o usuário reduziu a janela futura; ocultação explícita remove', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    db.sqlite
      .prepare(
        'INSERT INTO tasks(id,title,due_date,due_time,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('future-task', 'Compromisso distante', '2026-11-20', '14:30', stamp, stamp);
    await sync.reconcile('2026-10-01', '2026-12-01');
    await sync.process();
    expect(fake.creates).toBe(1);
    db.sqlite.exec('UPDATE google_calendar_settings SET sync_horizon_days=30');
    await sync.enqueue({ entityType: 'task', entityId: 'future-task', occurrenceKey: '' });
    await sync.process();
    expect(fake.deletes).toBe(0);
    expect(fake.events.size).toBe(1);
    db.sqlite
      .prepare(
        'INSERT INTO calendar_visibility_overrides(entity_type,entity_id,visible) VALUES(?,?,0)',
      )
      .run('task', 'future-task');
    await sync.reconcile();
    await sync.process();
    expect(fake.deletes).toBe(1);
    expect(fake.events.size).toBe(0);
  });

  it('substitui o espelho de Task pelo Time Block quando o planejamento ganha horário próprio', async () => {
    const db = setup();
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    task(db);
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_blocks(id,block_date,start_time,end_time,entity_type,entity_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('task-block-later', '2026-10-16', '14:30', '15:00', 'task', 'task-google', stamp, stamp);
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].extendedProperties.private.rumo_entity_type).toBe('block');
    db.sqlite.prepare('DELETE FROM planner_time_blocks WHERE id=?').run('task-block-later');
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].extendedProperties.private.rumo_entity_type).toBe('task');
  });

  it('troca a Routine recorrente por série de blocos sem manter dois owners remotos', async () => {
    const db = setup();
    db.sqlite
      .prepare(
        'INSERT INTO routines(id,name,frequency,weekdays,time_of_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('routine-series', 'Estudar', 'daily', '[]', '18:00', stamp, stamp);
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    await sync.reconcile();
    await sync.process();
    expect([...fake.events.values()][0].extendedProperties.private.rumo_entity_type).toBe(
      'routine',
    );
    db.sqlite
      .prepare(
        'INSERT INTO planner_time_block_series(id,start_date,start_time,end_time,entity_type,entity_id,recurrence_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'routine-block-series',
        '2026-10-01',
        '18:00',
        '19:00',
        'routine',
        'routine-series',
        JSON.stringify({ frequency: 'daily', interval: 1, weekdays: [], until: null, count: null }),
        stamp,
        stamp,
      );
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].extendedProperties.private.rumo_entity_type).toBe(
      'block_series',
    );
    db.sqlite
      .prepare('DELETE FROM planner_time_block_series WHERE id=?')
      .run('routine-block-series');
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    expect([...fake.events.values()][0].extendedProperties.private.rumo_entity_type).toBe(
      'routine',
    );
  });

  it('reagenda HTTP 429 e recria evento remoto ausente no PATCH', async () => {
    const db = setup();
    task(db);
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    await sync.reconcile();
    fake.failure = new GoogleClientError('rate_limit');
    await sync.process(10, undefined, new Date('2026-10-01T13:00:00Z'));
    const retry = db.sqlite
      .prepare('SELECT status,next_attempt_at FROM google_calendar_sync_queue')
      .get() as { status: string; next_attempt_at: string };
    expect(retry.status).toBe('retry');
    expect(retry.next_attempt_at > '2026-10-01T13:00:00Z').toBe(true);
    fake.failure = null;
    await sync.process(10, undefined, new Date('2026-10-02T13:00:00Z'));
    const [remoteId] = fake.events.keys();
    fake.events.delete(remoteId);
    db.sqlite
      .prepare('UPDATE tasks SET title=?,updated_at=? WHERE id=?')
      .run('Consulta remarcada', '2026-10-02T13:00:00Z', 'task-google');
    await sync.process();
    expect(fake.creates).toBe(2);
    expect(fake.events.size).toBe(1);
  });

  it('desativar o espelho de uma rotina remove só o evento remoto e preserva a rotina local', async () => {
    const db = setup();
    db.sqlite
      .prepare(
        'INSERT INTO routines(id,name,frequency,weekdays,time_of_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('routine-local', 'Rotina da noite', 'daily', '[]', '20:00', stamp, stamp);
    const fake = new FakeGoogle();
    const sync = new GoogleSync(db.connection, fake);
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(1);
    db.sqlite
      .prepare(
        'INSERT INTO google_calendar_item_preferences(entity_type,entity_id,enabled) VALUES(?,?,0)',
      )
      .run('routine', 'routine-local');
    await sync.reconcile();
    await sync.process();
    expect(fake.events.size).toBe(0);
    expect(db.sqlite.prepare('SELECT name FROM routines WHERE id=?').get('routine-local')).toEqual({
      name: 'Rotina da noite',
    });
  });

  it('a exportação portátil usa allowlist e não inclui credenciais ou tabelas internas Google', async () => {
    const queried: string[] = [];
    const db: SqlConnection = {
      async select<T>(query: string) {
        queried.push(query);
        return (query.includes('MAX(version)') ? [{ version: 27 }] : []) as T;
      },
      async execute() {
        return { rowsAffected: 0 };
      },
    };
    const exported = await portableJson(db);
    const text = JSON.stringify(exported);
    expect(queried.some((query) => query.includes('google_calendar_'))).toBe(false);
    expect(text).not.toContain('refresh_token');
    expect(text).not.toContain('access_token');
  });
});
