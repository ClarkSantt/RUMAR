import { describe, expect, it } from 'vitest';
import { database } from './database';
import { calendarIcs, csv, exportCalendar, exportCsv } from '../src/features/data/export';
import { portableJson } from '../src/features/data/json-export';
import { BlockSeriesRepository } from '../src/features/calendar/block-series-repository';

describe('exportação portátil', () => {
  it('CSV preserva acentos, aspas, quebras e neutraliza fórmulas de planilha', () => {
    expect(
      csv(
        ['descrição', 'valor'],
        [
          ['Café; "açúcar"\nnovo', '=1+1'],
          ['seguro', '@SUM(A1)'],
        ],
      ),
    ).toBe(
      '\uFEFF"descrição";"valor"\r\n"Café; ""açúcar""\nnovo";"\'=1+1"\r\n"seguro";"\'@SUM(A1)"\r\n',
    );
  });
  it('Tasks e Finance CSV usam relações reais e preservam centavos', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-09-29T12:00:00Z';
    sqlite
      .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
      .run('project-1', 'Café; saúde', stamp, stamp);
    sqlite
      .prepare(
        'INSERT INTO tasks(id,title,due_date,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('task-1', 'Comprar "aveia"', '2026-09-29', 'project-1', stamp, stamp);
    const tasks = await exportCsv(connection, 'tasks', '2026-09-01', '2026-09-30');
    expect(tasks).toContain('"Comprar ""aveia"""');
    expect(tasks).toContain('"Café; saúde"');
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('account-1', 'Conta', 'checking', stamp, stamp);
    sqlite
      .prepare(
        `INSERT INTO finance_transactions
      (id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'transaction-1',
        'account-1',
        '2026-09-29',
        8340,
        'expense',
        'Mercado',
        'mercado',
        stamp,
        stamp,
      );
    const finance = await exportCsv(connection, 'finance', '2026-09-01', '2026-09-30');
    expect(finance).toContain('"83,40"');
    expect(finance).toContain('"Mercado"');
    sqlite.close();
  });
  it('ICS escapa texto e diferencia evento de dia inteiro', () => {
    const result = calendarIcs([
      { uid: 'task-1', summary: 'Pagar, luz; água\nhoje', start: '20260929', end: '20260930' },
    ]);
    expect(result).toContain('DTSTART;VALUE=DATE:20260929');
    expect(result).toContain('DTEND;VALUE=DATE:20260930');
    expect(result).toContain('SUMMARY:Pagar\\, luz\\; água\\nhoje');
    expect(result.endsWith('\r\n')).toBe(true);
  });
  it('JSON versionado preserva IDs e relações, sem embutir bytes dos anexos', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-10-01T12:00:00Z';
    sqlite
      .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
      .run('project-json', 'Projeto', stamp, stamp);
    sqlite
      .prepare('INSERT INTO tasks(id,title,project_id,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('task-json', 'Tarefa', 'project-json', stamp, stamp);
    sqlite.exec('CREATE TABLE _sqlx_migrations(version INTEGER, success INTEGER)');
    sqlite.exec('INSERT INTO _sqlx_migrations VALUES(24,1)');
    const result = await portableJson(connection);
    expect(result.exportVersion).toBe(1);
    expect(result.schemaVersion).toBe(24);
    expect(result.attachmentFilesIncluded).toBe(false);
    expect(result.data.organization.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'project-json' })]),
    );
    expect(result.data.organization.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-json', project_id: 'project-json' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('_sqlx_migrations');
    sqlite.close();
  });
  it('ICS inclui Time Blocks e respeita o filtro global do Calendar', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-10-01T12:00:00Z';
    sqlite
      .prepare(
        `INSERT INTO planner_time_blocks
      (id,block_date,start_time,end_time,title,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`,
      )
      .run('block-1', '2026-10-01', '10:00', '11:30', 'Estudar', stamp, stamp);
    const visible = await exportCalendar(connection, '2026-10-01', '2026-10-01');
    expect(visible).toContain('DTSTART:20261001T100000');
    expect(visible).toContain('DTEND:20261001T113000');
    expect(visible).toContain('SUMMARY:Estudar');
    sqlite
      .prepare(
        "INSERT INTO calendar_source_preferences(source_type,visible) VALUES('block',0) ON CONFLICT(source_type) DO UPDATE SET visible=0",
      )
      .run();
    expect(await exportCalendar(connection, '2026-10-01', '2026-10-01')).not.toContain(
      'SUMMARY:Estudar',
    );
    sqlite.close();
  });
  it('diário CSV usa colunas legíveis para macros e micros, sem JSON opaco', async () => {
    const { sqlite, connection } = database();
    const stamp = '2026-10-01T12:00:00Z';
    sqlite
      .prepare('INSERT INTO foods(id,source_id,name,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('food-csv', 'custom', 'Aveia', stamp, stamp);
    sqlite
      .prepare(
        `INSERT INTO food_diary_entries
      (id,entry_date,food_id,food_name,quantity,unit,grams_equivalent,nutrients_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        'diary-csv',
        '2026-10-01',
        'food-csv',
        'Aveia',
        40,
        'g',
        40,
        JSON.stringify({ energy_kcal: 150, protein_g: 6, iron_mg: 1.2 }),
        stamp,
        stamp,
      );
    const output = await exportCsv(connection, 'nutrition', '2026-10-01', '2026-10-01');
    expect(output).toContain('"iron_mg"');
    expect(output).toContain('"1,2"');
    expect(output).not.toContain('nutrients_json');
    sqlite.close();
  });
  it('ICS expande apenas as ocorrências de um bloco recorrente no período escolhido', async () => {
    const { sqlite, connection } = database();
    await new BlockSeriesRepository(connection).save(
      {
        block_date: '2026-10-01',
        start_time: '09:00',
        end_time: '09:30',
        entity_type: null,
        entity_id: null,
        occurrence_date: null,
        title: 'Planejar',
        notes: '',
        remind_minutes_before: null,
      },
      { frequency: 'daily', interval: 1, weekdays: [], until: null, count: null },
    );
    const ics = await exportCalendar(connection, '2026-10-01', '2026-10-03');
    expect(ics.match(/SUMMARY:Planejar/g) ?? []).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261003T090000');
    expect(ics).not.toContain('DTSTART:20261004T090000');
    sqlite.close();
  });
});
