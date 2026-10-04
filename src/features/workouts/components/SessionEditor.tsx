import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../../components/Dialog';
import { getDatabase } from '../../../lib/database/connection';
import { formatDate } from '../../../lib/dates';
import { SessionsRepository } from '../repositories/sessions';
import { flushWorkouts, WorkoutWriter } from '../persistence';
import { recordedVolume, loadLabels } from '../domain';
import type { SessionDetail } from '../types';
import { SessionExerciseCard } from './SessionExerciseCard';
import { WorkoutEnergyForm } from '../../energy/WorkoutEnergyForm';
import { EnergyRepository } from '../../energy/repository';
const repository = async () => new SessionsRepository(await getDatabase());
export function SessionEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [notes, setNotes] = useState(''),
    [noteStatus, setNoteStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const writer = useRef<WorkoutWriter<string> | null>(null);
  useEffect(() => {
    let active = true;
    void repository()
      .then((r) => r.get(id))
      .then((value) => {
        if (active) {
          setDetail(value);
          setNotes(value.session.notes);
          void getDatabase()
            .then((db) => new EnergyRepository(db).sessionEstimate(id))
            .then((v) => {
              if (active) setEnergy(v);
            })
            .catch(() => {
              if (active) setEnergy(null);
            });
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível abrir a sessão.');
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    const queue = new WorkoutWriter<string>(async (value) => {
      await (await repository()).notes(id, value);
    }, setNoteStatus);
    writer.current = queue;
    return () => {
      writer.current = null;
      void queue.dispose().catch(() => {});
    };
  }, [id]);
  async function run(action: (repo: SessionsRepository) => Promise<unknown>, leave = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await flushWorkouts();
      const repo = await repository();
      await action(repo);
      setConfirm(null);
      if (leave) onBack();
      else {
        const refreshed = await repo.get(id);
        setDetail(refreshed);
        setNotes(refreshed.session.notes);
        setEnergy(await new EnergyRepository(await getDatabase()).sessionEstimate(id));
        setRevision((n) => n + 1);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível salvar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function back() {
    try {
      await flushWorkouts();
      onBack();
    } catch {
      setError('Há alterações não salvas. Corrija os campos ou tente salvar novamente.');
    }
  }
  if (!detail)
    return (
      <>
        <p role={error ? 'alert' : 'status'}>{error || 'Abrindo treino…'}</p>
        <button className="text-button" onClick={onBack}>
          Voltar
        </button>
      </>
    );
  const session = detail.session,
    completed = detail.sets.filter((s) => s.completed),
    volume = new Map<string, number>();
  for (const set of completed) {
    if (set.set_type === 'warmup') continue;
    const value = recordedVolume(set);
    if (value !== null) {
      const name =
        detail.exercises.find((e) => e.id === set.session_exercise_id)?.exercise_name ??
        'Exercício';
      const key = `${name} · ${loadLabels[set.load_type]}`;
      volume.set(key, (volume.get(key) ?? 0) + value);
    }
  }
  const duration = session.finished_at
    ? Math.max(
        0,
        Math.round((Date.parse(session.finished_at) - Date.parse(session.started_at)) / 60000),
      )
    : null;
  return (
    <div className="workout-session">
      <button className="text-button" onClick={() => void back()} disabled={busy}>
        ← Voltar aos treinos
      </button>
      <header className="page-header">
        <p className="eyebrow">{session.plan_name}</p>
        <h1>{session.day_name}</h1>
        <p>
          {formatDate(session.session_date)} ·{' '}
          {session.status === 'in_progress'
            ? 'Em andamento'
            : session.status === 'completed'
              ? 'Treino concluído'
              : 'Descartado'}
          {duration !== null ? ` · ${duration} min` : ''}
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      <WorkoutEnergyForm
        kind="session"
        id={id}
        onSaved={() =>
          void getDatabase()
            .then((db) => new EnergyRepository(db).sessionEstimate(id))
            .then(setEnergy)
        }
      />
      {session.status === 'completed' && (
        <div className="workout-summary">
          <p>
            {completed.length} séries · {completed.reduce((sum, s) => sum + (s.reps ?? 0), 0)}{' '}
            repetições
          </p>
          {energy !== null && (
            <p>Gasto estimado: ~{Math.round(energy).toLocaleString('pt-BR')} kcal</p>
          )}
          {[...volume].map(([unit, value]) => (
            <p className="field-help" key={unit}>
              Volume registrado — {unit}: {value.toLocaleString('pt-BR')} × rep
            </p>
          ))}
        </div>
      )}
      <fieldset disabled={busy || session.status === 'discarded'}>
        {detail.exercises.map((exercise) => (
          <SessionExerciseCard
            key={`${exercise.id}-${revision}`}
            exercise={exercise}
            session={session}
            sets={detail.sets.filter((s) => s.session_exercise_id === exercise.id)}
            onAdd={() => void run((r) => r.addSet(exercise.id))}
            onRemove={(setId) => void run((r) => r.removeSet(setId))}
            onCopy={() => void run((r) => r.copyPrevious(exercise.id))}
            onSetSaved={(saved) =>
              setDetail((value) =>
                value
                  ? { ...value, sets: value.sets.map((set) => (set.id === saved.id ? saved : set)) }
                  : value,
              )
            }
          />
        ))}
        <label>
          Observações do treino
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => {
              const value = e.target.value;
              setNotes(value);
              writer.current?.edit(value);
            }}
            onBlur={() => void writer.current?.flush().catch(() => {})}
          />
        </label>
        <p className="field-help" role="status">
          {noteStatus === 'saved'
            ? 'Salvo'
            : noteStatus === 'saving'
              ? 'Salvando…'
              : 'Erro ao salvar observações'}
        </p>
        {noteStatus === 'error' && (
          <button
            className="text-button"
            onClick={() => void writer.current?.flush().catch(() => {})}
          >
            Tentar novamente
          </button>
        )}
      </fieldset>
      <div className="workout-actions">
        {session.status === 'in_progress' ? (
          <>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void run((r) => r.finish(id))}
            >
              Finalizar treino
            </button>
            <button className="text-button" disabled={busy} onClick={() => setConfirm('discard')}>
              Descartar treino
            </button>
          </>
        ) : (
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => setConfirm('delete')}
          >
            Excluir sessão
          </button>
        )}
      </div>
      {confirm && (
        <Dialog
          title={confirm === 'delete' ? 'Excluir sessão?' : 'Descartar treino?'}
          onClose={() => setConfirm(null)}
          busy={busy}
          error={error}
        >
          <div className="dialog-content">
            <p>
              {confirm === 'delete'
                ? 'As séries desta sessão serão excluídas.'
                : 'O treino será marcado como descartado e não contará para recordes ou hábitos.'}
            </p>
          </div>
          <footer className="drawer-footer">
            <button className="secondary-button" onClick={() => setConfirm(null)} disabled={busy}>
              Cancelar
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void run((r) => (confirm === 'delete' ? r.remove(id) : r.discard(id)), true)
              }
            >
              {confirm === 'delete' ? 'Excluir' : 'Descartar'}
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
