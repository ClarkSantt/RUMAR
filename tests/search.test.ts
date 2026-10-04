import { describe, expect, it } from 'vitest';
import { database } from './database';
import { globalSearch } from '../src/features/search/repository';

describe('busca global', () => {
  it('agrupa resultados reais, limita cada origem e não expõe quantias financeiras', async () => {
    const { sqlite, connection } = database();
    const date = '2026-09-27T12:00:00Z';
    sqlite
      .prepare('INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?,?,?,?)')
      .run('t1', 'Comprar guitarra', date, date);
    sqlite
      .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
      .run('p1', 'Aprender guitarra', date, date);
    sqlite
      .prepare(
        'INSERT INTO habits(id,name,kind,frequency,start_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run('h1', 'Praticar guitarra', 'boolean', 'daily', '2026-09-27', date, date);
    sqlite
      .prepare('INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('th1', 'Ideias sobre guitarra', 'conteúdo privado', date, date);
    sqlite
      .prepare(
        "INSERT INTO finance_accounts(id,name,type,currency,created_at,updated_at) VALUES('a1','Conta','checking','BRL',?,?)",
      )
      .run(date, date);
    sqlite
      .prepare(
        "INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at) VALUES('f1','a1','2026-09-27',92738,'expense','Loja guitarra','LOJA GUITARRA',?,?)",
      )
      .run(date, date);
    sqlite.exec('UPDATE finance_preferences SET hide_values=1 WHERE id=1');
    const results = await globalSearch(connection, 'guitarra');
    expect(results.map((row) => row.group)).toEqual([
      'Tarefas',
      'Projetos',
      'Hábitos',
      'Pensamentos',
      'Transações',
    ]);
    expect(JSON.stringify(results)).not.toContain('92738');
    expect(JSON.stringify(results)).not.toContain('927,38');
    expect(results.at(-1)?.title).toBe('Transação financeira');
    sqlite
      .prepare("UPDATE finance_transactions SET description='Loja guitarra 927,38' WHERE id='f1'")
      .run();
    expect(JSON.stringify(await globalSearch(connection, 'guitarra'))).not.toContain('927,38');
    expect(await globalSearch(connection, 'g')).toEqual([]);
    sqlite.close();
  });
  it('encontra nomes de anexos e não revela o nome financeiro quando valores estão ocultos', async () => {
    const { sqlite, connection } = database();
    const date = '2026-09-29T12:00:00Z';
    sqlite
      .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
      .run('p1', 'Projeto', date, date);
    sqlite
      .prepare('INSERT INTO finance_accounts(id,name,type,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('a1', 'Conta', 'checking', date, date);
    sqlite
      .prepare(
        `INSERT INTO finance_transactions(id,account_id,date,amount_cents,transaction_type,description,normalized_description,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run('f1', 'a1', '2026-09-29', 5000, 'expense', 'Teste', 'teste', date, date);
    const add =
      sqlite.prepare(`INSERT INTO attachments(id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [id, type, target, name] of [
      ['11111111-1111-4111-8111-111111111111', 'project', 'p1', 'briefing-roteiro.pdf'],
      [
        '22222222-2222-4222-8222-222222222222',
        'finance_transaction',
        'f1',
        'nota-roteiro-50,00.pdf',
      ],
    ])
      add.run(
        id,
        type,
        target,
        name,
        'file.pdf',
        `attachments/${id}/file.pdf`,
        'application/pdf',
        20,
        'a'.repeat(64),
        date,
        date,
      );
    const normal = await globalSearch(connection, 'roteiro');
    expect(normal.filter((r) => r.group === 'Anexos').map((r) => r.contextId)).toEqual(['p1']);
    expect(normal.find((r) => r.page === 'finance')?.title).toBe('nota-roteiro-50,00.pdf');
    sqlite.exec('UPDATE finance_preferences SET hide_values=1 WHERE id=1');
    const privateResults = await globalSearch(connection, 'roteiro');
    expect(privateResults.find((r) => r.page === 'finance')).toBeUndefined();
    expect(JSON.stringify(privateResults)).not.toContain('50,00');
    sqlite.close();
  });
});
