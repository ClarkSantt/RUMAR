import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { getDatabase } from '../../lib/database/connection';
import type { RumoStore } from '../../hooks/useRumo';
import { localDate } from '../../lib/dates';
import { Subtasks } from '../tasks/Subtasks';
import { FocusRepository, type FocusSession } from './planner-repository';
type FocusRequest = {
  title: string;
  taskId?: string | null;
  blockId?: string | null;
  occurrenceDate?: string | null;
};
export function requestFocus(request: FocusRequest) {
  window.dispatchEvent(new CustomEvent('rumo-focus-start', { detail: request }));
}
export async function pauseOpenFocus() {
  const repo = new FocusRepository(await getDatabase());
  const row = await repo.open();
  if (row) await repo.pause(row.id);
}
export function FocusHost({ store }: { store: RumoStore }) {
  const [session, setSession] = useState<FocusSession | null>(null),
    [open, setOpen] = useState(false),
    [recovery, setRecovery] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [clock, setClock] = useState(() => Date.now());
  const lock = useRef(false),
    initialized = useRef<Promise<FocusSession | null> | null>(null);
  const refresh = async () => setSession(await new FocusRepository(await getDatabase()).open());
  const ready = Boolean(store.data);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    initialized.current ??= getDatabase().then((db) => new FocusRepository(db).recover());
    void initialized.current
      .then((row) => {
        if (live && row) {
          setSession(row);
          setRecovery(true);
          setOpen(true);
        }
      })
      .catch(() => setError('Não foi possível recuperar a sessão de foco.'));
    return () => {
      live = false;
    };
  }, [ready]);
  useEffect(() => {
    const listener = (event: Event) => {
      const data = (event as CustomEvent<FocusRequest>).detail;
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      void getDatabase()
        .then(async (db) => {
          const repo = new FocusRepository(db);
          const previous = await repo.open();
          if (previous) {
            setSession(previous);
            setRecovery(previous.status === 'paused');
          } else
            setSession(
              await repo.start(
                data.title,
                data.taskId ?? null,
                data.blockId ?? null,
                undefined,
                data.occurrenceDate ?? null,
              ),
            );
          setOpen(true);
          setError('');
        })
        .catch((e) => setError(String(e)))
        .finally(() => {
          lock.current = false;
          setBusy(false);
        });
    };
    window.addEventListener('rumo-focus-start', listener);
    return () => window.removeEventListener('rumo-focus-start', listener);
  }, []);
  useEffect(() => {
    if (session?.status !== 'running') return;
    let live = true;
    const timer = setInterval(() => {
      if (lock.current) return;
      lock.current = true;
      void getDatabase()
        .then(async (db) => {
          const repo = new FocusRepository(db);
          await repo.checkpoint(session.id);
          const row = await repo.open();
          if (live) setSession(row);
        })
        .catch(() => {
          setError('Erro ao salvar foco. Tentando pausar o contador.');
          void pauseOpenFocus()
            .then(refresh)
            .catch(() => setError('Não foi possível salvar a pausa. Tente novamente.'));
        })
        .finally(() => {
          lock.current = false;
        });
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session?.id, session?.status]);
  useEffect(() => {
    if (!open || session?.status !== 'running') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, session?.status]);
  async function action(kind: 'pause' | 'resume' | 'finish', complete = false) {
    if (!session || lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      const repo = new FocusRepository(await getDatabase());
      if (kind === 'finish' && complete && session.task_id) {
        const task = store.data?.tasks.find((t) => t.id === session.task_id);
        const date = session.occurrence_date ?? localDate();
        if (task && !(await store.run((r) => r.setComplete(task, date, true)))) return false;
      }
      await repo[kind](session.id);
      await refresh();
      setRecovery(false);
      if (kind === 'finish') {
        setOpen(false);
        store.setNotice({ message: 'Sessão de foco salva.' });
      }
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar foco.');
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const listener = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      if (command === 'focus-pause' && session?.status === 'running') void action('pause');
      if (command === 'focus-resume' && session?.status === 'paused') void action('resume');
      if (command === 'focus-finish' && session) void action('finish');
    };
    window.addEventListener('rumo-focus-tray-action', listener);
    return () => window.removeEventListener('rumo-focus-tray-action', listener);
  });
  if (!session) return error ? <p role="alert">{error}</p> : null;
  const drift =
    session.status === 'running'
      ? Math.max(0, Math.min(5, Math.floor((clock - Date.parse(session.last_checkpoint)) / 1000)))
      : 0;
  const seconds = session.focused_seconds + drift;
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const task = store.data?.tasks.find((t) => t.id === session.task_id);
  return (
    <>
      <button className="focus-return secondary-button" onClick={() => setOpen(true)}>
        Foco {session.status === 'paused' ? 'pausado' : 'em andamento'} · {timer}
      </button>
      {open && (
        <Dialog
          title={recovery ? 'Retomar sessão de foco' : 'Modo Focus'}
          onClose={() => {
            void action('pause').then((saved) => {
              if (saved) setOpen(false);
            });
          }}
          busy={busy}
          error={error}
        >
          <div className="focus-content">
            {recovery && (
              <p>Você tinha uma sessão de foco em andamento. O tempo offline não foi contado.</p>
            )}
            <h3>{session.title}</h3>
            <output className="focus-timer" aria-label="Tempo de foco registrado">
              {timer}
            </output>
            <p>{session.status === 'paused' ? 'Pausado' : 'Tempo realmente dedicado'}</p>
            {task && (
              <Subtasks store={store} task={task} date={session.occurrence_date ?? localDate()} />
            )}
            <div className="form-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void action(session.status === 'running' ? 'pause' : 'resume')}
              >
                {session.status === 'running' ? 'Pausar' : 'Retomar'}
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void action('finish')}
              >
                Finalizar foco
              </button>
              {task && (
                <button
                  className="secondary-button"
                  disabled={busy || store.busy}
                  onClick={() => void action('finish', true)}
                >
                  Concluir tarefa
                </button>
              )}
            </div>
            <p className="field-help">
              Fechar esta tela pausa a sessão e preserva o tempo registrado.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
