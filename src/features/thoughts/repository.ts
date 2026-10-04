import type { SqlConnection } from '../../lib/database/connection';

export interface Thought {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export type ThoughtDraft = Pick<Thought, 'title' | 'content'>;
export class ThoughtsRepository {
  constructor(private db: SqlConnection) {}
  list(search = ''): Promise<Thought[]> {
    return this.db.select<Thought[]>(
      `SELECT id,title,substr(content,1,180) AS content,created_at,updated_at,archived_at
       FROM thoughts WHERE archived_at IS NULL AND
       ($1='' OR instr(lower(title),lower($1))>0 OR instr(lower(content),lower($1))>0)
       ORDER BY updated_at DESC,id LIMIT 100`,
      [search.trim()],
    );
  }
  async get(id: string): Promise<Thought> {
    const rows = await this.db.select<Thought[]>('SELECT * FROM thoughts WHERE id=$1', [id]);
    if (!rows[0]) throw new Error('Pensamento não encontrado.');
    return rows[0];
  }
  async create(): Promise<Thought> {
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.db.execute(
      'INSERT INTO thoughts(id,title,content,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
      [id, '', '', now],
    );
    return this.get(id);
  }
  async save(id: string, draft: ThoughtDraft): Promise<void> {
    const result = await this.db.execute(
      'UPDATE thoughts SET title=$2,content=$3,updated_at=$4 WHERE id=$1 AND archived_at IS NULL',
      [id, draft.title, draft.content, new Date().toISOString()],
    );
    if (!result.rowsAffected) throw new Error('Pensamento indisponível para salvar.');
  }
  async archive(id: string): Promise<void> {
    await this.db.execute('UPDATE thoughts SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      new Date().toISOString(),
    ]);
  }
  async convert(id: string, target: 'task' | 'project' | 'inbox'): Promise<string> {
    const destination = { task: 'tasks', project: 'projects', inbox: 'inbox_items' }[target];
    const newId = crypto.randomUUID(),
      now = new Date().toISOString();
    const title =
      "substr(CASE WHEN trim(title)<>'' THEN title WHEN trim(content)<>'' THEN content ELSE 'Sem título' END,1,500)";
    const description =
      'CASE WHEN length(title)>500 THEN title || char(10) || char(10) || content ELSE content END';
    const columns =
      target === 'inbox' ? 'content' : target === 'task' ? 'title,description' : 'name,description';
    const values =
      target === 'inbox'
        ? "CASE WHEN title<>'' THEN title || char(10) || char(10) || content ELSE content END"
        : `${title},${description}`;
    await this.db.execute(
      `INSERT INTO ${destination}(id,${columns},created_at,updated_at,source_thought_id)
      SELECT $2,${values},$3,$3,id FROM thoughts WHERE id=$1 AND archived_at IS NULL AND (trim(title)<>'' OR trim(content)<>'')
      ON CONFLICT(source_thought_id) DO NOTHING`,
      [id, newId, now],
    );
    const rows = await this.db.select<{ id: string }[]>(
      `SELECT id FROM ${destination} WHERE source_thought_id=$1`,
      [id],
    );
    if (!rows[0]) throw new Error('Escreva um pensamento antes de transformar.');
    return rows[0].id;
  }
}
