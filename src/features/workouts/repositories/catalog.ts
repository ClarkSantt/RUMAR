import type { SqlConnection } from '../../../lib/database/connection';
import type { Exercise, ExerciseInput, LoadType } from '../types';
export const loadTypes: LoadType[] = ['total', 'per_side', 'per_dumbbell', 'bodyweight', 'none'];
export function requiredName(value: string) {
  const name = value.trim();
  if (!name || Array.from(name).length > 500) throw Error('Informe um nome de até 500 caracteres.');
  return name;
}
function metadataList(value: string | undefined) {
  return JSON.stringify(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}
export class ExercisesRepository {
  constructor(private db: SqlConnection) {}
  list(search = '', muscleGroup = '', equipment = '', includeArchived = false, limit = -1) {
    return this.db.select<Exercise[]>(
      `SELECT * FROM exercises WHERE ($4=1 OR archived_at IS NULL) AND ($1='' OR instr(lower(name),lower($1))>0 OR instr(lower(aliases_json),lower($1))>0) AND ($2='' OR muscle_group=$2) AND ($3='' OR equipment=$3) ORDER BY name LIMIT $5`,
      [search.trim(), muscleGroup, equipment, Number(includeArchived), limit],
    );
  }
  async save(input: ExerciseInput, id?: string) {
    const name = requiredName(input.name);
    if (!loadTypes.includes(input.load_type)) throw Error('Tipo de carga inválido.');
    if (!input.muscle_group.trim() || !input.equipment.trim())
      throw Error('Informe grupo muscular e equipamento.');
    const key = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await this.db.execute(
      id
        ? 'UPDATE exercises SET name=$1,muscle_group=$2,equipment=$3,load_type=$4,notes=$5,updated_at=$6,aliases_json=$8,secondary_muscles_json=$9,movement_pattern=$10 WHERE id=$7'
        : 'INSERT INTO exercises(name,muscle_group,equipment,load_type,notes,created_at,updated_at,id,aliases_json,secondary_muscles_json,movement_pattern) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)',
      [
        name,
        input.muscle_group.trim(),
        input.equipment.trim(),
        input.load_type,
        input.notes,
        now,
        key,
        metadataList(input.aliases),
        metadataList(input.secondary_muscles),
        input.movement_pattern?.trim() ?? '',
      ],
    );
    if (!result.rowsAffected) throw Error('Exercício não encontrado.');
    return key;
  }
  async archive(id: string) {
    await this.db.execute('UPDATE exercises SET archived_at=$2,updated_at=$2 WHERE id=$1', [
      id,
      new Date().toISOString(),
    ]);
  }
}
