import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { ObjectivesRepository, type Objective } from './repository';
import { MilestonesRepository, type Milestone } from './milestones-repository';

export function HomeObjectives({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [rows, setRows] = useState<Objective[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  useEffect(() => {
    let active = true;
    void getDatabase()
      .then(async (db) => ({
        objectives: await new ObjectivesRepository(db).recent(2),
        milestones: await new MilestonesRepository(db).next(),
      }))
      .then((found) => {
        if (active) {
          setRows(found.objectives);
          setMilestones(found.milestones);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!rows.length) return null;
  return (
    <section className="secondary-section home-objectives">
      <div className="section-heading">
        <h2>Objetivos</h2>
        <span>{rows.length} em foco</span>
      </div>
      {rows.map((row) => (
        <button className="review-line" key={row.id} onClick={() => onNavigate(row.id)}>
          <strong>{row.name}</strong>
          <span>
            {milestones.find((m) => m.objective_id === row.id)
              ? `Próximo marco: ${milestones.find((m) => m.objective_id === row.id)!.title}`
              : 'Ver objetivo'}{' '}
            <ArrowRight size={14} />
          </span>
        </button>
      ))}
    </section>
  );
}
