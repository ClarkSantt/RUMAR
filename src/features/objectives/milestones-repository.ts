import type { SqlConnection } from '../../lib/database/connection';
import { validDate } from '../../lib/dates';
import { parseMoney } from '../finance/domain';
import { parseLoad } from '../workouts/domain';
export function parseMilestoneValue(value: string, mode: MilestoneDraft['mode']) {
  return mode === 'financial_goal' ? parseMoney(value) / 100 : parseLoad(value);
}

export interface Milestone {
  id: string;
  objective_id: string;
  title: string;
  description: string;
  target_date: string | null;
  status: 'pending' | 'completed';
  sort_order: number;
  mode: 'manual' | 'financial_goal';
  target_value: number | null;
  unit: string;
  financial_goal_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  objective_name: string;
  effective_status: 'pending' | 'completed';
  achieved_date: string | null;
  hidden?: boolean;
}
export type MilestoneDraft = Pick<
  Milestone,
  'title' | 'description' | 'target_date' | 'mode' | 'target_value' | 'unit' | 'financial_goal_id'
>;
export const emptyMilestone = (): MilestoneDraft => ({
  title: '',
  description: '',
  target_date: null,
  mode: 'manual',
  target_value: null,
  unit: '',
  financial_goal_id: null,
});

// A financial milestone is a read model, not a stored completion. Corrections to contributions
// therefore update status and the first crossing date without stale cached metrics.
export const milestoneReadSql = `WITH contribution_totals AS (
 SELECT c.goal_id,c.date,c.id,SUM(c.amount_cents) OVER(PARTITION BY c.goal_id ORDER BY c.date,c.id ROWS UNBOUNDED PRECEDING) total
 FROM finance_goal_contributions c
), goal_totals AS (
 SELECT g.id,g.initial_amount_cents+COALESCE(SUM(c.amount_cents),0) current,g.initial_amount_cents,g.created_at
 FROM finance_goals g LEFT JOIN finance_goal_contributions c ON c.goal_id=g.id GROUP BY g.id
), milestone_read AS (
 SELECT m.*,o.name objective_name,
 CASE WHEN m.mode='manual' THEN m.status WHEN g.current>=ROUND(m.target_value*100) THEN 'completed' ELSE 'pending' END effective_status,
 CASE WHEN m.mode='manual' THEN date(m.completed_at,'localtime')
 WHEN g.current>=ROUND(m.target_value*100) THEN CASE WHEN g.initial_amount_cents>=ROUND(m.target_value*100) THEN date(g.created_at,'localtime')
 ELSE (SELECT MIN(c.date) FROM contribution_totals c WHERE c.goal_id=g.id AND g.initial_amount_cents+c.total>=ROUND(m.target_value*100)) END ELSE NULL END achieved_date
 FROM objective_milestones m JOIN objectives o ON o.id=m.objective_id LEFT JOIN goal_totals g ON g.id=m.financial_goal_id
)`;

export class MilestonesRepository {
  constructor(private db: SqlConnection) {}
  async privacy() {
    const rows = await this.db.select<{ hidden: number }[]>(
      `SELECT CASE WHEN (SELECT hide_values FROM finance_preferences WHERE id=1)=1 OR (SELECT value FROM settings WHERE key='timeline_private')='1' THEN 1 ELSE 0 END hidden`,
    );
    return Boolean(rows[0]?.hidden);
  }
  async redact(rows: Milestone[]) {
    if (!(await this.privacy())) return rows;
    return rows.map((m) =>
      m.mode === 'financial_goal' || m.unit === 'BRL'
        ? {
            ...m,
            title: 'Marco financeiro',
            description: '',
            target_value: null,
            unit: '',
            hidden: true,
          }
        : m,
    );
  }
  async list(objectiveId: string) {
    return this.redact(
      await this.db.select<Milestone[]>(
        `${milestoneReadSql} SELECT * FROM milestone_read WHERE objective_id=$1 ORDER BY sort_order,id`,
        [objectiveId],
      ),
    );
  }
  async completedRange(start: string, end: string) {
    return this.redact(
      await this.db.select<Milestone[]>(
        `${milestoneReadSql} SELECT * FROM milestone_read WHERE effective_status='completed' AND achieved_date BETWEEN $1 AND $2 ORDER BY achieved_date DESC,sort_order LIMIT 100`,
        [start, end],
      ),
    );
  }
  async deadlines(start: string, end: string) {
    return this.redact(
      await this.db.select<Milestone[]>(
        `${milestoneReadSql} SELECT * FROM milestone_read WHERE target_date BETWEEN $1 AND $2 AND objective_id IN(SELECT id FROM objectives WHERE status!='archived') ORDER BY target_date,sort_order`,
        [start, end],
      ),
    );
  }
  async next() {
    return this.redact(
      await this.db.select<Milestone[]>(
        `${milestoneReadSql} SELECT * FROM milestone_read WHERE effective_status='pending' AND objective_id IN(SELECT id FROM objectives WHERE status='active') ORDER BY COALESCE(target_date,'9999-12-31'),sort_order LIMIT 3`,
      ),
    );
  }
  async save(objectiveId: string, draft: MilestoneDraft, id?: string) {
    if (
      !draft.title.trim() ||
      draft.title.trim().length > 160 ||
      draft.description.length > 2000 ||
      (draft.target_date && !validDate(draft.target_date)) ||
      !['manual', 'financial_goal'].includes(draft.mode) ||
      draft.unit.length > 40 ||
      (draft.target_value !== null &&
        (!Number.isFinite(draft.target_value) ||
          draft.target_value <= 0 ||
          draft.target_value >= 1e9))
    )
      throw Error('Dados do marco inválidos.');
    if (draft.mode === 'financial_goal') {
      if (!draft.financial_goal_id || draft.target_value === null || draft.unit !== 'BRL')
        throw Error('Escolha uma meta financeira e um valor alvo em reais.');
      const goal = await this.db.select<{ id: string }[]>(
        'SELECT id FROM finance_goals WHERE id=$1',
        [draft.financial_goal_id],
      );
      if (!goal.length) throw Error('Meta financeira não encontrada.');
    }
    const key = id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    const args = [
      key,
      objectiveId,
      draft.title.trim(),
      draft.description.trim(),
      draft.target_date,
      draft.mode,
      draft.target_value,
      draft.unit.trim(),
      draft.mode === 'financial_goal' ? draft.financial_goal_id : null,
      now,
    ];
    if (id)
      await this.db.execute(
        `UPDATE objective_milestones SET title=$3,description=$4,target_date=$5,mode=$6,target_value=$7,unit=$8,financial_goal_id=$9,status=CASE WHEN mode!=$6 THEN 'pending' ELSE status END,completed_at=CASE WHEN mode!=$6 THEN NULL ELSE completed_at END,updated_at=$10 WHERE id=$1 AND objective_id=$2`,
        args,
      );
    else
      await this.db.execute(
        `INSERT INTO objective_milestones(id,objective_id,title,description,target_date,mode,target_value,unit,financial_goal_id,created_at,updated_at,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,COALESCE((SELECT MAX(sort_order)+1 FROM objective_milestones WHERE objective_id=$2),0))`,
        args,
      );
    return key;
  }
  async complete(id: string, completed: boolean) {
    await this.db.execute(
      `UPDATE objective_milestones SET status=$2,completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,$3) ELSE NULL END,updated_at=$3 WHERE id=$1 AND mode='manual'`,
      [id, completed ? 'completed' : 'pending', new Date().toISOString()],
    );
  }
  async move(id: string, direction: -1 | 1) {
    // Renumber the whole objective atomically; deletions may leave gaps in old sort orders.
    await this.db.execute(
      `WITH positions AS(SELECT id,ROW_NUMBER() OVER(ORDER BY sort_order,id)-1 position FROM objective_milestones WHERE objective_id=(SELECT objective_id FROM objective_milestones WHERE id=$1)), source AS(SELECT position FROM positions WHERE id=$1) UPDATE objective_milestones SET sort_order=CASE WHEN id=$1 THEN (SELECT position FROM source)+$2 WHEN (SELECT position FROM positions WHERE positions.id=objective_milestones.id)=(SELECT position FROM source)+$2 THEN (SELECT position FROM source) ELSE (SELECT position FROM positions WHERE positions.id=objective_milestones.id) END,updated_at=$3 WHERE id IN(SELECT id FROM positions) AND EXISTS(SELECT 1 FROM positions WHERE position=(SELECT position FROM source)+$2)`,
      [id, direction, new Date().toISOString()],
    );
  }
  async place(id: string, targetId: string) {
    await this.db.execute(
      `WITH positions AS(SELECT id,ROW_NUMBER() OVER(ORDER BY sort_order,id)-1 position FROM objective_milestones WHERE objective_id=(SELECT objective_id FROM objective_milestones WHERE id=$1)), source AS(SELECT position FROM positions WHERE id=$1), target AS(SELECT position FROM positions WHERE id=$2) UPDATE objective_milestones SET sort_order=CASE WHEN id=$1 THEN (SELECT position FROM target) WHEN (SELECT position FROM source)<(SELECT position FROM target) AND (SELECT position FROM positions WHERE positions.id=objective_milestones.id) BETWEEN (SELECT position FROM source)+1 AND (SELECT position FROM target) THEN (SELECT position FROM positions WHERE positions.id=objective_milestones.id)-1 WHEN (SELECT position FROM source)>(SELECT position FROM target) AND (SELECT position FROM positions WHERE positions.id=objective_milestones.id) BETWEEN (SELECT position FROM target) AND (SELECT position FROM source)-1 THEN (SELECT position FROM positions WHERE positions.id=objective_milestones.id)+1 ELSE (SELECT position FROM positions WHERE positions.id=objective_milestones.id) END,updated_at=$3 WHERE id IN(SELECT id FROM positions) AND EXISTS(SELECT 1 FROM target)`,
      [id, targetId, new Date().toISOString()],
    );
  }
  remove(id: string) {
    return this.db.execute('DELETE FROM objective_milestones WHERE id=$1', [id]);
  }
}
