import type { SqlConnection } from '../../lib/database/connection';

export type VersionEntityType = 'thought' | 'project' | 'objective';
export interface EntityVersion {
  id: string;
  entity_type: VersionEntityType;
  entity_id: string;
  changed_fields: string;
  snapshot_json: string;
  created_at: string;
}

export class VersionsRepository {
  constructor(private readonly db: SqlConnection) {}

  list(type: VersionEntityType, entityId: string) {
    return this.db.select<EntityVersion[]>(
      `SELECT * FROM entity_versions WHERE entity_type=$1 AND entity_id=$2
       ORDER BY created_at DESC,id DESC LIMIT 50`,
      [type, entityId],
    );
  }

  async restore(version: EntityVersion, confirmed: boolean) {
    if (!confirmed) throw new Error('Confirme a restauração desta versão.');
    const now = new Date().toISOString();
    if (version.entity_type === 'thought') {
      const [current] = await this.db.select<{ title: string; content: string }[]>(
        'SELECT title,content FROM thoughts WHERE id=$1 AND deleted_at IS NULL',
        [version.entity_id],
      );
      if (current) {
        await this.db.execute(
          `INSERT INTO entity_versions(id,entity_type,entity_id,changed_fields,snapshot_json,created_at)
           VALUES($1,'thought',$2,'restore point',json_object('title',$3,'content',$4),$5)`,
          [crypto.randomUUID(), version.entity_id, current.title, current.content, now],
        );
      }
      await this.db.execute(
        `UPDATE thoughts SET title=json_extract($2,'$.title'),content=json_extract($2,'$.content'),updated_at=$3
         WHERE id=$1 AND deleted_at IS NULL`,
        [version.entity_id, version.snapshot_json, now],
      );
    } else if (version.entity_type === 'project') {
      await this.db.execute(
        `UPDATE projects SET name=json_extract($2,'$.name'),description=json_extract($2,'$.description'),
         start_date=json_extract($2,'$.start_date'),target_date=json_extract($2,'$.target_date'),updated_at=$3
         WHERE id=$1 AND deleted_at IS NULL`,
        [version.entity_id, version.snapshot_json, now],
      );
    } else {
      await this.db.execute(
        `UPDATE objectives SET name=json_extract($2,'$.name'),description=json_extract($2,'$.description'),
         horizon=json_extract($2,'$.horizon'),horizon_label=json_extract($2,'$.horizon_label'),
         target_date=json_extract($2,'$.target_date'),progress_strategy=json_extract($2,'$.progress_strategy'),
         progress_direction=json_extract($2,'$.progress_direction'),numeric_start=json_extract($2,'$.numeric_start'),
         numeric_current=json_extract($2,'$.numeric_current'),numeric_target=json_extract($2,'$.numeric_target'),
         numeric_unit=json_extract($2,'$.numeric_unit'),updated_at=$3
         WHERE id=$1 AND deleted_at IS NULL`,
        [version.entity_id, version.snapshot_json, now],
      );
    }
  }
}
