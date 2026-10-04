import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { database } from './database';

const date = '2026-09-29T12:00:00.000Z';
const projectId = 'project-test';
const thoughtId = 'thought-test';
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

function insertProject(sqlite: ReturnType<typeof database>['sqlite']) {
  sqlite
    .prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)')
    .run(projectId, 'Viagem', date, date);
}
function insertThought(sqlite: ReturnType<typeof database>['sqlite']) {
  sqlite
    .prepare('INSERT INTO thoughts(id,title,created_at,updated_at) VALUES(?,?,?,?)')
    .run(thoughtId, 'Ideia', date, date);
}
function add(
  sqlite: ReturnType<typeof database>['sqlite'],
  id: string,
  entityType: string,
  entityId: string,
  name = 'briefing.pdf',
) {
  sqlite
    .prepare(
      `INSERT INTO attachments
    (id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      entityType,
      entityId,
      name,
      'file.pdf',
      `attachments/${id}/file.pdf`,
      'application/pdf',
      42,
      'a'.repeat(64),
      date,
      date,
    );
}

describe('metadata de anexos', () => {
  it('atualiza schema 19 sem perder entidades anteriores', () => {
    const { sqlite } = database(':memory:', 19);
    insertProject(sqlite);
    insertThought(sqlite);
    sqlite.exec(`CREATE TEMP TABLE saved AS SELECT id,name FROM projects`);
    sqlite.exec(readFileSync('src-tauri/migrations/0020_attachments.sql', 'utf8'));
    expect(sqlite.prepare('SELECT * FROM saved').all()).toEqual([
      { id: projectId, name: 'Viagem' },
    ]);
    expect(sqlite.prepare('SELECT id FROM thoughts').all()).toEqual([{ id: thoughtId }]);
    add(sqlite, firstId, 'project', projectId);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 1 });
    sqlite.close();
  });

  it('valida entidade e caminho interno e permite nomes originais iguais', () => {
    const { sqlite } = database();
    insertProject(sqlite);
    add(sqlite, firstId, 'project', projectId);
    add(sqlite, secondId, 'project', projectId);
    expect(sqlite.prepare('SELECT original_name FROM attachments ORDER BY id').all()).toEqual([
      { original_name: 'briefing.pdf' },
      { original_name: 'briefing.pdf' },
    ]);
    expect(() =>
      add(sqlite, '33333333-3333-4333-8333-333333333333', 'project', 'missing'),
    ).toThrow();
    expect(() =>
      add(sqlite, '44444444-4444-4444-8444-444444444444', 'unknown', projectId),
    ).toThrow();
    expect(() =>
      sqlite
        .prepare('UPDATE attachments SET relative_path=? WHERE id=?')
        .run('../outside.pdf', firstId),
    ).toThrow();
    sqlite.close();
  });

  it('exclusão da entidade enfileira remoção física sem deixar vínculo órfão', () => {
    const { sqlite } = database();
    insertProject(sqlite);
    add(sqlite, firstId, 'project', projectId);
    sqlite.prepare('DELETE FROM projects WHERE id=?').run(projectId);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT relative_path FROM attachment_cleanup').all()).toEqual([
      { relative_path: `attachments/${firstId}/file.pdf` },
    ]);
    sqlite.close();
  });
});
