import type { SqlConnection } from '../../lib/database/connection';

export type TrashEntityType = 'task' | 'project' | 'objective' | 'thought';
export interface TrashItem {
  id: string;
  entity_type: TrashEntityType;
  name: string;
  deleted_at: string;
}

const tables: Record<TrashEntityType, string> = {
  task: 'tasks',
  project: 'projects',
  objective: 'objectives',
  thought: 'thoughts',
};

export class TrashRepository {
  constructor(private readonly db: SqlConnection) {}

  list() {
    return this.db.select<TrashItem[]>(
      `SELECT id,'task' entity_type,title name,deleted_at FROM tasks WHERE deleted_at IS NOT NULL
       UNION ALL SELECT id,'project',name,deleted_at FROM projects WHERE deleted_at IS NOT NULL
       UNION ALL SELECT id,'objective',name,deleted_at FROM objectives WHERE deleted_at IS NOT NULL
       UNION ALL SELECT id,'thought',COALESCE(NULLIF(title,''),'Pensamento sem título'),deleted_at FROM thoughts WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC,id`,
    );
  }

  async trash(type: TrashEntityType, id: string, deleted = true) {
    await this.db.execute(`UPDATE ${tables[type]} SET deleted_at=$2,updated_at=$3 WHERE id=$1`, [
      id,
      deleted ? new Date().toISOString() : null,
      new Date().toISOString(),
    ]);
  }

  async permanentlyDelete(type: TrashEntityType, id: string, confirmed: boolean) {
    if (!confirmed) throw new Error('Confirme a exclusão permanente.');
    const result = await this.db.execute(
      `DELETE FROM ${tables[type]} WHERE id=$1 AND deleted_at IS NOT NULL`,
      [id],
    );
    if (!result.rowsAffected) throw new Error('O item não está na Lixeira.');
  }
}
