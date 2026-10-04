import { describe, expect, it } from 'vitest';
import { database } from './database';
import {
  bodyRows,
  datePt,
  decimalPt,
  financeRows,
  parseCsv,
  parseIcs,
  probableFinanceDuplicates,
  resolveFinanceRows,
  validateBodyCsv,
  validateFinanceCsv,
} from '../src/features/data/import';
import { calendarRange } from '../src/features/calendar/repository';
import { CalendarPreferences } from '../src/features/calendar/preferences';

const stamp = '2026-09-29T12:00:00Z';
function batch(
  sqlite: ReturnType<typeof database>['sqlite'],
  kind: string,
  rows: unknown[],
  account: string | null = null,
  hash = 'a'.repeat(64),
  policy: 'update' | 'skip' = 'update',
) {
  sqlite
    .prepare(
      `INSERT INTO data_import_batches(id,kind,file_name,file_hash,account_id,row_count,imported_at,payload_json,conflict_policy)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      crypto.randomUUID(),
      kind,
      'fixture.csv',
      hash,
      account,
      rows.length,
      stamp,
      JSON.stringify(rows),
      policy,
    );
}

describe('importação local e transacional', () => {
  it('CSV reconhece aspas, quebra de linha e valores pt-BR sem perder centavos', () => {
    const rows = parseCsv(
      '\uFEFFdata;descrição;valor\r\n29/09/2026;"Mercado; bairro";83,40\r\n30/09/2026;"Linha\n2";1.234,56\r\n',
    );
    expect(rows).toEqual([
      ['data', 'descrição', 'valor'],
      ['29/09/2026', 'Mercado; bairro', '83,40'],
      ['30/09/2026', 'Linha\n2', '1.234,56'],
    ]);
    expect(decimalPt('1.234,56')).toBe(1234.56);
    expect(datePt('29/09/2026')).toBe('2026-09-29');
    expect(
      financeRows(rows, { date: 0, description: 1, amount: 2 }, 'expense').map(
        (r) => r.amount_cents,
      ),
    ).toEqual([8340, 123456]);
    expect(() => parseCsv('a;b\n"sem fechamento')).toThrow();
    expect(() => datePt('31/02/2026')).toThrow();
    expect(() =>
      financeRows(
        parseCsv('data;descrição;valor;tipo\n29/09/2026;Mercado;83,40;transferência'),
        { date: 0, description: 1, amount: 2, type: 3 },
        'expense',
      ),
    ).toThrow('Tipo financeiro desconhecido');
  });
  it('Finance CSV insere lote inteiro ou nada, com histórico e hash antirreimportação', () => {
    const { sqlite } = database();
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('account', 'Conta', 'checking', stamp, stamp);
    const rows = financeRows(
      parseCsv('data;descrição;valor\n29/09/2026;Mercado;83,40\n29/09/2026;Salário;2800,00'),
      { date: 0, description: 1, amount: 2 },
      'expense',
    );
    batch(sqlite, 'finance_csv', rows, 'account');
    expect(
      sqlite.prepare('SELECT amount_cents FROM finance_transactions ORDER BY amount_cents').all(),
    ).toEqual([{ amount_cents: 8340 }, { amount_cents: 280000 }]);
    expect(sqlite.prepare('SELECT payload_json FROM data_import_batches').get()).toEqual({
      payload_json: '[]',
    });
    expect(() => batch(sqlite, 'finance_csv', rows, 'account')).toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) n FROM finance_transactions').get()).toEqual({ n: 2 });
    const bad = [...rows, { ...rows[0], id: crypto.randomUUID(), amount_cents: 0 }];
    expect(() => batch(sqlite, 'finance_csv', bad, 'account', 'b'.repeat(64))).toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) n FROM finance_transactions').get()).toEqual({ n: 2 });
    sqlite.close();
  });
  it('Finance CSV mapeia conta e categoria existentes sem criar entidades implícitas', () => {
    const { sqlite } = database();
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('default-account', 'Padrão', 'checking', stamp, stamp);
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('bank-account', 'Banco Ágil', 'checking', stamp, stamp);
    sqlite
      .prepare(
        'INSERT INTO finance_categories(id,name,kind,created_at,updated_at) VALUES(?,?,?,?,?)',
      )
      .run('market-category', 'Alimentação', 'expense', stamp, stamp);
    const values = resolveFinanceRows(
      financeRows(
        parseCsv(
          'data;descrição;valor;conta;categoria\n29/09/2026;Mercado;83,40;Banco Agil;Alimentacao',
        ),
        { date: 0, description: 1, amount: 2, account: 3, category: 4 },
        'expense',
      ),
      [
        { id: 'default-account', name: 'Padrão' },
        { id: 'bank-account', name: 'Banco Ágil' },
      ],
      [{ id: 'market-category', name: 'Alimentação', kind: 'expense' }],
    );
    batch(sqlite, 'finance_csv', values, 'default-account');
    expect(sqlite.prepare('SELECT account_id,category_id FROM finance_transactions').get()).toEqual(
      { account_id: 'bank-account', category_id: 'market-category' },
    );
    expect(() =>
      resolveFinanceRows([{ ...values[0], account_name: 'Desconhecida' }], [], []),
    ).toThrow('conta não encontrada');
    sqlite.close();
  });
  it('sinaliza provável duplicata sem descartar linhas por coincidência de valor/data', () => {
    const incoming = financeRows(
      parseCsv('data;descrição;valor\n29/09/2026;Mercado;83,40\n29/09/2026;Farmácia;83,40'),
      { date: 0, description: 1, amount: 2 },
      'expense',
    );
    expect(
      probableFinanceDuplicates(
        incoming,
        [
          {
            date: '2026-09-29',
            amount_cents: 8340,
            normalized_description: 'MERCADO',
            account_id: 'account-1',
          },
        ],
        'account-1',
      ),
    ).toBe(1);
    expect(incoming).toHaveLength(2);
  });
  it('prévia separa linhas inválidas sem importá-las silenciosamente', () => {
    const finances = validateFinanceCsv(
      parseCsv('data;descrição;valor\n29/09/2026;Mercado;83,40\n31/02/2026;Inválida;10,00'),
      { date: 0, description: 1, amount: 2 },
      'expense',
      [],
      [],
    );
    expect(finances.values).toHaveLength(1);
    expect(finances.issues).toHaveLength(1);
    expect(finances.issues[0]).toContain('Linha 3');
    const body = validateBodyCsv(
      parseCsv('date;weight_kg\n2026-09-29;90,8\n2026-09-29;91\n2026-09-30;88'),
    );
    expect(body.values).toHaveLength(2);
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toContain('Data repetida');
  });
  it('Body CSV atualiza apenas métricas presentes e preserva medidas ausentes', () => {
    const { sqlite } = database();
    const first = bodyRows(parseCsv('date;weight_kg;waist_cm\n2026-09-29;90,8;91,5'));
    batch(sqlite, 'body_csv', first);
    const next = bodyRows(parseCsv('date;weight_kg\n2026-09-29;90,2'));
    batch(sqlite, 'body_csv', next, null, 'b'.repeat(64));
    expect(
      sqlite
        .prepare('SELECT metric_key,value FROM body_measurement_values ORDER BY metric_key')
        .all(),
    ).toEqual([
      { metric_key: 'waist', value: 91.5 },
      { metric_key: 'weight', value: 90.2 },
    ]);
    expect(() => bodyRows(parseCsv('date;weight_kg\n2026-09-29;90\n2026-09-29;91'))).toThrow(
      'duplicada',
    );
    sqlite.close();
  });
  it('ICS cria evento externo, atualiza por UID e respeita filtro persistido', async () => {
    const { sqlite, connection } = database();
    const first = parseIcs(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc@teste\r\nSUMMARY:Consulta\\, anual\r\nDTSTART;VALUE=DATE:20261002\r\nDTEND;VALUE=DATE:20261003\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    );
    batch(sqlite, 'calendar_ics', first);
    expect(sqlite.prepare('SELECT summary,start_date FROM external_calendar_events').all()).toEqual(
      [{ summary: 'Consulta, anual', start_date: '2026-10-02' }],
    );
    batch(
      sqlite,
      'calendar_ics',
      [
        {
          ...first[0],
          id: crypto.randomUUID(),
          summary: 'Consulta remarcada',
          start_date: '2026-10-04',
          end_date: '2026-10-05',
        },
      ],
      null,
      'b'.repeat(64),
    );
    expect(sqlite.prepare('SELECT summary,start_date FROM external_calendar_events').all()).toEqual(
      [{ summary: 'Consulta remarcada', start_date: '2026-10-04' }],
    );
    expect(
      (await calendarRange(connection, '2026-10-01', '2026-10-07')).some(
        (row) => row.name === 'Consulta remarcada',
      ),
    ).toBe(true);
    await new CalendarPreferences(connection).source('external', false);
    expect(
      (await calendarRange(connection, '2026-10-01', '2026-10-07')).some(
        (row) => row.kind === 'external',
      ),
    ).toBe(false);
    await new CalendarPreferences(connection).source('external', true);
    expect(
      (await calendarRange(connection, '2026-10-01', '2026-10-07')).some(
        (row) => row.kind === 'external',
      ),
    ).toBe(true);
    expect(() =>
      parseIcs(
        'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:Recorrente\nDTSTART:20261002\nRRULE:FREQ=DAILY\nEND:VEVENT\nEND:VCALENDAR',
      ),
    ).toThrow('Recorrência');
    sqlite.close();
  });
  it('política ignorar preserva Body Progress e eventos ICS existentes', () => {
    const { sqlite } = database();
    const body = bodyRows(parseCsv('date;weight_kg\n2026-09-29;90,8'));
    batch(sqlite, 'body_csv', body);
    batch(
      sqlite,
      'body_csv',
      [{ ...body[0], id: crypto.randomUUID(), metrics: { weight: 88 } }],
      null,
      'b'.repeat(64),
      'skip',
    );
    expect(
      sqlite.prepare("SELECT value FROM body_measurement_values WHERE metric_key='weight'").get(),
    ).toEqual({ value: 90.8 });
    const event = parseIcs(
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:skip-test\nSUMMARY:Original\nDTSTART;VALUE=DATE:20261002\nEND:VEVENT\nEND:VCALENDAR',
    );
    batch(sqlite, 'calendar_ics', event);
    batch(
      sqlite,
      'calendar_ics',
      [{ ...event[0], id: crypto.randomUUID(), summary: 'Alterado' }],
      null,
      'c'.repeat(64),
      'skip',
    );
    expect(
      sqlite.prepare("SELECT summary FROM external_calendar_events WHERE uid='skip-test'").get(),
    ).toEqual({ summary: 'Original' });
    sqlite.close();
  });
});
