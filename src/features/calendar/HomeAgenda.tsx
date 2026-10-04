import { useEffect, useState } from 'react';
import { getDatabase } from '../../lib/database/connection';
import { PlannerRepository, type TimeBlock } from './planner-repository';
import { minuteOf } from './planner-domain';
export function HomeAgenda({ day, now, onOpen }: { day: string; now: Date; onOpen: () => void }) {
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  useEffect(() => {
    let live = true;
    void getDatabase()
      .then((db) => new PlannerRepository(db).visibleRange(day, day))
      .then((rows) => {
        if (live) setBlocks(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [day]);
  const minute = now.getHours() * 60 + now.getMinutes();
  const upcoming = blocks.filter((b) => !b.completed && minuteOf(b.end_time) > minute).slice(0, 4);
  return (
    <section className="secondary-section">
      <div className="section-heading">
        <h2>Agenda de hoje</h2>
        <button className="text-button" onClick={onOpen}>
          Ver dia
        </button>
      </div>
      {upcoming.length ? (
        upcoming.map((b) => (
          <button className="review-line" key={b.id} onClick={onOpen}>
            <span>{b.start_time}</span>
            <strong>
              {minuteOf(b.start_time) <= minute ? 'Agora · ' : 'Próximo · '}
              {b.name}
            </strong>
          </button>
        ))
      ) : (
        <>
          <p>
            {blocks.length ? 'Nenhum próximo bloco hoje.' : 'Nenhum bloco planejado para hoje.'}
          </p>
          <button className="text-button" onClick={onOpen}>
            Planejar meu dia
          </button>
        </>
      )}
    </section>
  );
}
